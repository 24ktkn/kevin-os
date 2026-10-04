-- =========================================================================
-- Kevin-OS: Complete Google Sheets Elimination & Supabase Migration Schema
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/lqjdolzbzxrqlpykospy/sql/new
-- =========================================================================

-- 1. Ensure 'anki' column exists on habits
ALTER TABLE IF EXISTS public.habits ADD COLUMN IF NOT EXISTS anki BOOLEAN DEFAULT FALSE;

-- 2. Workout Logs Table (Hevy Import & Gym Progressions)
CREATE TABLE IF NOT EXISTS public.workout_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    split_day TEXT NOT NULL DEFAULT 'General Training',
    exercise TEXT NOT NULL,
    set_number INT NOT NULL DEFAULT 1,
    weight_lbs NUMERIC NOT NULL DEFAULT 0,
    reps INT NOT NULL DEFAULT 0,
    estimated_1rm NUMERIC NOT NULL DEFAULT 0,
    timestamp TEXT DEFAULT '12:00:00',
    duration_mins NUMERIC DEFAULT 0,
    gym_duration_mins NUMERIC DEFAULT 60,
    distance_km NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes for Workout Logs
CREATE INDEX IF NOT EXISTS idx_workout_logs_date ON public.workout_logs (date DESC);
CREATE INDEX IF NOT EXISTS idx_workout_logs_exercise ON public.workout_logs (exercise);
CREATE INDEX IF NOT EXISTS idx_workout_logs_split ON public.workout_logs (split_day);

-- Enable RLS and public policies for workout_logs
ALTER TABLE public.workout_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on workout_logs" ON public.workout_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert on workout_logs" ON public.workout_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on workout_logs" ON public.workout_logs FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on workout_logs" ON public.workout_logs FOR DELETE USING (true);

-- 3. Costco Meal Prep & Grocery Items Table
CREATE TABLE IF NOT EXISTS public.costco_meal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip TEXT NOT NULL DEFAULT 'Trip 1',
    department TEXT NOT NULL DEFAULT 'General',
    item_name TEXT NOT NULL,
    target_scale_size TEXT DEFAULT '',
    meal_assignment TEXT DEFAULT '',
    is_checked BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS and public policies for costco_meal_items
ALTER TABLE public.costco_meal_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on costco_meal_items" ON public.costco_meal_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert on costco_meal_items" ON public.costco_meal_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on costco_meal_items" ON public.costco_meal_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on costco_meal_items" ON public.costco_meal_items FOR DELETE USING (true);
