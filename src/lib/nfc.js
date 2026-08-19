import { supabase } from './supabase'

// Reader may emit raw decimal (older behavior, still used by equipment/manager
// badges registered by typing/scanning straight into the admin text field) or
// raw hex containing letters a-f (some card types). Student cards are synced
// from PassAble's students.nfc_uid, which is always stored as uppercase hex —
// so a raw decimal scan from the kiosk reader must also be tried as hex or
// student lookups will never match. Mirrors the fix applied in
// hall-pass/app/kiosk/page.jsx and hall-pass/app/wire/page.jsx.
export function toHexUid(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  if (/[a-fA-F]/.test(trimmed)) {
    return trimmed.toUpperCase().padStart(8, '0')
  }
  const num = parseInt(trimmed, 10)
  if (isNaN(num) || num < 0) return null
  return num.toString(16).toUpperCase().padStart(8, '0')
}

export async function resolveUid(uid) {
  if (!uid) return { type: 'unknown', uid }

  const raw = String(uid).trim()
  const hex = toHexUid(raw)
  const candidates = hex && hex !== raw ? [raw, hex] : [raw]

  const { data: equipment } = await supabase
    .from('cm_equipment')
    .select('*')
    .in('nfc_uid', candidates)
    .maybeSingle()

  if (equipment) return { type: 'equipment', uid, data: equipment }

  const { data: student } = await supabase
    .from('cm_students')
    .select('*')
    .in('nfc_uid', candidates)
    .maybeSingle()

  if (student) return { type: 'student', uid, data: student }

  const { data: manager } = await supabase
    .from('cm_managers')
    .select('id, name, nfc_uid, active')
    .in('nfc_uid', candidates)
    .maybeSingle()

  if (manager) return { type: 'manager', uid, data: manager }

  return { type: 'unknown', uid }
}

export async function getStudentOpenCheckouts(studentNfcUid) {
  const { data } = await supabase
    .from('cm_open_checkouts')
    .select('*')
    .eq('student_nfc_uid', studentNfcUid)
  return data ?? []
}
