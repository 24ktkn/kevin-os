-- =========================================================================
-- Kevin-OS: OS Upgrades Migration
-- Adds: portfolio_entries (CaRMS Log), os_digests (Morning Brief & Weekly Review),
--       and os_settings (Wake cutoff 06:00, ntfy.sh iPhone push, Taper days)
-- Run once in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/lqjdolzbzxrqlpykospy/sql/new
-- =========================================================================

-- 1. Med School Portfolio / CaRMS Activity Log
CREATE TABLE IF NOT EXISTS public.portfolio_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL DEFAULT 'clinical', -- clinical | research | volunteering | leadership | teaching | shadowing | award | extracurricular
    title TEXT NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '', -- YYYY-MM-DD
    end_date TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD or empty if ongoing
    is_ongoing BOOLEAN NOT NULL DEFAULT TRUE,
    hours NUMERIC NOT NULL DEFAULT 0,
    verifier_name TEXT NOT NULL DEFAULT '',
    verifier_contact TEXT NOT NULL DEFAULT '',
    canmeds_roles TEXT[] NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    carms_bullets TEXT[] NOT NULL DEFAULT '{}',
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_entries_category ON public.portfolio_entries (category);
CREATE INDEX IF NOT EXISTS idx_portfolio_entries_start_date ON public.portfolio_entries (start_date DESC);

-- 2. Cached Morning Briefs & Sunday Weekly Executive Reviews
CREATE TABLE IF NOT EXISTS public.os_digests (
    id TEXT PRIMARY KEY, -- e.g. 'morning:2026-11-22' or 'weekly:2026-11-22'
    digest_type TEXT NOT NULL, -- morning | weekly
    date TEXT NOT NULL, -- YYYY-MM-DD (America/New_York)
    headline TEXT NOT NULL DEFAULT '',
    summary_text TEXT NOT NULL DEFAULT '',
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    pushed_via_ntfy BOOLEAN NOT NULL DEFAULT FALSE,
    pushed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_os_digests_type_date ON public.os_digests (digest_type, date DESC);

-- 3. Global Kevin-OS Automation Settings
CREATE TABLE IF NOT EXISTS public.os_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    wake_cutoff_time TEXT NOT NULL DEFAULT '06:00', -- HH:MM 24h ET (6:00 AM or earlier auto-checks Wake Up On Time)
    gym_min_duration_mins INT NOT NULL DEFAULT 20,
    gym_min_calories INT NOT NULL DEFAULT 150,
    ntfy_topic TEXT NOT NULL DEFAULT '',
    ntfy_server TEXT NOT NULL DEFAULT 'https://ntfy.sh',
    morning_brief_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    exam_taper_days INT NOT NULL DEFAULT 7,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.os_settings (id, wake_cutoff_time)
VALUES ('default', '06:00')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS & public policies matching Kevin-OS tables
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'portfolio_entries',
        'os_digests',
        'os_settings'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Allow public read on %I" ON public.%I;', tbl, tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Allow public insert on %I" ON public.%I;', tbl, tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Allow public update on %I" ON public.%I;', tbl, tbl);
        EXECUTE format('DROP POLICY IF EXISTS "Allow public delete on %I" ON public.%I;', tbl, tbl);
        EXECUTE format('CREATE POLICY "Allow public read on %I" ON public.%I FOR SELECT USING (true);', tbl, tbl);
        EXECUTE format('CREATE POLICY "Allow public insert on %I" ON public.%I FOR INSERT WITH CHECK (true);', tbl, tbl);
        EXECUTE format('CREATE POLICY "Allow public update on %I" ON public.%I FOR UPDATE USING (true);', tbl, tbl);
        EXECUTE format('CREATE POLICY "Allow public delete on %I" ON public.%I FOR DELETE USING (true);', tbl, tbl);
    END LOOP;
END $$;
