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
    const READ_ACTIONS  = new Set(['equipment.getHistory', 'checkout.listHistory', 'checkout.getOverdueNotes'])
    // Kiosk actions: manager already authenticated via NFC + PIN at kiosk login — accept pin='SESSION'
    const KIOSK_ACTIONS = new Set(['equipment.hotSwap'])
    const isWrite = !action.endsWith('.list') && !READ_ACTIONS.has(action)
    if (isWrite) {
      const { data: mgr } = await supabase
        .from('cm_managers')
        .select('pin_hash, active')
        .eq('id', managerId)
        .single()
      if (!mgr || !mgr.active) return json({ error: 'Unauthorized' }, corsHeaders)
      const isKioskSession = KIOSK_ACTIONS.has(action) && pin === 'SESSION'
      if (!isKioskSession) {
        const storedPin = (mgr.pin_hash ?? '').replace(/^TEMP:/, '')
        if (storedPin !== pin) return json({ error: 'Unauthorized' }, corsHeaders)
      }
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

    // ── equipment.resolve ─────────────────────────────────────────────────
    // Resolves a damage/inspection flag: updates status + records condition note + resolver.
    if (action === 'equipment.resolve') {
      const { equipmentId, status, conditionNotes, resolvedBy } = body
      if (!equipmentId) return json({ error: 'equipmentId is required' }, corsHeaders)

      const { data: mgr } = await supabase
        .from('cm_managers').select('name').eq('id', managerId).single()
      const resolverName = resolvedBy || mgr?.name || 'Manager'

      const { error } = await supabase
        .from('cm_equipment')
        .update({
          status,
          condition_notes:      conditionNotes ?? null,
          condition_updated_at: new Date().toISOString(),
          condition_updated_by: resolverName,
        })
        .eq('id', equipmentId)
      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── equipment.getHistory ──────────────────────────────────────────────
    // Returns all checkout records for one piece of equipment, newest first.
    // Includes condition_in, condition_notes, student name, dates.
    if (action === 'equipment.getHistory') {
      const { equipmentId } = body
      if (!equipmentId) return json({ error: 'equipmentId is required' }, corsHeaders)

      const { data, error } = await supabase
        .from('cm_checkouts')
        .select(`
          id, checked_out_at, checked_in_at, due_at,
          condition_out, condition_out_notes,
          condition_in, condition_notes,
          reason, teacher_name, approved_by,
          cm_students!student_id(id, name),
          cm_managers!manager_id(name)
        `)
        .eq('equipment_id', equipmentId)
        .order('checked_out_at', { ascending: false })
        .limit(50)

      return error ? json({ error: error.message }, corsHeaders) : json({ data }, corsHeaders)
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

    // ── equipment.hotSwap ─────────────────────────────────────────────────
    // Kiosk hot-swap: replaces a missing kit item with a scanned replacement.
    // - Unlinks the missing item (parent_container_id = null, status = Needs Inspection)
    // - Links the replacement item to the container
    // Authenticated via SESSION pin (manager logged in at kiosk).
    if (action === 'equipment.hotSwap') {
      const { missingItemId, replacementItemId, containerId } = body
      if (!missingItemId || !replacementItemId || !containerId)
        return json({ error: 'missingItemId, replacementItemId, and containerId are required' }, corsHeaders)

      // Verify replacement exists and is not in a blocked state
      const { data: replacement } = await supabase
        .from('cm_equipment')
        .select('id, name, status, parent_container_id')
        .eq('id', replacementItemId)
        .single()

      if (!replacement) return json({ error: 'Replacement item not found' }, corsHeaders)
      const BLOCKED = ['Damaged', 'Retired', 'Lost']
      if (BLOCKED.includes(replacement.status))
        return json({ error: `Cannot swap — replacement is ${replacement.status}` }, corsHeaders)

      // Unlink missing item and flag for inspection
      const { error: e1 } = await supabase
        .from('cm_equipment')
        .update({ parent_container_id: null, status: 'Needs Inspection' })
        .eq('id', missingItemId)
      if (e1) return json({ error: e1.message }, corsHeaders)

      // Link replacement to kit
      const { error: e2 } = await supabase
        .from('cm_equipment')
        .update({ parent_container_id: containerId })
        .eq('id', replacementItemId)
      if (e2) return json({ error: e2.message }, corsHeaders)

      return json({ ok: true, replacement }, corsHeaders)
    }

    // ── student.list ──────────────────────────────────────────────────────
    if (action === 'student.list') {
      const { data, error } = await supabase
        .from('cm_students')
        .select('id, name, email, class_group, nfc_uid, status, photo_url, photo_file, photo_available, equipment_form_status, media_directory_opt_out, last_synced_at, temp_access_expires_at, notes')
        .order('name')
      if (error) return json({ error: error.message }, corsHeaders)

      // Generate fresh 1-hour signed URLs for students with photo_file.
      // Mirror PassAble's approach: try lifetouch-raw first, fall back to student-photos.
      // Numeric-ID filenames (e.g. 801493.jpg) live in student-photos.
      // lastname_firstname.jpg files live in lifetouch-raw.
      const enriched = await Promise.all((data || []).map(async (s) => {
        if (s.photo_file) {
          const { data: s1 } = await supabase.storage
            .from('lifetouch-raw').createSignedUrl(s.photo_file, 3600)
          if (s1?.signedUrl) return { ...s, photo_url: s1.signedUrl, photo_available: true }

          const { data: s2 } = await supabase.storage
            .from('student-photos').createSignedUrl(s.photo_file, 3600)
          if (s2?.signedUrl) return { ...s, photo_url: s2.signedUrl, photo_available: true }
        }
        return s
      }))

      return json({ data: enriched }, corsHeaders)
    }

    // ── student.setFormStatus ─────────────────────────────────────────────
    if (action === 'student.setFormStatus') {
      const { studentId, formStatus } = body
      const valid = ['form_on_file', 'no_form', 'pending', 'restricted', 'temp_pass']
      if (!valid.includes(formStatus)) return json({ error: 'Invalid form status' }, corsHeaders)
      const { error } = await supabase
        .from('cm_students')
        .update({ equipment_form_status: formStatus })
        .eq('id', studentId)
      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── student.addStudent ────────────────────────────────────────────────
    // Manually adds a student not in PassAble (e.g. from another class).
    if (action === 'student.addStudent') {
      const { name, email, classGroup, nfcUid, formStatus, grantTempPass } = body
      if (!name?.trim()) return json({ error: 'Name is required' }, corsHeaders)

      const validStatuses = ['form_on_file', 'no_form', 'pending', 'restricted', 'temp_pass']
      const status = validStatuses.includes(formStatus) ? formStatus : 'no_form'

      // Temp pass: expires end of the next calendar day
      let tempExpires: string | null = null
      if (grantTempPass || status === 'temp_pass') {
        const exp = new Date()
        exp.setDate(exp.getDate() + 1)
        exp.setHours(23, 59, 0, 0)
        tempExpires = exp.toISOString()
      }

      const { data, error } = await supabase
        .from('cm_students')
        .insert({
          name:                    name.trim(),
          email:                   email?.trim()    || null,
          class_group:             classGroup?.trim() || null,
          nfc_uid:                 nfcUid?.trim()   || null,
          equipment_form_status:   grantTempPass ? 'temp_pass' : status,
          temp_access_expires_at:  tempExpires,
          last_synced_at:          new Date().toISOString(),
        })
        .select()
        .single()

      return error ? json({ error: error.message }, corsHeaders) : json({ data }, corsHeaders)
    }

    // ── student.grantTempPass ─────────────────────────────────────────────
    // Grants a 1-day checkout pass to an existing student.
    if (action === 'student.grantTempPass') {
      const { studentId } = body
      if (!studentId) return json({ error: 'studentId is required' }, corsHeaders)

      const exp = new Date()
      exp.setDate(exp.getDate() + 1)
      exp.setHours(23, 59, 0, 0)

      const { error } = await supabase
        .from('cm_students')
        .update({
          equipment_form_status:  'temp_pass',
          temp_access_expires_at: exp.toISOString(),
        })
        .eq('id', studentId)

      return error
        ? json({ error: error.message }, corsHeaders)
        : json({ ok: true, expiresAt: exp.toISOString() }, corsHeaders)
    }

    // ── student.syncFromPassAble ──────────────────────────────────────────
    // Upserts ALL PassAble students into cm_students matched by passable_id
    // (PassAble's `id` field = Aeries student ID). No NFC UID required.
    // - New students: inserted with no_form, nfc_uid copied from PassAble if present
    // - Existing students: name/grade/class/photo updated; nfc_uid NEVER overwritten
    //   if cm_students already has one (manually assigned UIDs are protected)
    if (action === 'student.syncFromPassAble') {
      const { data: passable } = await supabase
        .from('students')
        .select('id, nfc_uid, full_name, grade, period, photo_file, photo_url')

      const { data: existing } = await supabase
        .from('cm_students')
        .select('id, passable_id, nfc_uid, equipment_form_status, temp_access_expires_at, last_synced_at')

      if (!passable) return json({ error: 'Could not load PassAble students' }, corsHeaders)

      // Match by passable_id (Aeries student ID)
      const existingMap = new Map((existing || []).map(s => [s.passable_id, s]))

      let added = 0, updated = 0

      for (const p of passable) {
        if (!p.id || !p.full_name) continue
        const ex = existingMap.get(p.id)
        const now = new Date().toISOString()

        if (ex) {
          // Build update — never overwrite nfc_uid if CheckMate already has one
          const updateFields: Record<string, unknown> = {
            name:           p.full_name,
            class_group:    p.period    || null,
            photo_file:     p.photo_file || null,
            last_synced_at: now,
          }
          // Only sync nfc_uid from PassAble if CheckMate doesn't have one yet
          if (!ex.nfc_uid && p.nfc_uid) {
            updateFields.nfc_uid = p.nfc_uid
          }
          await supabase.from('cm_students').update(updateFields).eq('id', ex.id)
          updated++
        } else {
          // New student — insert with no_form default
          await supabase.from('cm_students').insert({
            passable_id:           p.id,
            nfc_uid:               p.nfc_uid  || null,
            name:                  p.full_name,
            class_group:           p.period   || null,
            photo_file:            p.photo_file || null,
            equipment_form_status: 'no_form',
            last_synced_at:        now,
          })
          added++
        }
      }

      // Auto-restrict students removed from PassAble.
      // Only touches students who have a passable_id (came from a previous sync).
      // Manually-added students (passable_id = null) are never auto-restricted.
      const passableIdSet = new Set((passable || []).map((p: any) => p.id).filter(Boolean))
      const toRestrict = (existing || []).filter((s: any) =>
        s.passable_id &&
        !passableIdSet.has(s.passable_id) &&
        s.equipment_form_status !== 'restricted'
      )
      let restricted = 0
      for (const s of toRestrict) {
        await supabase.from('cm_students')
          .update({ equipment_form_status: 'restricted' })
          .eq('id', s.id)
        restricted++
      }

      return json({ ok: true, added, updated, restricted }, corsHeaders)
    }

    // ── student.setNote ───────────────────────────────────────────────────
    // Sets or clears the manager note on a student. Requires PIN.
    if (action === 'student.setNote') {
      const { studentId, note } = body
      if (!studentId) return json({ error: 'studentId is required' }, corsHeaders)
      const { error } = await supabase
        .from('cm_students')
        .update({ notes: note?.trim() || null })
        .eq('id', studentId)
      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── student.update ────────────────────────────────────────────────────
    // General-purpose student field update (email, notes). Requires PIN.
    // Only updates fields that are explicitly provided in the payload.
    if (action === 'student.update') {
      const { studentId, email, notes } = body
      if (!studentId) return json({ error: 'studentId is required' }, corsHeaders)
      const fields: Record<string, unknown> = {}
      if (email  !== undefined) fields.email = email?.trim()  || null
      if (notes  !== undefined) fields.notes = notes?.trim()  || null
      if (Object.keys(fields).length === 0) return json({ ok: true }, corsHeaders)
      const { error } = await supabase.from('cm_students').update(fields).eq('id', studentId)
      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── student.syncPhoto ─────────────────────────────────────────────────
    // Copies photo_file from PassAble's students table to cm_students, matched by nfc_uid.
    // Photos live in the lifetouch-raw bucket; signed URLs are generated at list time.
    if (action === 'student.syncPhoto') {
      const { studentId } = body
      const { data: cmStudent } = await supabase
        .from('cm_students')
        .select('nfc_uid')
        .eq('id', studentId)
        .single()

      if (!cmStudent) return json({ error: 'Student not found' }, corsHeaders)

      // Look up photo_file in PassAble students table by nfc_uid
      const { data: passableStudent } = await supabase
        .from('students')
        .select('photo_file, photo_url')
        .eq('nfc_uid', cmStudent.nfc_uid)
        .single()

      if (!passableStudent?.photo_file) {
        // Fallback: use photo_url if no photo_file
        if (!passableStudent?.photo_url) return json({ error: 'No photo found in PassAble' }, corsHeaders)
        const { error } = await supabase.from('cm_students').update({
          photo_url: passableStudent.photo_url, photo_available: true,
          last_synced_at: new Date().toISOString(),
        }).eq('id', studentId)
        return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
      }

      const { error } = await supabase
        .from('cm_students')
        .update({
          photo_file:      passableStudent.photo_file,
          photo_available: true,
          last_synced_at:  new Date().toISOString(),
        })
        .eq('id', studentId)

      return error ? json({ error: error.message }, corsHeaders) : json({ ok: true }, corsHeaders)
    }

    // ── student.syncAllPhotos ─────────────────────────────────────────────
    // Batch sync all photos from PassAble.
    // Copies photo_file (not photo_url) — photos live in lifetouch-raw bucket.
    // Signed URLs are generated at list time, not stored.
    if (action === 'student.syncAllPhotos') {
      const { data: cmStudents } = await supabase
        .from('cm_students')
        .select('id, nfc_uid')

      // Prefer photo_file; fall back to photo_url for students without one
      const { data: passableStudents } = await supabase
        .from('students')
        .select('nfc_uid, photo_file, photo_url')
        .or('photo_file.not.is.null,photo_url.not.is.null')

      if (!cmStudents || !passableStudents) return json({ error: 'Could not load students' }, corsHeaders)

      const photoMap = new Map(passableStudents.map(s => [s.nfc_uid, s]))
      let synced = 0

      for (const s of cmStudents) {
        const p = photoMap.get(s.nfc_uid)
        if (!p) continue

        if (p.photo_file) {
          // Primary: photo_file set in PassAble — store it directly
          await supabase.from('cm_students').update({
            photo_file: p.photo_file,
            photo_available: true,
            last_synced_at: new Date().toISOString(),
          }).eq('id', s.id)
          synced++
        } else if (p.photo_url) {
          // photo_url is like https://.../object/public/student-photos/802063.jpg
          // Extract the filename and try it in lifetouch-raw (same files, different bucket)
          const filename = p.photo_url.split('/').pop()
          if (filename) {
            const { data: signed } = await supabase.storage
              .from('lifetouch-raw')
              .createSignedUrl(filename, 3600)
            if (signed?.signedUrl) {
              await supabase.from('cm_students').update({
                photo_file: filename,
                photo_url: signed.signedUrl,
                photo_available: true,
                last_synced_at: new Date().toISOString(),
              }).eq('id', s.id)
              synced++
              continue
            }
          }
          // lifetouch-raw failed — just store the raw URL as a last resort
          await supabase.from('cm_students').update({
            photo_url: p.photo_url,
            photo_available: true,
            last_synced_at: new Date().toISOString(),
          }).eq('id', s.id)
          synced++
        }
      }

      return json({ ok: true, synced }, corsHeaders)
    }

    // ── checkout.listHistory ─────────────────────────────────────────────
    // Returns returned checkouts (checked_in_at IS NOT NULL), newest first.
    // Optional filter: issuesOnly=true returns only non-OK condition_in.
    if (action === 'checkout.listHistory') {
      const { issuesOnly, limit: lim, offset: off } = body
      let query = supabase
        .from('cm_checkouts')
        .select(`
          id, checked_out_at, checked_in_at, due_at,
          condition_out, condition_out_notes,
          condition_in, condition_notes,
          reason, teacher_name, class_name, approved_by,
          cm_students!student_id(id, name, class_group, photo_file),
          cm_equipment!equipment_id(id, name, category, serial_number, asset_id),
          cm_managers!manager_id(name)
        `)
        .not('checked_in_at', 'is', null)
        .order('checked_in_at', { ascending: false })
        .limit(lim ?? 100)

      if (off) query = query.range(off, (off + (lim ?? 100)) - 1)
      if (issuesOnly) query = query.neq('condition_in', 'returned_ok')

      const { data, error } = await query
      if (error) return json({ error: error.message }, corsHeaders)
      return json({ data }, corsHeaders)
    }

    // ── checkout.getOverdueNotes ──────────────────────────────────────────
    // Returns all overdue notes for a checkout, ordered oldest-first.
    if (action === 'checkout.getOverdueNotes') {
      const { checkoutId } = body
      const { data, error } = await supabase
        .from('cm_overdue_notes')
        .select('id, note, action, extended_due_at, created_at, cm_managers!manager_id(name)')
        .eq('checkout_id', checkoutId)
        .order('created_at', { ascending: true })
      return error ? json({ error: error.message }, corsHeaders) : json({ data }, corsHeaders)
    }

    // ── checkout.addOverdueNote ───────────────────────────────────────────
    // Adds a note to cm_overdue_notes. If noteType='extended_due', also
    // updates due_at on the checkout row.
    if (action === 'checkout.addOverdueNote') {
      const { checkoutId, studentId, note, noteType, extendedDueAt } = body
      if (!checkoutId || !note) return json({ error: 'checkoutId and note are required' }, corsHeaders)

      const validTypes = ['contacted', 'extended_due', 'marked_resolved', 'other']
      const resolvedType = validTypes.includes(noteType) ? noteType : 'other'

      const { error: insertErr } = await supabase
        .from('cm_overdue_notes')
        .insert({
          checkout_id:     checkoutId,
          student_id:      studentId   ?? null,
          manager_id:      managerId,
          note,
          action:          resolvedType,
          extended_due_at: extendedDueAt ?? null,
        })
      if (insertErr) return json({ error: insertErr.message }, corsHeaders)

      // If extending due date, update the checkout row too
      if (resolvedType === 'extended_due' && extendedDueAt) {
        const { error: extErr } = await supabase
          .from('cm_checkouts')
          .update({ due_at: extendedDueAt })
          .eq('id', checkoutId)
        if (extErr) return json({ error: extErr.message }, corsHeaders)
      }

      return json({ ok: true }, corsHeaders)
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
