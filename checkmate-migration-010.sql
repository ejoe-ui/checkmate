-- CheckMate Migration 010
-- Run in Supabase → SQL Editor
-- Adds parent-child kit relationship to cm_equipment
-- ─────────────────────────────────────────────────────────────────────────────
-- Each piece of equipment can optionally belong to a container (kit bag).
-- parent_container_id → the id of a cm_equipment row where is_container = true.
-- NULL means the item is standalone (not part of any kit).
--
-- This replaces any prior cm_kit_contents junction table approach.
-- Items can be dynamically reassigned between kits by updating this FK.

ALTER TABLE cm_equipment
  ADD COLUMN IF NOT EXISTS parent_container_id uuid
    REFERENCES cm_equipment(id) ON DELETE SET NULL;

-- Index for fast child lookups (finding all items in a kit bag)
CREATE INDEX IF NOT EXISTS idx_cm_equipment_parent
  ON cm_equipment(parent_container_id)
  WHERE parent_container_id IS NOT NULL;
