-- CheckMate Migration 004
-- Run in Supabase → SQL Editor
-- Adds photo_url to equipment; updates condition_out values to match UI
-- ─────────────────────────────────────────────────────────────────────────────

-- ── cm_equipment: add photo_url ───────────────────────────────────────────────
ALTER TABLE cm_equipment
  ADD COLUMN IF NOT EXISTS photo_url text;

-- ── cm_checkouts: update condition_out check constraint ───────────────────────
-- Drop old constraint (added in migration-003 with 'good','fair','poor','damaged')
ALTER TABLE cm_checkouts
  DROP CONSTRAINT IF EXISTS cm_checkouts_condition_out_check;

-- Add new constraint matching the checkout UI options
ALTER TABLE cm_checkouts
  ADD CONSTRAINT cm_checkouts_condition_out_check
  CHECK (condition_out IN ('good', 'minor_wear', 'missing_part', 'existing_damage', 'needs_inspection'));
