-- CheckMate Migration 001
-- Run this in Supabase → SQL Editor
-- Adds contact info to students and checkout context fields
-- ─────────────────────────────────────────────────────────────────────────────

-- cm_students: contact info
ALTER TABLE cm_students
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;

-- cm_checkouts: context fields
ALTER TABLE cm_checkouts
  ADD COLUMN IF NOT EXISTS reason      text,   -- e.g. "Class project", "News broadcast"
  ADD COLUMN IF NOT EXISTS teacher_name text,  -- for students not in manager's class
  ADD COLUMN IF NOT EXISTS class_name   text;  -- period / course name

-- Recreate cm_open_checkouts view to expose new fields
DROP VIEW IF EXISTS cm_open_checkouts;
CREATE VIEW cm_open_checkouts AS
SELECT
  co.id,
  co.equipment_id,
  co.student_id,
  co.manager_id,
  co.checked_out_at,
  co.due_at,
  co.reason,
  co.teacher_name,
  co.class_name,
  s.name         AS student_name,
  s.nfc_uid      AS student_nfc_uid,
  s.class_group,
  s.email        AS student_email,
  s.phone        AS student_phone,
  e.name         AS equipment_name,
  e.category     AS equipment_category,
  e.status       AS equipment_status,
  m.name         AS manager_name
FROM cm_checkouts co
JOIN cm_students  s ON s.id = co.student_id
JOIN cm_equipment e ON e.id = co.equipment_id
JOIN cm_managers  m ON m.id = co.manager_id
WHERE co.checked_in_at IS NULL;
