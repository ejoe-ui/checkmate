/*
  checkmate-checkout  (v2 — updated for condition tracking + returned_by_manager_id)
  ─────────────────────────────────────────────────────────────────────────────
  Deploy:  supabase functions deploy checkmate-checkout

  Modes
  ─────
  1. PIN verify
     { managerId, pin }
     → validates PIN OR NFC UID (either credential alone is sufficient),
       returns { ok: true }

  2. Checkout
     { managerId, pin:"SESSION", studentId, equipmentIds[], dueAt,
       reason?, teacherName?, className?, conditionOut? }
     → creates cm_checkouts rows, sets equipment status = "Checked Out"

  3. Return
     { managerId, pin:"SESSION", action:"return", equipmentId,
       conditionIn?, conditionNotes? }
     → sets checked_in_at, returned_by_manager_id, condition_in, condition_notes
        equipment status = "Available"

  4. Return (bulk — kit checklist)
     { managerId, pin:"SESSION", action:"returnBulk",
       items: [{ equipmentId, conditionIn?, conditionNotes? }, ...] }
     → same effect as Return, applied to every item in the list. Items are
       processed independently — one bad id in the batch doesn't block the rest.
       Returns { ok, results: [{ equipmentId, error }] }; ok is false if any
       item failed, so the caller can tell partial success from total success.
*/

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MANAGER_PIN_COLUMN  = 'pin_hash' // change to 'pin' if storing plain text

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const body = await req.json()
    const { managerId, pin, action } = body

    // ── MODE 1: PIN verify ─────────────────────────────────────────────────
    if (!action && pin !== 'SESSION') {
      const { data: mgr, error } = await supabase
        .from('cm_managers')
        .select('id, pin_hash, nfc_uid, active')
        .eq('id', managerId)
        .single()

      if (error || !mgr) return json({ error: 'Manager not found' }, corsHeaders)
      if (!mgr.active)   return json({ error: 'Manager account is inactive' }, corsHeaders)
      // Either credential fully authenticates on its own — a typed code or a
      // tapped NFC badge, no second factor required.
      const storedPin = (mgr.pin_hash ?? '').replace(/^TEMP:/, '')
      const authOk = (!!storedPin && storedPin === pin) || (!!mgr.nfc_uid && mgr.nfc_uid === pin)
      if (!authOk) return json({ error: 'Incorrect PIN' }, corsHeaders)

      return json({ ok: true }, corsHeaders)
    }

    // All other modes require SESSION pin — just trust the client (session was verified at login)
    // In production you'd verify a session token instead.

    // ── MODE 3: Return ─────────────────────────────────────────────────────
    if (action === 'return') {
      const { equipmentId, conditionIn, conditionNotes } = body
      const err = await returnOneItem(supabase, managerId, equipmentId, conditionIn, conditionNotes)
      if (err) return json({ error: err }, corsHeaders)
      return json({ ok: true }, corsHeaders)
    }

    // ── MODE 4: Return (bulk — kit checklist) ───────────────────────────────
    if (action === 'returnBulk') {
      const { items } = body
      if (!items?.length) return json({ error: 'items is required' }, corsHeaders)

      const results = []
      for (const it of items as Array<{ equipmentId: string; conditionIn?: string; conditionNotes?: string }>) {
        const err = await returnOneItem(supabase, managerId, it.equipmentId, it.conditionIn, it.conditionNotes)
        results.push({ equipmentId: it.equipmentId, error: err })
      }

      const failed = results.filter(r => r.error)
      return json(
        { ok: failed.length === 0, results, error: failed.length ? `${failed.length} of ${results.length} items failed` : undefined },
        corsHeaders
      )
    }

    // ── MODE 2: Checkout ───────────────────────────────────────────────────
    const { studentId, equipmentIds, dueAt, reason, teacherName, className, conditionOut, conditionOutNotes, approvedBy } = body

    if (!studentId || !equipmentIds?.length || !dueAt) {
      return json({ error: 'Missing required checkout fields' }, corsHeaders)
    }

    const rows = equipmentIds.map((equipmentId: string) => ({
      student_id:          studentId,
      equipment_id:        equipmentId,
      manager_id:          managerId,
      due_at:              dueAt,
      reason:              reason            ?? null,
      teacher_name:        teacherName       ?? null,
      class_name:          className         ?? null,
      condition_out:       conditionOut      ?? 'good',
      condition_out_notes: conditionOutNotes ?? null,
      approved_by:         approvedBy        ?? null,
    }))

    const { error: insertErr } = await supabase
      .from('cm_checkouts')
      .insert(rows)

    if (insertErr) return json({ error: insertErr.message }, corsHeaders)

    const { error: statusErr } = await supabase
      .from('cm_equipment')
      .update({ status: 'Checked Out' })
      .in('id', equipmentIds)

    if (statusErr) return json({ error: statusErr.message }, corsHeaders)

    return json({ ok: true }, corsHeaders)

  } catch (err) {
    return json({ error: String(err) }, corsHeaders)
  }
})

function json(data: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

// Closes one open checkout for a piece of equipment and updates its status.
// Shared by MODE 3 (single return) and MODE 4 (bulk return, e.g. a kit checklist).
// Returns an error message string on failure, or null on success.
async function returnOneItem(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  managerId: string,
  equipmentId: string,
  conditionIn?: string,
  conditionNotes?: string
): Promise<string | null> {
  if (!equipmentId) return 'equipmentId is required'

  // Find the open checkout for this equipment
  const { data: checkout, error: findErr } = await supabase
    .from('cm_checkouts')
    .select('id')
    .eq('equipment_id', equipmentId)
    .is('checked_in_at', null)
    .order('checked_out_at', { ascending: false })
    .limit(1)
    .single()

  if (findErr || !checkout) return 'No open checkout found for this equipment'

  const { error: returnErr } = await supabase
    .from('cm_checkouts')
    .update({
      checked_in_at:          new Date().toISOString(),
      returned_by_manager_id: managerId,
      condition_in:           conditionIn   ?? 'returned_ok',
      condition_notes:        conditionNotes ?? null,
    })
    .eq('id', checkout.id)

  if (returnErr) return returnErr.message

  // Set equipment status based on return condition
  const returnedStatus = (conditionIn === 'damaged')
    ? 'Damaged'
    : (conditionIn && conditionIn !== 'returned_ok')
      ? 'Needs Inspection'
      : 'Available'

  const { error: eqErr } = await supabase
    .from('cm_equipment')
    .update({ status: returnedStatus })
    .eq('id', equipmentId)

  return eqErr ? eqErr.message : null
}
