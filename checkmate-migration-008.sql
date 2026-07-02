-- CheckMate Migration 008
-- Run in Supabase → SQL Editor
-- Adds condition tracking columns to cm_equipment
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cm_equipment
  ADD COLUMN IF NOT EXISTS condition_notes       text,
  ADD COLUMN IF NOT EXISTS condition_updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS condition_updated_by  text;
