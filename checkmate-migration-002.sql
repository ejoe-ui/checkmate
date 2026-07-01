-- CheckMate Migration 002
-- Run in Supabase → SQL Editor
-- Adds returned_by_manager_id to track who confirmed the return
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE cm_checkouts
  ADD COLUMN IF NOT EXISTS returned_by_manager_id uuid REFERENCES cm_managers(id);
