import { supabase } from './supabase'

export async function resolveUid(uid) {
  if (!uid) return { type: 'unknown', uid }

  const { data: equipment } = await supabase
    .from('cm_equipment')
    .select('*')
    .eq('nfc_uid', uid)
    .single()

  if (equipment) return { type: 'equipment', uid, data: equipment }

  const { data: student } = await supabase
    .from('cm_students')
    .select('*')
    .eq('nfc_uid', uid)
    .single()

  if (student) return { type: 'student', uid, data: student }

  const { data: manager } = await supabase
    .from('cm_managers')
    .select('id, name, nfc_uid, active')
    .eq('nfc_uid', uid)
    .single()

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
