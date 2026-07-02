-- CheckMate Migration 005
-- Run in Supabase → SQL Editor
-- Adds approved_by to cm_checkouts; refreshes view with condition_out_notes + approved_by
-- ─────────────────────────────────────────────────────────────────────────────

-- ── cm_checkouts: approved_by ─────────────────────────────────────────────────
ALTER TABLE cm_checkouts
  ADD COLUMN IF NOT EXISTS approved_by text;

-- ── cm_checkouts: condition_out_notes (may already exist — safe to re-run) ───
ALTER TABLE cm_checkouts
  ADD COLUMN IF NOT EXISTS condition_out_notes text;

-- ── Recreate cm_open_checkouts view with all fields ──────────────────────────
-- Adds condition_out_notes and approved_by that were missing from migration-003 view.
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
  co.condition_out,
  co.condition_out_notes,
  co.approved_by,
  s.name                    AS student_name,
  s.nfc_uid                 AS student_nfc_uid,
  s.class_group,
  s.email                   AS student_email,
  s.phone                   AS student_phone,
  s.photo_url               AS student_photo_url,
  s.photo_available         AS student_photo_available,
  s.equipment_form_status,
  e.name                    AS equipment_name,
  e.category                AS equipment_category,
  e.status                  AS equipment_status,
  e.serial_number,
  e.asset_id,
  e.storage_location,
  e.replacement_cost,
  m.name                    AS manager_name
FROM cm_checkouts co
JOIN cm_students  s ON s.id = co.student_id
JOIN cm_equipment e ON e.id = co.equipment_id
JOIN cm_managers  m ON m.id = co.manager_id
WHERE co.checked_in_at IS NULL;

-- ── Grant anon access to updated view (RLS is unrestricted) ──────────────────
GRANT SELECT ON cm_open_checkouts TO anon;
