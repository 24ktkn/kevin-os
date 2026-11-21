-- =========================================================================
-- Kevin-OS: Anki × Gemini × NotebookLM Cloud Mirror & Sync Schema
-- Run this once in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/lqjdolzbzxrqlpykospy/sql/new
-- =========================================================================

-- 0. Ensure 'anki' habit column exists on habits
ALTER TABLE IF EXISTS public.habits ADD COLUMN IF NOT EXISTS anki BOOLEAN DEFAULT FALSE;

-- 1. Daily Anki Statistics & History (for Home, /anki Heatmap, Trends, Biometrics × Retention & Habit Auto-Check)
CREATE TABLE IF NOT EXISTS public.anki_daily_stats (
    date TEXT PRIMARY KEY, -- YYYY-MM-DD (America/New_York 4 AM productivity day)
    reviews_today INT NOT NULL DEFAULT 0,
    new_done_today INT NOT NULL DEFAULT 0,
    review_due_remaining INT NOT NULL DEFAULT 0,
    learning_remaining INT NOT NULL DEFAULT 0,
    new_remaining INT NOT NULL DEFAULT 0,
    total_due_remaining INT NOT NULL DEFAULT 0, -- review_due_remaining + learning_remaining
    study_time_secs INT NOT NULL DEFAULT 0,
    avg_secs_per_card NUMERIC NOT NULL DEFAULT 8.5,
    retention_pct NUMERIC NOT NULL DEFAULT 0,
    mature_retention_pct NUMERIC NOT NULL DEFAULT 0,
    again_count INT NOT NULL DEFAULT 0,
    hard_count INT NOT NULL DEFAULT 0,
    good_count INT NOT NULL DEFAULT 0,
    easy_count INT NOT NULL DEFAULT 0,
    streak_days INT NOT NULL DEFAULT 0,
    total_cards INT NOT NULL DEFAULT 0,
    active_cards INT NOT NULL DEFAULT 0,
    suspended_cards INT NOT NULL DEFAULT 0,
    mature_cards INT NOT NULL DEFAULT 0,
    leech_cards INT NOT NULL DEFAULT 0,
    deck_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
    forecast_30d JSONB NOT NULL DEFAULT '[]'::jsonb,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anki_daily_stats_date ON public.anki_daily_stats (date DESC);

-- 2. Searchable Mirror of Your Anki Cards (3,000-5,000 Schulich Cloze/Basic cards = ~5-10 MB)
CREATE TABLE IF NOT EXISTS public.anki_cards (
    card_id BIGINT PRIMARY KEY,
    note_id BIGINT NOT NULL,
    deck_name TEXT NOT NULL,
    model_name TEXT NOT NULL DEFAULT 'Cloze',
    ord INT NOT NULL DEFAULT 0,
    front_html TEXT NOT NULL DEFAULT '',
    back_html TEXT NOT NULL DEFAULT '',
    front_text TEXT NOT NULL DEFAULT '',
    back_text TEXT NOT NULL DEFAULT '',
    extra_text TEXT NOT NULL DEFAULT '',
    fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    tags TEXT[] NOT NULL DEFAULT '{}',
    suspended BOOLEAN NOT NULL DEFAULT FALSE,
    buried BOOLEAN NOT NULL DEFAULT FALSE,
    queue INT NOT NULL DEFAULT 0, -- -1=suspended, -2/-3=buried, 0=new, 1/3=learning, 2=review
    card_type INT NOT NULL DEFAULT 0, -- 0=new, 1=learning, 2=review, 3=relearning
    due_value BIGINT NOT NULL DEFAULT 0,
    due_date TEXT, -- YYYY-MM-DD when review card is due
    interval_days INT NOT NULL DEFAULT 0,
    ease_factor INT NOT NULL DEFAULT 2500,
    reps INT NOT NULL DEFAULT 0,
    lapses INT NOT NULL DEFAULT 0,
    is_leech BOOLEAN GENERATED ALWAYS AS (lapses >= 4) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anki_cards_deck ON public.anki_cards (deck_name);
CREATE INDEX IF NOT EXISTS idx_anki_cards_note_id ON public.anki_cards (note_id);
CREATE INDEX IF NOT EXISTS idx_anki_cards_suspended ON public.anki_cards (suspended);
CREATE INDEX IF NOT EXISTS idx_anki_cards_queue ON public.anki_cards (queue);
CREATE INDEX IF NOT EXISTS idx_anki_cards_due_date ON public.anki_cards (due_date);
CREATE INDEX IF NOT EXISTS idx_anki_cards_lapses ON public.anki_cards (lapses DESC);
CREATE INDEX IF NOT EXISTS idx_anki_cards_tags ON public.anki_cards USING GIN (tags);

-- 3. Cloud-to-Anki Action Queue (Guaranteed offline-safe writes flushed by Windows Anki Bridge)
CREATE TABLE IF NOT EXISTS public.anki_action_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type TEXT NOT NULL, -- add_note | unsuspend_cards | suspend_cards | answer_card | update_tags | edit_note | trigger_sync
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | applied | failed
    source TEXT NOT NULL DEFAULT 'kevin_os_ui', -- gemini_mcp | kevin_os_ui | school_sync | approval_inbox
    error_message TEXT,
    result_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_anki_action_queue_status ON public.anki_action_queue (status, created_at ASC);

-- 4. 1-Click Approval Inbox (Gemini / NotebookLM Staged Proposals)
CREATE TABLE IF NOT EXISTS public.anki_staged_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_type TEXT NOT NULL, -- new_cards | unsuspend_cards | suspend_cards
    title TEXT NOT NULL,
    source_label TEXT NOT NULL DEFAULT 'Gemini / NotebookLM',
    deck_name TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    reasoning TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_anki_staged_proposals_status ON public.anki_staged_proposals (status, created_at DESC);

-- 5. Bridge Health, Auto-Habit Rule & Exam Countdown Targets
CREATE TABLE IF NOT EXISTS public.anki_sync_state (
    id TEXT PRIMARY KEY DEFAULT 'default',
    last_heartbeat_at TIMESTAMPTZ,
    last_full_sync_at TIMESTAMPTZ,
    last_ankiweb_sync_at TIMESTAMPTZ,
    bridge_version TEXT NOT NULL DEFAULT '1.0.0',
    auto_habit_rule TEXT NOT NULL DEFAULT 'zero_review_learning', -- zero_review_learning | min_reviews
    auto_habit_min_reviews INT NOT NULL DEFAULT 50,
    default_deck TEXT NOT NULL DEFAULT 'Schulich',
    default_model TEXT NOT NULL DEFAULT 'Cloze',
    exam_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.anki_sync_state (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS & policies matching Kevin-OS tables
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'anki_daily_stats',
        'anki_cards',
        'anki_action_queue',
        'anki_staged_proposals',
        'anki_sync_state'
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
