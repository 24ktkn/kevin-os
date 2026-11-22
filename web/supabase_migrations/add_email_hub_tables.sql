-- ============================================================================
-- Kevin-OS Unified Email Hub (Gmail API + Microsoft Graph + Thunderbird Bridge)
-- Run once in Supabase SQL Editor
-- ============================================================================

-- 1. Connected email accounts across Gmail, Hotmail/Outlook.com, and Thunderbird (@uwo.ca)
CREATE TABLE IF NOT EXISTS public.email_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'microsoft', 'thunderbird')),
  email_address TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  account_label TEXT NOT NULL DEFAULT '',
  provider_account_id TEXT,
  identity_id TEXT,
  oauth_refresh_token TEXT,
  oauth_access_token TEXT,
  oauth_expires_at TIMESTAMPTZ,
  folders_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  permission_mode TEXT NOT NULL DEFAULT 'full_send' CHECK (permission_mode IN ('read', 'draft_triage', 'full_send')),
  auto_send_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  auto_delete_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_sync_device TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_provider ON public.email_accounts (provider);

-- 2. Unified email message cache/mirror across all connected accounts
CREATE TABLE IF NOT EXISTS public.email_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'microsoft', 'thunderbird')),
  account_email TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  thread_id TEXT,
  folder_id TEXT,
  folder_name TEXT NOT NULL DEFAULT 'Inbox',
  folder_type TEXT NOT NULL DEFAULT 'inbox',
  subject TEXT NOT NULL DEFAULT '(No Subject)',
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  date_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  labels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_account_date ON public.email_messages (account_id, date_iso DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_folder_date ON public.email_messages (folder_type, date_iso DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_unread ON public.email_messages (is_read, date_iso DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_provider_msg ON public.email_messages (account_id, provider_message_id);

-- 3. Unified Email Approval Inbox & Execution Queue (Cloud + Thunderbird Bridge)
CREATE TABLE IF NOT EXISTS public.email_actions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  account_email TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'microsoft', 'thunderbird')),
  action_type TEXT NOT NULL CHECK (
    action_type IN (
      'draft',
      'reply_draft',
      'send',
      'reply_send',
      'archive',
      'move',
      'delete',
      'mark_read',
      'mark_unread',
      'star',
      'unstar'
    )
  ),
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (
    status IN ('pending_approval', 'queued', 'claimed', 'executed', 'rejected', 'failed')
  ),
  source TEXT NOT NULL DEFAULT 'gemini_mcp',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NOT NULL DEFAULT '',
  device_claim_id TEXT,
  claimed_at TIMESTAMPTZ,
  result_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_actions_status_provider ON public.email_actions (status, provider, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_email_actions_created ON public.email_actions (created_at DESC);

-- 4. Server-side Email OAuth & Safety Config (e.g. optional Microsoft Azure Client ID + Global Safety Defaults)
CREATE TABLE IF NOT EXISTS public.email_oauth_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  microsoft_client_id TEXT,
  microsoft_client_secret TEXT,
  require_approval_for_send BOOLEAN NOT NULL DEFAULT TRUE,
  require_approval_for_delete BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.email_oauth_config (id, require_approval_for_send, require_approval_for_delete)
VALUES ('default', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS (Server API routes use service role or server-side client; restrict anon direct exposure of OAuth tokens)
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_oauth_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_accounts' AND policyname = 'Allow service all on email_accounts') THEN
    CREATE POLICY "Allow service all on email_accounts" ON public.email_accounts FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_messages' AND policyname = 'Allow service all on email_messages') THEN
    CREATE POLICY "Allow service all on email_messages" ON public.email_messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_actions' AND policyname = 'Allow service all on email_actions') THEN
    CREATE POLICY "Allow service all on email_actions" ON public.email_actions FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_oauth_config' AND policyname = 'Allow service all on email_oauth_config') THEN
    CREATE POLICY "Allow service all on email_oauth_config" ON public.email_oauth_config FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
