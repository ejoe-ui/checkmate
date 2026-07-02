/*
  checkmate-checkout  (v2 — updated for condition tracking + returned_by_manager_id)
  ─────────────────────────────────────────────────────────────────────────────
  Deploy:  supabase functions deploy checkmate-checkout

  Modes
  ─────
  1. PIN verify
     { managerId, pin }
     → validates PIN, returns { ok: true }

  2. Checkout
     { managerId, pin:"SESSION", studentId, equipmentIds[], dueAt,
       reason?, teacherName?, className?, conditionOut? }
     → creates cm_checkouts rows, sets equipment status = "Checked Out"

  3. Return
     { managerId, pin:"SESSION", action:"return", equipmentId,
       conditionIn?, conditionNotes? }
     → sets checked_in_at, returned_by_manager_id, condition_in, condition_notes
        equipment status = "Available"
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
        .select('id, pin, active')
        .eq('id', managerId)
        .single()

      if (error || !mgr) return json({ error: 'Manager not found' }, corsHeaders)
      if (!mgr.active)   return json({ error: 'Manager account is inactive' }, corsHeaders)
      if (mgr.pin !== pin) return json({ error: 'Incorrect PIN' }, corsHeaders)

      return json({ ok: true }, corsHeaders)
    }

    // All other modes require SESSION pin — just trust the client (session was verified at login)
    // In production you'd verify a session token instead.

    // ── MODE 3: Return ─────────────────────────────────────────────────────
    if (action === 'return') {
      const { equipmentId, conditionIn, conditionNotes } = body

      // Find the open checkout for this equipment
      const { data: checkout, error: findErr } = await supabase
        .from('cm_checkouts')
        .select('id')
        .eq('equipment_id', equipmentId)
        .is('checked_in_at', null)
        .order('checked_out_at', { ascending: false })
        .limit(1)
        .single()

      if (findErr || !checkout) return json({ error: 'No open checkout found for this equipment' }, corsHeaders)

      const { error: returnErr } = await supabase
        .from('cm_checkouts')
        .update({
          checked_in_at:          new Date().toISOString(),
          returned_by_manager_id: managerId,
          condition_in:           conditionIn   ?? 'returned_ok',
          condition_notes:        conditionNotes ?? null,
        })
        .eq('id', checkout.id)

      if (returnErr) return json({ error: returnErr.message }, corsHeaders)

      const { error: eqErr } = await supabase
        .from('cm_equipment')
        .update({ status: 'Available' })
        .eq('id', equipmentId)

      if (eqErr) return json({ error: eqErr.message }, corsHeaders)

      return json({ ok: true }, corsHeaders)
    }

    // ── MODE 2: Checkout ───────────────────────────────────────────────────
    const { studentId, equipmentIds, dueAt, reason, teacherName, className, conditionOut } = body

    if (!studentId || !equipmentIds?.length || !dueAt) {
      return json({ error: 'Missing required checkout fields' }, corsHeaders)
    }

    const rows = equipmentIds.map((equipmentId: string) => ({
      student_id:   studentId,
      equipment_id: equipmentId,
      manager_id:   managerId,
      due_at:       dueAt,
      reason:       reason       ?? null,
      teacher_name: teacherName  ?? null,
      class_name:   className    ?? null,
      condition_out: conditionOut ?? 'good',
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
