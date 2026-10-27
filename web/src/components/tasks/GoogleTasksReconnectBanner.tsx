'use client';

import React, { useState, useEffect } from 'react';
import { AlertTriangle, ExternalLink, KeyRound, CheckCircle2, RefreshCw, HelpCircle } from 'lucide-react';

interface GoogleTasksReconnectBannerProps {
  visible: boolean;
  onReconnected?: () => void;
}

export default function GoogleTasksReconnectBanner({
  visible,
  onReconnected,
}: GoogleTasksReconnectBannerProps) {
  const [authUrl, setAuthUrl] = useState<string>('');
  const [tokenOrCode, setTokenOrCode] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPermanentTip, setShowPermanentTip] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    if (!visible) return;
    fetch('/api/auth/google-tasks')
      .then((r) => r.json())
      .then((data) => {
        if (data.authUrl) setAuthUrl(data.authUrl);
        if (data.connected) setIsConnected(true);
      })
      .catch(() => {});
  }, [visible]);

  if (!visible && !statusMsg) return null;
  if (isConnected && statusMsg?.type === 'success') {
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-emerald-300 text-xs sm:text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{statusMsg.text}</span>
        </div>
        <button
          onClick={() => setStatusMsg(null)}
          className="text-xs text-emerald-300/80 hover:text-white underline"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const handleReconnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenOrCode.trim()) return;
    setSubmitting(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/auth/google-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenOrCode: tokenOrCode.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setStatusMsg({
          type: 'error',
          text: data.error || 'Failed to verify token or authorization code.',
        });
        return;
      }

      // Trigger full two-way sync + backfill of any missing Google Tasks
      const syncRes = await fetch('/api/tasks/sync');
      const syncData = await syncRes.json();
      const syncedCount = syncData?.results?.tasksSynced ?? 0;

      setIsConnected(true);
      setTokenOrCode('');
      setStatusMsg({
        type: 'success',
        text: `Google Tasks reconnected! Synced & backfilled ${syncedCount} tasks (including your scheduled online modules).`,
      });

      if (onReconnected) {
        onReconnected();
      }
    } catch (err: unknown) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error while reconnecting.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:p-5 space-y-3.5 shadow-lg shadow-amber-500/5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 shrink-0 mt-0.5">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-amber-200 flex items-center gap-2">
              Google Tasks Token Expired — Reconnect to Backfill Missing Tasks
            </h3>
            <p className="text-xs text-amber-100/80 leading-relaxed">
              Google Calendar uses a permanent Service Account (so your timeblocks were created normally), but Google Tasks uses an OAuth token that expired (<code className="text-amber-300 font-mono">invalid_grant</code>). Reconnect below and all scheduled modules waiting in Supabase will automatically be created in Google Tasks.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowPermanentTip((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 whitespace-nowrap self-start px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>{showPermanentTip ? 'Hide permanent fix' : 'Stop 7-day expiry'}</span>
        </button>
      </div>

      {showPermanentTip && (
        <div className="rounded-xl bg-[#0D0D12]/90 border border-amber-500/20 p-3 text-xs text-zinc-300 space-y-1">
          <p className="font-medium text-amber-300">Why did my Google Tasks token expire after 7 days?</p>
          <p className="text-zinc-400 leading-relaxed">
            When a Google Cloud OAuth Consent Screen is in <strong>&ldquo;Testing&rdquo;</strong> mode, Google automatically revokes refresh tokens every 7 days. To make your token permanent: go to{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials/consent"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:underline"
            >
              Google Cloud Console → OAuth consent screen
            </a>{' '}
            and click <strong>&ldquo;Publish App&rdquo;</strong> (set status to <em>In production</em>) BEFORE generating your new token below.
          </p>
        </div>
      )}

      <form onSubmit={handleReconnect} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
        {authUrl && (
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 transition shrink-0 shadow-sm"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>1. Authorize Google Tasks</span>
          </a>
        )}

        <div className="relative flex-1">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="text"
            value={tokenOrCode}
            onChange={(e) => setTokenOrCode(e.target.value)}
            placeholder="2. Paste Redirect URL, Auth Code (4/0A...), or Refresh Token (1//0...)"
            className="w-full bg-[#0D0D12] border border-zinc-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !tokenOrCode.trim()}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 disabled:opacity-50 transition shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${submitting ? 'animate-spin' : ''}`} />
          <span>{submitting ? 'Reconnecting & Syncing...' : '3. Reconnect & Backfill'}</span>
        </button>
      </form>

      {statusMsg && statusMsg.type === 'error' && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          {statusMsg.text}
        </p>
      )}
    </div>
  );
}
