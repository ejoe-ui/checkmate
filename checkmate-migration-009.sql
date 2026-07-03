-- Migration 009: Add notes column to cm_students
-- Run in Supabase SQL editor

ALTER TABLE cm_students
  ADD COLUMN IF NOT EXISTS notes text;
