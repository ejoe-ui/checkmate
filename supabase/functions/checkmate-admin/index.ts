/*
  checkmate-admin  (v1)
  ─────────────────────────────────────────────────────────────────────────────
  Deploy:  supabase functions deploy checkmate-admin

  Admin CRUD operations. Requires manager PIN for all write actions.

  Actions
  ───────
  equipment.list        → all equipment rows
  equipment.upsert      → add or update equipment record
  equipment.setStatus   → change status only (quick action)
  equipment.delete      → soft delete (sets status = 'Retired')

  student.list          → all students with form_status + photo
  student.setFormStatus → update equipment_form_status for a student
  student.syncPhoto     → copy photo_url from PassAble students table by nfc_uid

  manager.list          → all managers

  All write actions require { managerId, pin } for verification.
*/

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const body   = await req.json()
    const { action, managerId, pin } = body

    // ── PIN verify for all write actions ──────────────────────────────────
    const isWrite = !action.endsWith('.list')
    if (isWrite) {
      const { data: mgr } = await supabase
        .from('cm_managers')
        .select('pin_hash, active')
        .eq('id', managerId)
        .single()
      const storedPin = (mgr?.pin_hash ?? '').replace(/^TEMP:/, '')
      if (!mgr || !mgr.active || storedPin !== pin)
        return json({ error: 'Unauthorized' }, corsHeaders)
    }

    // ── equipment.list ─────────────────────────────────────────────────────
    if (action === 'equipment.list') {
      const { data, error } = await supabase
        .from('cm_equipment')
        .select('*')
        .order('category')
        .order('name')
      return error ? json({ error: error.message }, corsHeaders) : json({ data }, corsHeaders)
    }

    // ── equipment.upsert ──────────────────────────────────────────────────
    if (action === 'equipment.upsert') {
      const { equipment } = body
      const { data, error } = await supabase
        .from('cm_equipment')
        .upsert(equipment, { onConflict: 'id' })
        .select()
        .single()
      return error ? json({ error: error.message }, corsHeaders) : json({ data }, corsHeaders)
    }

    // ── equipment.setStatus ───────────────────────────────────────────────
    if (action === 'equipment.setStatus') {
      const { equipmentId, status } = body
      const { error } = await supabase
        .from('cm_equipment')
        .update({ status })
        .eq('id', equipmentId)
      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── equipment.delete (retire) ─────────────────────────────────────────
    if (action === 'equipment.delete') {
      const { equipmentId } = body
      const { error } = await supabase
        .from('cm_equipment')
        .update({ status: 'Retired' })
        .eq('id', equipmentId)
      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── student.list ──────────────────────────────────────────────────────
    if (action === 'student.list') {
      const { data, error } = await supabase
        .from('cm_students')
        .select('id, name, email, class_group, nfc_uid, status, photo_url, photo_available, equipment_form_status, media_directory_opt_out, last_synced_at')
        .order('name')
      return error ? json({ error: error.message }, corsHeaders) : json({ data }, corsHeaders)
    }

    // ── student.setFormStatus ─────────────────────────────────────────────
    if (action === 'student.setFormStatus') {
      const { studentId, formStatus } = body
      const valid = ['form_on_file', 'no_form', 'pending', 'restricted']
      if (!valid.includes(formStatus)) return json({ error: 'Invalid form status' }, corsHeaders)
      const { error } = await supabase
        .from('cm_students')
        .update({ equipment_form_status: formStatus })
        .eq('id', studentId)
      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── student.syncPhoto ─────────────────────────────────────────────────
    // Copies photo_url from PassAble's students table to cm_students, matched by nfc_uid
    if (action === 'student.syncPhoto') {
      const { studentId } = body
      const { data: cmStudent } = await supabase
        .from('cm_students')
        .select('nfc_uid')
        .eq('id', studentId)
        .single()

      if (!cmStudent) return json({ error: 'Student not found' }, corsHeaders)

      // Look up photo in PassAble students table by nfc_uid
      const { data: passableStudent } = await supabase
        .from('students')
        .select('photo_url')
        .eq('nfc_uid', cmStudent.nfc_uid)
        .single()

      if (!passableStudent?.photo_url) return json({ error: 'No photo found in PassAble' }, corsHeaders)

      const { error } = await supabase
        .from('cm_students')
        .update({
          photo_url:       passableStudent.photo_url,
          photo_available: true,
          last_synced_at:  new Date().toISOString(),
        })
        .eq('id', studentId)

      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── student.syncAllPhotos ─────────────────────────────────────────────
    // Batch sync all photos from PassAble
    if (action === 'student.syncAllPhotos') {
      const { data: cmStudents } = await supabase
        .from('cm_students')
        .select('id, nfc_uid')

      const { data: passableStudents } = await supabase
        .from('students')
        .select('nfc_uid, photo_url')
        .not('photo_url', 'is', null)

      if (!cmStudents || !passableStudents) return json({ error: 'Could not load students' }, corsHeaders)

      const photoMap = new Map(passableStudents.map(s => [s.nfc_uid, s.photo_url]))
      let synced = 0

      for (const s of cmStudents) {
        const photoUrl = photoMap.get(s.nfc_uid)
        if (photoUrl) {
          await supabase.from('cm_students').update({
            photo_url: photoUrl, photo_available: true,
            last_synced_at: new Date().toISOString(),
          }).eq('id', s.id)
          synced++
        }
      }

      return json({ ok: true, synced }, corsHeaders)
    }

    // ── manager.list ──────────────────────────────────────────────────────
    if (action === 'manager.list') {
      const { data, error } = await supabase
        .from('cm_managers')
        .select('id, name, nfc_uid, active')
        .order('name')
      return error ? json({ error: error.message }, corsHeaders) : json({ data }, corsHeaders)
    }

    return json({ error: 'Unknown action: ' + action }, corsHeaders)

  } catch (err) {
    return json({ error: String(err) }, corsHeaders)
  }
})

function json(data: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
