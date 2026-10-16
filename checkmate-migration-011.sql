-- CheckMate Migration 011
-- Run in Supabase → SQL Editor (hall-pass project)
-- One-time check for card conflicts, then a guardrail so a card can't be
-- on two student records again.
-- ─────────────────────────────────────────────────────────────────────────────

-- CHECK 1: Same card on two student records (ignores capitalization).
-- Fix any hits with the new "Delete student" button in CheckMate Admin.
-- Delete the one where passable_id is blank (the hand-added copy).
SELECT upper(nfc_uid) AS card, id, name, nfc_uid, passable_id
FROM cm_students
WHERE upper(nfc_uid) IN (
  SELECT upper(nfc_uid) FROM cm_students
  WHERE nfc_uid IS NOT NULL
  GROUP BY upper(nfc_uid) HAVING count(*) > 1
)
ORDER BY card, passable_id NULLS FIRST;

-- CHECK 2: Same card used by a student AND equipment or a manager badge.
-- (This is what happened with Layali and "Test Item".)
-- Fix by clearing the card from whichever record shouldn't have it.
SELECT 'student' AS kind, s.name, s.nfc_uid, 'equipment' AS also_on, e.name AS other_name
FROM cm_students s JOIN cm_equipment e ON upper(e.nfc_uid) = upper(s.nfc_uid)
UNION ALL
SELECT 'student', s.name, s.nfc_uid, 'manager', m.name
FROM cm_students s JOIN cm_managers m ON upper(m.nfc_uid) = upper(s.nfc_uid)
UNION ALL
SELECT 'equipment', e.name, e.nfc_uid, 'manager', m.name
FROM cm_equipment e JOIN cm_managers m ON upper(m.nfc_uid) = upper(e.nfc_uid);

-- GUARDRAIL: run this once CHECK 1 returns no rows.
-- (If it errors with "could not create unique index", CHECK 1 still has hits.)
CREATE UNIQUE INDEX IF NOT EXISTS cm_students_nfc_uid_ci_idx
  ON cm_students (upper(nfc_uid))
  WHERE nfc_uid IS NOT NULL;
