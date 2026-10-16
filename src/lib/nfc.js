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

  // Every spelling of this card (as typed, lower/upper case, decimal→hex),
  // so capitalization differences between the reader, manual entry and
  // PassAble never cause a miss.
  const raw = String(uid).trim()
  const hex = toHexUid(raw)
  const candidates = [...new Set(
    [raw, raw.toLowerCase(), raw.toUpperCase(), hex, hex?.toLowerCase()].filter(Boolean)
  )]

  // limit(1) instead of maybeSingle(): maybeSingle() errors when a card
  // matches 2+ rows, which made the scan silently read as "unknown".
  const first = async (table, cols, prefer) => {
    const { data } = await supabase.from(table).select(cols).in('nfc_uid', candidates).limit(5)
    if (!data?.length) return null
    if (data.length > 1) console.warn(`[CheckMate] Card ${raw} is on ${data.length} ${table} rows`, data.map(r => r.name))
    return (prefer && data.find(prefer)) || data[0]
  }

  const equipment = await first('cm_equipment', '*')
  if (equipment) return { type: 'equipment', uid, data: equipment }

  const student = await first('cm_students', '*', s => s.passable_id)
  if (student) return { type: 'student', uid, data: student }

  const manager = await first('cm_managers', 'id, name, nfc_uid, active')
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
