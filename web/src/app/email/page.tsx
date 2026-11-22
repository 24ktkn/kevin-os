'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Archive,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  Inbox,
  Laptop,
  Mail,
  MailOpen,
  PenSquare,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  EmailAccountPublic,
  EmailActionRecord,
  EmailFolderType,
  EmailMessageRecord,
  EmailSafetyConfigPublic,
} from '@/types/email';

type ActiveTab = 'inbox' | 'approvals' | 'setup';

function providerBadge(provider: string) {
  if (provider === 'gmail') {
    return {
      label: 'Gmail Cloud',
      cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    };
  }
  if (provider === 'microsoft') {
    return {
      label: 'Hotmail Cloud',
      cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    };
  }
  return {
    label: 'Thunderbird Bridge',
    cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  };
}

function formatShortDate(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function EmailHubPage() {
  const [tab, setTab] = useState<ActiveTab>('inbox');
  const [accounts, setAccounts] = useState<EmailAccountPublic[]>([]);
  const [safetyConfig, setSafetyConfig] = useState<EmailSafetyConfigPublic | null>(null);
  const [bridgeToken, setBridgeToken] = useState('');
  const [needsMigration, setNeedsMigration] = useState(false);

  const [messages, setMessages] = useState<EmailMessageRecord[]>([]);
  const [actions, setActions] = useState<EmailActionRecord[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<EmailMessageRecord | null>(null);
  const [selectedThread, setSelectedThread] = useState<EmailMessageRecord[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [syncingCloud, setSyncingCloud] = useState(false);

  // Filters
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [folderFilter, setFolderFilter] = useState<EmailFolderType | 'all'>('inbox');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Reply / Compose
  const [replyText, setReplyText] = useState('');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [moveFolderInput, setMoveFolderInput] = useState('');
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeAccount, setComposeAccount] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Setup state
  const [gmailAuthUrl, setGmailAuthUrl] = useState('');
  const [gmailCodeInput, setGmailCodeInput] = useState('');
  const [gmailLabelInput, setGmailLabelInput] = useState('');
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [msClientIdInput, setMsClientIdInput] = useState('');
  const [msClientSecretInput, setMsClientSecretInput] = useState('');
  const [msRedirectUri, setMsRedirectUri] = useState(
    'https://kevin-os-xr4m.vercel.app/api/email/oauth/microsoft/callback'
  );
  const [savingMsCfg, setSavingMsCfg] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Approval editing
  const [editingActionBodies, setEditingActionBodies] = useState<Record<string, string>>({});

  const flash = useCallback((type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 7000);
  }, []);

  const copyText = (key: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const loadAccountsAndActions = useCallback(async () => {
    const [accRes, actRes, gmailRes] = await Promise.all([
      fetch('/api/email/accounts').then((r) => r.json()).catch(() => null),
      fetch('/api/email/actions?limit=50').then((r) => r.json()).catch(() => null),
      fetch('/api/email/oauth/gmail').then((r) => r.json()).catch(() => null),
    ]);

    if (accRes?.success) {
      setAccounts(accRes.accounts || []);
      setSafetyConfig(accRes.safetyConfig || null);
      setBridgeToken(accRes.bridgeToken || '');
      setNeedsMigration(Boolean(accRes.needsMigration));
      if (accRes.accounts?.length > 0) {
        setComposeAccount((prev) => prev || accRes.accounts[0].id);
      }
      if (!accRes.accounts?.length && !accRes.needsMigration) {
        setTab((prev) => (prev === 'inbox' ? 'setup' : prev));
      }
    }
    if (actRes?.success) {
      setActions(actRes.actions || []);
    }
    if (gmailRes?.authUrl) {
      setGmailAuthUrl(gmailRes.authUrl);
    }
  }, []);

  const loadMessages = useCallback(
    async (live = false) => {
      setLoadingInbox(true);
      try {
        const sp = new URLSearchParams();
        if (accountFilter !== 'all') sp.set('account', accountFilter);
        sp.set('folder', folderFilter);
        if (unreadOnly) sp.set('unreadOnly', 'true');
        if (searchQuery.trim()) sp.set('q', searchQuery.trim());
        if (live) sp.set('live', 'true');
        sp.set('limit', '50');

        const res = await fetch(`/api/email/messages?${sp.toString()}`).then((r) => r.json());
        if (res?.success) {
          setMessages(res.messages || []);
          if (res.accounts) setAccounts(res.accounts);
          setNeedsMigration(Boolean(res.needsMigration));
        }
      } finally {
        setLoadingInbox(false);
      }
    },
    [accountFilter, folderFilter, unreadOnly, searchQuery]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (typeof window !== 'undefined') {
        setMsRedirectUri(`${window.location.origin}/api/email/oauth/microsoft/callback`);
        const sp = new URLSearchParams(window.location.search);
        const msStatus = sp.get('ms_status');
        const msMsg = sp.get('ms_msg');
        if (msStatus === 'connected') {
          flash('ok', `Connected Hotmail / Outlook account: ${msMsg || 'ready!'}`);
          window.history.replaceState({}, '', '/email');
        } else if (msStatus === 'error') {
          flash('err', `Hotmail OAuth error: ${msMsg || 'Please retry.'}`);
          setTab('setup');
          window.history.replaceState({}, '', '/email');
        }
      }
      void loadAccountsAndActions();
    }, 0);
    return () => clearTimeout(t);
  }, [loadAccountsAndActions, flash]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadMessages(false);
    }, 0);
    return () => clearTimeout(t);
  }, [loadMessages]);

  const handleOpenMessage = async (msg: EmailMessageRecord) => {
    setSelectedMsg(msg);
    setSelectedThread([msg]);
    setReplyText('');
    setShowMoveBox(false);
    const res = await fetch(`/api/email/messages?messageId=${encodeURIComponent(msg.id)}`)
      .then((r) => r.json())
      .catch(() => null);
    if (res?.success && res.message) {
      setSelectedMsg(res.message);
      setSelectedThread(res.threadMessages || [res.message]);
    }
  };

  const handleSyncCloud = async () => {
    setSyncingCloud(true);
    try {
      const res = await fetch('/api/email/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_cloud' }),
      }).then((r) => r.json());
      if (res?.success) {
        const count = (res.results || []).reduce(
          (sum: number, r: { syncedCount?: number }) => sum + (r.syncedCount || 0),
          0
        );
        const errs = (res.results || []).filter((r: { error?: string }) => r.error);
        if (errs.length > 0) {
          flash('err', `Synced ${count} cloud emails, with error on ${errs[0].email}: ${errs[0].error}`);
        } else {
          flash('ok', `Synced ${count} emails from Gmail & Hotmail cloud accounts.`);
        }
      }
      await Promise.all([loadMessages(false), loadAccountsAndActions()]);
    } finally {
      setSyncingCloud(false);
    }
  };

  const runEmailAction = async (
    actionType:
      | 'draft'
      | 'reply_draft'
      | 'send'
      | 'reply_send'
      | 'archive'
      | 'move'
      | 'delete'
      | 'mark_read'
      | 'mark_unread'
      | 'star'
      | 'unstar',
    payload: Record<string, unknown>,
    accountHint?: string
  ) => {
    setSubmittingAction(true);
    try {
      const res = await fetch('/api/email/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: accountHint,
          actionType,
          payload,
          source: 'kevin_os_ui',
        }),
      }).then((r) => r.json());

      if (res?.success) {
        flash('ok', res.message || `Action ${actionType} complete!`);
        await Promise.all([loadMessages(false), loadAccountsAndActions()]);
        return true;
      } else {
        flash('err', res?.error || 'Email action failed.');
        return false;
      }
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleAiDraftReply = async () => {
    if (!selectedMsg) return;
    setAiDrafting(true);
    try {
      const res = await fetch('/api/email/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ai_draft_reply',
          messageId: selectedMsg.id,
        }),
      }).then((r) => r.json());
      if (res?.success && res.draftText) {
        setReplyText(res.draftText);
      } else {
        flash('err', res?.error || 'Could not generate AI reply.');
      }
    } finally {
      setAiDrafting(false);
    }
  };

  const handleDecision = async (actionId: string, decision: 'approve' | 'reject') => {
    const editedBody = editingActionBodies[actionId];
    const res = await fetch('/api/email/actions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionId,
        decision,
        ...(typeof editedBody === 'string' ? { editedPayload: { bodyText: editedBody } } : {}),
      }),
    }).then((r) => r.json());

    if (res?.success) {
      flash(
        'ok',
        decision === 'approve'
          ? `Approved! Status: ${res.action?.status || 'executed'}`
          : 'Rejected action.'
      );
      await Promise.all([loadAccountsAndActions(), loadMessages(false)]);
    } else {
      flash('err', res?.error || 'Action update failed.');
    }
  };

  const handleConnectGmail = async () => {
    if (!gmailCodeInput.trim()) {
      flash('err', 'Paste the Google redirect URL or code first.');
      return;
    }
    setConnectingGmail(true);
    try {
      const res = await fetch('/api/email/oauth/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenOrCode: gmailCodeInput.trim(),
          accountLabel: gmailLabelInput.trim() || undefined,
        }),
      }).then((r) => r.json());
      if (res?.success) {
        flash('ok', `Connected Gmail (${res.emailAddress}) and synced ${res.syncedCount || 0} emails!`);
        setGmailCodeInput('');
        setGmailLabelInput('');
        await Promise.all([loadAccountsAndActions(), loadMessages(false)]);
      } else {
        flash('err', res?.error || 'Failed to connect Gmail.');
      }
    } finally {
      setConnectingGmail(false);
    }
  };

  const handleSaveMicrosoftConfig = async () => {
    setSavingMsCfg(true);
    try {
      const res = await fetch('/api/email/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          microsoft_client_id: msClientIdInput.trim(),
          microsoft_client_secret: msClientSecretInput.trim(),
        }),
      }).then((r) => r.json());
      if (res?.success) {
        flash('ok', 'Saved Microsoft Azure App credentials! Click "Sign In with Hotmail / Outlook" now.');
        setMsClientIdInput('');
        setMsClientSecretInput('');
        await loadAccountsAndActions();
      } else {
        flash('err', res?.error || 'Could not save Microsoft config.');
      }
    } finally {
      setSavingMsCfg(false);
    }
  };

  const handleLaunchMicrosoftSignIn = async () => {
    const res = await fetch('/api/email/oauth/microsoft').then((r) => r.json());
    if (res?.configured && res.authUrl) {
      window.location.href = res.authUrl;
    } else {
      flash('err', res?.error || 'Save your Microsoft Azure Client ID first.');
    }
  };

  const updateAccountSetting = async (
    accountId: string,
    patch: {
      permission_mode?: 'read' | 'draft_triage' | 'full_send';
      auto_send_allowed?: boolean;
      auto_delete_allowed?: boolean;
    }
  ) => {
    const res = await fetch('/api/email/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, ...patch }),
    }).then((r) => r.json());
    if (res?.success) {
      await loadAccountsAndActions();
    } else {
      flash('err', res?.error || 'Failed to update account setting.');
    }
  };

  const removeAccount = async (accountId: string, email: string) => {
    if (!confirm(`Disconnect ${email} from Kevin-OS?`)) return;
    await fetch(`/api/email/accounts?id=${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    await Promise.all([loadAccountsAndActions(), loadMessages(false)]);
    flash('ok', `Disconnected ${email}.`);
  };

  const pendingApprovals = actions.filter((a) => a.status === 'pending_approval');
  const totalUnread = accounts.reduce((acc, a) => acc + (a.unreadCount || 0), 0);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-5">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                Unified Email Hub
              </h1>
              <p className="text-xs text-zinc-400">
                Gmail Cloud · Hotmail Cloud · @uwo.ca Thunderbird Bridge — all drafts &amp; triage sync automatically to Spark Mail
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSyncCloud}
            disabled={syncingCloud}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${syncingCloud ? 'animate-spin' : ''}`} />
            <span>{syncingCloud ? 'Syncing...' : 'Sync Cloud'}</span>
          </button>

          <button
            onClick={() => setComposeOpen(true)}
            disabled={accounts.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-white text-xs font-bold shadow-md transition cursor-pointer disabled:opacity-40"
          >
            <PenSquare className="h-3.5 w-3.5" />
            <span>Compose</span>
          </button>
        </div>
      </header>

      {/* Migration Warning */}
      {needsMigration && (
        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 text-xs text-amber-200 space-y-1">
          <div className="font-bold text-amber-300">One-Time Database Setup Required</div>
          <p>
            Run <code className="px-1.5 py-0.5 rounded bg-black/40 text-amber-200">web/supabase_migrations/add_email_hub_tables.sql</code> in your Supabase SQL Editor, then refresh this page.
          </p>
        </div>
      )}

      {/* Status Toast */}
      {banner && (
        <div
          className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
            banner.type === 'ok'
              ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Mode Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[#14141B] border border-zinc-800/90">
          <button
            onClick={() => setTab('inbox')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              tab === 'inbox' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Inbox className="h-3.5 w-3.5" />
            <span>Unified Inbox</span>
            {totalUnread > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-200 text-[10px] font-mono">
                {totalUnread}
              </span>
            )}
          </button>

          <button
            onClick={() => setTab('approvals')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              tab === 'approvals' ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Gemini Approval Inbox</span>
            {pendingApprovals.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-500/25 text-rose-200 text-[10px] font-mono">
                {pendingApprovals.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setTab('setup')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              tab === 'setup' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>Accounts &amp; Setup ({accounts.length})</span>
          </button>
        </div>

        {/* Account Health Strip */}
        <div className="flex flex-wrap items-center gap-1.5">
          {accounts.map((acc) => {
            const badge = providerBadge(acc.provider);
            return (
              <span
                key={acc.id}
                className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold flex items-center gap-1.5 ${badge.cls}`}
              >
                {acc.provider === 'thunderbird' ? <Laptop className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                <span>{acc.account_label}: {acc.email_address}</span>
                {acc.unreadCount ? <span className="font-mono opacity-80">({acc.unreadCount})</span> : null}
              </span>
            );
          })}
        </div>
      </div>

      {/* ============================================================ */}
      {/* TAB 1: UNIFIED INBOX                                         */}
      {/* ============================================================ */}
      {tab === 'inbox' && (
        <div className="space-y-4">
          {/* Filter & Search Bar */}
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-[#14141B] border border-zinc-800/90">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadMessages(true);
                }}
                placeholder="Search across Gmail, Hotmail & @uwo.ca (Enter for live cloud search)..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Accounts ({accounts.length})</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_label} · {a.email_address}
                </option>
              ))}
            </select>

            <select
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value as EmailFolderType | 'all')}
              className="px-2.5 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="inbox">Inbox</option>
              <option value="drafts">Drafts</option>
              <option value="sent">Sent</option>
              <option value="archive">Archive</option>
              <option value="trash">Trash</option>
              <option value="all">All Folders</option>
            </select>

            <button
              onClick={() => setUnreadOnly((v) => !v)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                unreadOnly
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              Unread Only
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="p-10 rounded-2xl bg-[#14141B] border border-zinc-800/90 text-center space-y-3">
              <Mail className="h-9 w-9 text-cyan-400 mx-auto opacity-80" />
              <div className="text-sm font-bold text-white">No email accounts connected yet</div>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Connect your Gmail (cloud 24/7), Hotmail/Outlook.com (cloud 24/7), and Western/Schulich @uwo.ca (silent Thunderbird bridge) in the Accounts &amp; Setup tab.
              </p>
              <button
                onClick={() => setTab('setup')}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs cursor-pointer"
              >
                Open Setup Guide
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left: Message List */}
              <div className="lg:col-span-5 rounded-2xl bg-[#14141B] border border-zinc-800/90 overflow-hidden flex flex-col max-h-[72vh]">
                <div className="px-3.5 py-2.5 border-b border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>{messages.length} email(s)</span>
                  <button
                    onClick={() => void loadMessages(true)}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>

                <div className="divide-y divide-zinc-800/70 overflow-y-auto flex-1">
                  {loadingInbox ? (
                    <div className="p-6 text-center text-xs text-zinc-500">Loading messages...</div>
                  ) : messages.length === 0 ? (
                    <div className="p-6 text-center text-xs text-zinc-500">No emails match this filter.</div>
                  ) : (
                    messages.map((m) => {
                      const active = selectedMsg?.id === m.id;
                      const badge = providerBadge(m.provider);
                      return (
                        <button
                          key={m.id}
                          onClick={() => void handleOpenMessage(m)}
                          className={`w-full text-left p-3.5 transition cursor-pointer ${
                            active
                              ? 'bg-cyan-500/10 border-l-2 border-cyan-400'
                              : 'hover:bg-zinc-900/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className={`text-xs truncate ${m.is_read ? 'text-zinc-300 font-medium' : 'text-white font-bold'}`}>
                              {!m.is_read && <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 mr-1.5 align-middle" />}
                              {m.from_name || m.from_email}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                              {formatShortDate(m.date_iso)}
                            </span>
                          </div>
                          <div className={`text-xs truncate ${m.is_read ? 'text-zinc-300' : 'text-white font-semibold'}`}>
                            {m.subject}
                          </div>
                          <p className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5">{m.snippet}</p>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold ${badge.cls}`}>
                              {m.account_email.split('@')[0]}
                            </span>
                            <span className="text-[9px] text-zinc-500 uppercase font-mono">{m.folder_name}</span>
                            {m.is_starred && <Star className="h-2.5 w-2.5 text-amber-400 fill-amber-400" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Message Reader + Quick Actions + Reply */}
              <div className="lg:col-span-7 rounded-2xl bg-[#14141B] border border-zinc-800/90 p-4 sm:p-5 flex flex-col justify-between min-h-[520px] max-h-[72vh] overflow-y-auto">
                {!selectedMsg ? (
                  <div className="m-auto text-center text-xs text-zinc-500 space-y-2">
                    <MailOpen className="h-8 w-8 mx-auto opacity-50" />
                    <div>Select an email to read, sort, trash, or draft an AI reply.</div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Reader Top Toolbar */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/80 pb-3">
                      <div className="space-y-1 min-w-0">
                        <h2 className="text-base font-bold text-white leading-snug">{selectedMsg.subject}</h2>
                        <div className="text-xs text-zinc-400">
                          From <span className="text-zinc-200 font-semibold">{selectedMsg.from_name}</span>{' '}
                          <span className="text-zinc-500">&lt;{selectedMsg.from_email}&gt;</span>
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          Account: {selectedMsg.account_email} · {new Date(selectedMsg.date_iso).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() =>
                            void runEmailAction(
                              selectedMsg.is_read ? 'mark_unread' : 'mark_read',
                              { messageIds: [selectedMsg.id] },
                              selectedMsg.account_id
                            )
                          }
                          disabled={submittingAction}
                          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer"
                          title={selectedMsg.is_read ? 'Mark Unread' : 'Mark Read'}
                        >
                          <MailOpen className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            void runEmailAction(
                              selectedMsg.is_starred ? 'unstar' : 'star',
                              { messageIds: [selectedMsg.id] },
                              selectedMsg.account_id
                            )
                          }
                          disabled={submittingAction}
                          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-amber-400 cursor-pointer"
                          title={selectedMsg.is_starred ? 'Unstar' : 'Star'}
                        >
                          <Star className={`h-3.5 w-3.5 ${selectedMsg.is_starred ? 'fill-amber-400' : ''}`} />
                        </button>
                        <button
                          onClick={() =>
                            void runEmailAction('archive', { messageIds: [selectedMsg.id] }, selectedMsg.account_id)
                          }
                          disabled={submittingAction}
                          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer"
                          title="Archive"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setShowMoveBox((v) => !v)}
                          className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer"
                          title="Move to Folder / Label"
                        >
                          <FolderInput className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            void runEmailAction('delete', { messageIds: [selectedMsg.id] }, selectedMsg.account_id)
                          }
                          disabled={submittingAction}
                          className="p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300 cursor-pointer"
                          title="Move to Trash"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {showMoveBox && (
                      <div className="flex items-center gap-2 p-2.5 rounded-xl bg-zinc-950 border border-zinc-800">
                        <input
                          value={moveFolderInput}
                          onChange={(e) => setMoveFolderInput(e.target.value)}
                          placeholder="Folder or Gmail Label name (e.g. School, Receipts)..."
                          className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                        />
                        <button
                          onClick={async () => {
                            if (!moveFolderInput.trim()) return;
                            const ok = await runEmailAction(
                              'move',
                              { messageIds: [selectedMsg.id], targetFolder: moveFolderInput.trim() },
                              selectedMsg.account_id
                            );
                            if (ok) {
                              setMoveFolderInput('');
                              setShowMoveBox(false);
                            }
                          }}
                          className="px-3 py-1 rounded-lg bg-cyan-500 text-black font-bold text-xs cursor-pointer"
                        >
                          Move
                        </button>
                      </div>
                    )}

                    {/* Message Body */}
                    <div className="space-y-3">
                      {selectedThread.map((tm) => (
                        <div
                          key={tm.id}
                          className="p-3.5 rounded-xl bg-[#0D0D13] border border-zinc-800/80 text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed"
                        >
                          {selectedThread.length > 1 && (
                            <div className="text-[10px] text-zinc-500 font-mono mb-2 pb-1.5 border-b border-zinc-800/70">
                              {tm.from_name || tm.from_email} · {new Date(tm.date_iso).toLocaleString()}
                            </div>
                          )}
                          {tm.body_text || tm.snippet || '(Empty message body)'}
                        </div>
                      ))}
                    </div>

                    {/* Quick Reply + AI Draft Box */}
                    <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                          <Reply className="h-3.5 w-3.5 text-cyan-400" />
                          <span>Reply to {selectedMsg.from_email}</span>
                        </span>
                        <button
                          onClick={() => void handleAiDraftReply()}
                          disabled={aiDrafting}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold cursor-pointer"
                        >
                          <Sparkles className={`h-3 w-3 ${aiDrafting ? 'animate-spin' : ''}`} />
                          <span>{aiDrafting ? 'Drafting...' : 'AI Draft Reply'}</span>
                        </button>
                      </div>

                      <textarea
                        rows={4}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write your reply or click AI Draft Reply..."
                        className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500"
                      />

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          onClick={async () => {
                            if (!replyText.trim()) return;
                            const ok = await runEmailAction(
                              'reply_draft',
                              { replyToMessageId: selectedMsg.id, bodyText: replyText },
                              selectedMsg.account_id
                            );
                            if (ok) setReplyText('');
                          }}
                          disabled={submittingAction || !replyText.trim()}
                          className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer disabled:opacity-40"
                        >
                          Save Draft (Syncs to Spark)
                        </button>
                        <button
                          onClick={async () => {
                            if (!replyText.trim()) return;
                            const ok = await runEmailAction(
                              'reply_send',
                              { replyToMessageId: selectedMsg.id, bodyText: replyText },
                              selectedMsg.account_id
                            );
                            if (ok) setReplyText('');
                          }}
                          disabled={submittingAction || !replyText.trim()}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold cursor-pointer disabled:opacity-40"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>Send Reply</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 2: GEMINI APPROVAL INBOX & ACTION LOG                    */}
      {/* ============================================================ */}
      {tab === 'approvals' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#14141B] border border-zinc-800/90 p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-indigo-400" />
                  Pending Approvals ({pendingApprovals.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Gemini Send &amp; Delete proposals wait here for 1-click confirmation unless Auto-Send / Auto-Delete is enabled on that account.
                </p>
              </div>
              <button
                onClick={() => void loadAccountsAndActions()}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
              >
                Refresh
              </button>
            </div>

            {pendingApprovals.length === 0 ? (
              <div className="p-6 rounded-xl bg-zinc-950/60 border border-zinc-800/60 text-center text-xs text-zinc-400 flex flex-col items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-emerald-400 opacity-80" />
                <span>No pending email approvals right now.</span>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((act) => {
                  const p = act.payload_json || {};
                  const isSend = act.action_type === 'send' || act.action_type === 'reply_send';
                  const bodyVal =
                    editingActionBodies[act.id] !== undefined
                      ? editingActionBodies[act.id]
                      : p.bodyText || '';
                  return (
                    <div
                      key={act.id}
                      className="p-4 rounded-xl bg-[#0D0D13] border border-indigo-500/35 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            {act.action_type.replace('_', ' ')}
                          </span>
                          <span className="text-xs font-semibold text-white">{act.account_email}</span>
                          <span className="text-[10px] text-zinc-500 font-mono">({act.provider})</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {new Date(act.created_at).toLocaleString()}
                        </span>
                      </div>

                      {act.rationale && (
                        <div className="text-xs text-zinc-400">
                          <span className="text-zinc-500">Gemini note:</span> {act.rationale}
                        </div>
                      )}

                      {isSend ? (
                        <div className="space-y-2 text-xs">
                          <div className="text-zinc-300">
                            <span className="text-zinc-500">To:</span> {(p.to || []).join(', ') || '(Reply sender)'}
                          </div>
                          {p.subject && (
                            <div className="text-zinc-300">
                              <span className="text-zinc-500">Subject:</span> {p.subject}
                            </div>
                          )}
                          <textarea
                            rows={4}
                            value={bodyVal}
                            onChange={(e) =>
                              setEditingActionBodies((prev) => ({ ...prev, [act.id]: e.target.value }))
                            }
                            className="w-full p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-cyan-500"
                          />
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-300 space-y-1">
                          <div>Target email(s):</div>
                          <ul className="list-disc pl-5 text-zinc-400">
                            {(p.messageSubjects || p.messageIds || []).map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => void handleDecision(act.id, 'reject')}
                          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-rose-950/60 hover:text-rose-300 text-zinc-300 text-xs font-semibold cursor-pointer"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => void handleDecision(act.id, 'approve')}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve &amp; Execute</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Action History */}
          <div className="rounded-2xl bg-[#14141B] border border-zinc-800/90 p-4 sm:p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Recent Action Queue</h3>
            {actions.length === 0 ? (
              <div className="text-xs text-zinc-500">No actions recorded yet.</div>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {actions.slice(0, 20).map((act) => (
                  <div key={act.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                          {act.action_type}
                        </span>
                        <span className="text-zinc-200 font-semibold">{act.account_email}</span>
                        <span className="text-zinc-500 text-[11px]">
                          {act.payload_json?.subject ||
                            (act.payload_json?.messageSubjects || [])[0] ||
                            act.rationale}
                        </span>
                      </div>
                      {act.error_message && (
                        <div className="text-[11px] text-rose-400">{act.error_message}</div>
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        act.status === 'executed'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : act.status === 'failed'
                          ? 'bg-rose-500/15 text-rose-300'
                          : act.status === 'queued' || act.status === 'claimed'
                          ? 'bg-cyan-500/15 text-cyan-300'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {act.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 3: ACCOUNTS, SAFETY CONTROLS & 3-PROVIDER SETUP GUIDE    */}
      {/* ============================================================ */}
      {tab === 'setup' && (
        <div className="space-y-5">
          {/* Connected Accounts & Safety Controls */}
          {accounts.length > 0 && (
            <div className="rounded-2xl bg-[#14141B] border border-zinc-800/90 p-4 sm:p-5 space-y-3">
              <h2 className="text-sm font-bold text-white">Connected Accounts &amp; Per-Account Safety Locks</h2>
              <div className="space-y-2.5">
                {accounts.map((acc) => {
                  const badge = providerBadge(acc.provider);
                  return (
                    <div
                      key={acc.id}
                      className="p-3.5 rounded-xl bg-[#0D0D13] border border-zinc-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                          <span className="text-sm font-bold text-white">{acc.email_address}</span>
                          <span className="text-[11px] text-zinc-400">({acc.account_label})</span>
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          Last sync: {acc.last_sync_at ? new Date(acc.last_sync_at).toLocaleString() : 'Never'}
                          {acc.last_sync_device ? ` · ${acc.last_sync_device}` : ''}
                          {acc.last_error ? ` · ⚠️ ${acc.last_error}` : ''}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 text-xs">
                        <select
                          value={acc.permission_mode}
                          onChange={(e) =>
                            void updateAccountSetting(acc.id, {
                              permission_mode: e.target.value as 'read' | 'draft_triage' | 'full_send',
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
                        >
                          <option value="read">Read Only</option>
                          <option value="draft_triage">Draft &amp; Triage Only</option>
                          <option value="full_send">Full (Draft + Triage + Send)</option>
                        </select>

                        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={acc.auto_send_allowed}
                            onChange={(e) =>
                              void updateAccountSetting(acc.id, { auto_send_allowed: e.target.checked })
                            }
                            className="accent-cyan-500"
                          />
                          <span>Auto-Send</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={acc.auto_delete_allowed}
                            onChange={(e) =>
                              void updateAccountSetting(acc.id, { auto_delete_allowed: e.target.checked })
                            }
                            className="accent-cyan-500"
                          />
                          <span>Auto-Trash</span>
                        </label>

                        <button
                          onClick={() => void removeAccount(acc.id, acc.email_address)}
                          className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300 text-[11px] font-semibold cursor-pointer"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3-Card Best-of-Both-Worlds Setup Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 1. Gmail Cloud */}
            <div className="rounded-2xl bg-[#14141B] border border-rose-500/25 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    24/7 Cloud · Free
                  </span>
                  <Cloud className="h-4 w-4 text-rose-400" />
                </div>
                <h3 className="text-base font-bold text-white">1. Connect Gmail Account(s)</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Reuses your existing Google Cloud OAuth client — works 24/7 even when your PC is off. You can repeat this step to link multiple Gmail accounts.
                </p>

                <ol className="text-xs text-zinc-300 space-y-1.5 list-decimal pl-4">
                  <li>Click <strong>Authorize Gmail</strong> below and sign into your Gmail account.</li>
                  <li>After Google redirects to OAuth Playground, copy the entire URL from your browser address bar.</li>
                  <li>Paste it below and click <strong>Connect Gmail</strong>.</li>
                </ol>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-zinc-800/70">
                {gmailAuthUrl ? (
                  <a
                    href={gmailAuthUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-200 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                  >
                    <span>Step 1: Authorize Gmail</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <div className="text-xs text-amber-300">Missing GOOGLE_TASKS_CLIENT_ID on server.</div>
                )}

                <input
                  value={gmailLabelInput}
                  onChange={(e) => setGmailLabelInput(e.target.value)}
                  placeholder="Optional label (e.g. Personal Gmail)"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
                <input
                  value={gmailCodeInput}
                  onChange={(e) => setGmailCodeInput(e.target.value)}
                  placeholder="Step 2: Paste redirect URL or code (4/0A...)"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
                <button
                  onClick={() => void handleConnectGmail()}
                  disabled={connectingGmail}
                  className="w-full py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {connectingGmail ? 'Connecting & Syncing...' : 'Connect Gmail'}
                </button>
              </div>
            </div>

            {/* 2. Hotmail / Outlook.com Cloud */}
            <div className="rounded-2xl bg-[#14141B] border border-sky-500/25 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    24/7 Cloud · Free
                  </span>
                  <Cloud className="h-4 w-4 text-sky-400" />
                </div>
                <h3 className="text-base font-bold text-white">2. Connect Hotmail / Outlook</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Connects personal Hotmail/Outlook.com accounts via Microsoft Graph API — 24/7 cloud read, draft, sort, trash, and send.
                </p>

                <ol className="text-xs text-zinc-300 space-y-1.5 list-decimal pl-4">
                  <li>
                    Create a free App Registration at{' '}
                    <a
                      href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 underline"
                    >
                      Azure Portal
                    </a>{' '}
                    → choose <strong>Personal Microsoft accounts only</strong>.
                  </li>
                  <li>
                    Add Web Redirect URI:
                    <div className="mt-1 flex items-center gap-1.5 p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[10px] text-sky-300 break-all">
                      <span className="flex-1">{msRedirectUri}</span>
                      <button
                        onClick={() => copyText('msUri', msRedirectUri)}
                        className="p-1 hover:text-white cursor-pointer shrink-0"
                        title="Copy Redirect URI"
                      >
                        {copiedKey === 'msUri' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </li>
                  <li>Paste the <strong>Application (client) ID</strong> (and optional Client Secret if Web app) below, then click Sign In.</li>
                </ol>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-zinc-800/70">
                {safetyConfig?.microsoftConfigured && (
                  <div className="text-[11px] text-emerald-300 font-mono">
                    ✓ Client ID saved ({safetyConfig.microsoftClientIdPreview})
                  </div>
                )}
                <input
                  value={msClientIdInput}
                  onChange={(e) => setMsClientIdInput(e.target.value)}
                  placeholder="Azure Application (client) ID..."
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                />
                <input
                  type="password"
                  value={msClientSecretInput}
                  onChange={(e) => setMsClientSecretInput(e.target.value)}
                  placeholder="Client Secret Value (required for Web redirect)"
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-500"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => void handleSaveMicrosoftConfig()}
                    disabled={savingMsCfg || !msClientIdInput.trim()}
                    className="py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer disabled:opacity-40"
                  >
                    {savingMsCfg ? 'Saving...' : 'Save App ID'}
                  </button>
                  <button
                    onClick={() => void handleLaunchMicrosoftSignIn()}
                    disabled={!safetyConfig?.microsoftConfigured}
                    className="py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-black text-xs font-bold cursor-pointer disabled:opacity-40"
                  >
                    Sign In Hotmail
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Western / Schulich @uwo.ca via Silent Thunderbird Bridge */}
            <div className="rounded-2xl bg-[#14141B] border border-indigo-500/25 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    School @uwo.ca · Free
                  </span>
                  <Laptop className="h-4 w-4 text-indigo-400" />
                </div>
                <h3 className="text-base font-bold text-white">3. Connect @uwo.ca (Thunderbird)</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Keep using <strong>Spark Free</strong> on iPhone &amp; Windows! Just leave Thunderbird minimized in the background as your free @uwo.ca bridge.
                </p>

                <ol className="text-xs text-zinc-300 space-y-1.5 list-decimal pl-4">
                  <li>
                    Install free <strong>Mozilla Thunderbird</strong> and add your <code className="text-indigo-300">@uwo.ca</code> account (uses Western Microsoft OAuth2 + MFA automatically).
                  </li>
                  <li>
                    In Thunderbird: <strong>Settings → General → Config Editor</strong> → set{' '}
                    <code className="text-indigo-300">xpinstall.signatures.required</code> to <code className="text-emerald-300">false</code>.
                  </li>
                  <li>
                    Download the add-on below → press <strong>Ctrl+Shift+A</strong> (Cmd+Shift+A on Mac) → Gear → <strong>Install Add-on From File</strong>.
                  </li>
                  <li>
                    Click the <strong>Kevin-OS</strong> icon in Thunderbird’s toolbar, paste your Bridge Token below, set filter to <code className="text-indigo-300">uwo.ca</code>, and click <strong>Save &amp; Sync Now</strong>!
                  </li>
                </ol>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-zinc-800/70">
                <a
                  href="/downloads/kevin-os-thunderbird-bridge.xpi"
                  download="kevin-os-thunderbird-bridge.xpi"
                  className="w-full py-2 px-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Thunderbird Add-on (.xpi)</span>
                </a>

                {bridgeToken && (
                  <div className="p-2 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-zinc-400">
                      <span>Kevin-OS Bridge Token (same as Anki)</span>
                      <button
                        onClick={() => copyText('bridgeToken', bridgeToken)}
                        className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'bridgeToken' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedKey === 'bridgeToken' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <div className="font-mono text-[10px] text-zinc-300 truncate">{bridgeToken}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* COMPOSE MODAL                                                */}
      {/* ============================================================ */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#14141B] border border-zinc-800 p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PenSquare className="h-4 w-4 text-cyan-400" />
                <span>Compose Email / Draft</span>
              </h3>
              <button
                onClick={() => setComposeOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1 font-semibold">From Account</label>
                <select
                  value={composeAccount}
                  onChange={(e) => setComposeAccount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_label} — {a.email_address} ({a.provider})
                    </option>
                  ))}
                </select>
              </div>

              <input
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                placeholder="To (comma-separated emails)..."
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder:text-zinc-500"
              />
              <input
                value={composeCc}
                onChange={(e) => setComposeCc(e.target.value)}
                placeholder="Cc (optional)..."
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder:text-zinc-500"
              />
              <input
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                placeholder="Subject..."
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder:text-zinc-500"
              />
              <textarea
                rows={6}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                placeholder="Message body..."
                className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder:text-zinc-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                onClick={async () => {
                  const toList = composeTo
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const ccList = composeCc
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const ok = await runEmailAction(
                    'draft',
                    { to: toList, cc: ccList, subject: composeSubject, bodyText: composeBody },
                    composeAccount
                  );
                  if (ok) {
                    setComposeTo('');
                    setComposeCc('');
                    setComposeSubject('');
                    setComposeBody('');
                    setComposeOpen(false);
                  }
                }}
                disabled={submittingAction}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer"
              >
                Save Draft (Syncs to Spark)
              </button>
              <button
                onClick={async () => {
                  const toList = composeTo
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const ccList = composeCc
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (toList.length === 0) {
                    flash('err', 'Add at least one recipient in To.');
                    return;
                  }
                  const ok = await runEmailAction(
                    'send',
                    { to: toList, cc: ccList, subject: composeSubject, bodyText: composeBody },
                    composeAccount
                  );
                  if (ok) {
                    setComposeTo('');
                    setComposeCc('');
                    setComposeSubject('');
                    setComposeBody('');
                    setComposeOpen(false);
                  }
                }}
                disabled={submittingAction}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send Now</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
