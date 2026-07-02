-- CheckMate Migration 003
-- Run in Supabase → SQL Editor
-- Adds accountability fields: photo, form status, condition tracking, overdue notes, asset details
-- ─────────────────────────────────────────────────────────────────────────────

-- ── cm_students: photo + form tracking ──────────────────────────────────────
ALTER TABLE cm_students
  ADD COLUMN IF NOT EXISTS photo_url               text,
  ADD COLUMN IF NOT EXISTS photo_available         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS equipment_form_status   text    DEFAULT 'no_form'
    CHECK (equipment_form_status IN ('form_on_file', 'no_form', 'pending', 'restricted')),
  ADD COLUMN IF NOT EXISTS media_directory_opt_out boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at          timestamptz;

-- ── cm_equipment: asset detail fields ───────────────────────────────────────
ALTER TABLE cm_equipment
  ADD COLUMN IF NOT EXISTS serial_number     text,
  ADD COLUMN IF NOT EXISTS asset_id          text,
  ADD COLUMN IF NOT EXISTS storage_location  text,
  ADD COLUMN IF NOT EXISTS replacement_cost  numeric(10,2),
  ADD COLUMN IF NOT EXISTS equipment_notes   text;

-- ── cm_checkouts: condition tracking ────────────────────────────────────────
ALTER TABLE cm_checkouts
  ADD COLUMN IF NOT EXISTS condition_out   text DEFAULT 'good'
    CHECK (condition_out IN ('good', 'fair', 'poor', 'damaged')),
  ADD COLUMN IF NOT EXISTS condition_in    text
    CHECK (condition_in IN ('returned_ok', 'returned_with_issue', 'missing_accessory', 'damaged', 'needs_inspection')),
  ADD COLUMN IF NOT EXISTS condition_notes text;

-- ── cm_overdue_notes: contact log for overdue items ─────────────────────────
CREATE TABLE IF NOT EXISTS cm_overdue_notes (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  checkout_id    uuid REFERENCES cm_checkouts(id) ON DELETE CASCADE,
  student_id     uuid REFERENCES cm_students(id)  ON DELETE CASCADE,
  manager_id     uuid REFERENCES cm_managers(id),
  note           text NOT NULL,
  action         text CHECK (action IN ('contacted', 'extended_due', 'marked_resolved', 'other')),
  extended_due_at timestamptz,
  created_at     timestamptz DEFAULT now()
);

-- ── Recreate cm_open_checkouts view with all new fields ─────────────────────
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
