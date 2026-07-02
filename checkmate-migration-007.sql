-- CheckMate Migration 007
-- Run in Supabase → SQL Editor
-- Adds passable_id to cm_students for stable re-sync matching by Aeries student ID
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cm_students
  ADD COLUMN IF NOT EXISTS passable_id text;

-- Unique index so we can match safely on re-sync (nulls are excluded from unique checks)
CREATE UNIQUE INDEX IF NOT EXISTS cm_students_passable_id_idx
  ON cm_students (passable_id)
  WHERE passable_id IS NOT NULL;
