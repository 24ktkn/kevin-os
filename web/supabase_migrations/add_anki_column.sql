-- Migration: Add Anki daily habit column to habits table
ALTER TABLE habits ADD COLUMN IF NOT EXISTS anki BOOLEAN DEFAULT false;
