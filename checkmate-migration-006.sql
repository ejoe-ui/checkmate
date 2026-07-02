-- CheckMate Migration 006
-- Run in Supabase → SQL Editor
-- Adds temp_pass form status and temp_access_expires_at for 1-day equipment passes
-- ─────────────────────────────────────────────────────────────────────────────

-- ── cm_students: add temp_access_expires_at ───────────────────────────────────
ALTER TABLE cm_students
  ADD COLUMN IF NOT EXISTS temp_access_expires_at timestamptz;

-- ── cm_students: add temp_pass to equipment_form_status CHECK ─────────────────
-- Drop old constraint, re-add with temp_pass included.
ALTER TABLE cm_students
  DROP CONSTRAINT IF EXISTS cm_students_equipment_form_status_check;

ALTER TABLE cm_students
  ADD CONSTRAINT cm_students_equipment_form_status_check
  CHECK (equipment_form_status IN ('form_on_file', 'no_form', 'pending', 'restricted', 'temp_pass'));
