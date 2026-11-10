'use client';

import React, { useState, useEffect } from 'react';
import {
  ExternalLink,
  KeyRound,
  CheckCircle2,
  RefreshCw,
  HeartPulse,
  Sparkles,
} from 'lucide-react';

interface GoogleHealthConnectBannerProps {
  onSynced?: () => void;
}

export default function GoogleHealthConnectBanner({
  onSynced,
}: GoogleHealthConnectBannerProps) {
  const [checking, setChecking] = useState<boolean>(true);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [authUrl, setAuthUrl] = useState<string>('');
  const [tokenOrCode, setTokenOrCode] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [syncingNow, setSyncingNow] = useState<boolean>(false);
  const [showReconnectForm, setShowReconnectForm] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/google-health')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.authUrl) setAuthUrl(data.authUrl);
        if (data.connected) {
          setIsConnected(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleManualSync = async (days = 14) => {
    setSyncingNow(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/health/google-sync?days=${days}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusMsg({
          type: 'error',
          text: data.error || 'Failed to sync from Google Health API.',
        });
        return;
      }
      setStatusMsg({
        type: 'success',
        text: `Synced ${data.syncedCount ?? 0} day(s) of biometrics, sleep & workouts from Google Health API!`,
      });
      if (onSynced) onSynced();
    } catch (err: unknown) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error during Google Health sync.',
      });
    } finally {
      setSyncingNow(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenOrCode.trim()) return;
    setSubmitting(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/auth/google-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenOrCode: tokenOrCode.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setStatusMsg({
          type: 'error',
          text: data.error || 'Failed to verify Google Health authorization.',
        });
        return;
      }

      const syncRes = await fetch('/api/health/google-sync?days=30', {
        method: 'POST',
      });
      const syncData = await syncRes.json().catch(() => ({}));
      const syncedCount = syncData?.syncedCount ?? 0;

      setIsConnected(true);
      setShowReconnectForm(false);
      setTokenOrCode('');
      setStatusMsg({
        type: 'success',
        text: `Google Health API connected! Backfilled ${syncedCount} day(s) of biometrics, sleep & workout metrics.`,
      });

      if (onSynced) {
        onSynced();
      }
    } catch (err: unknown) {
      setStatusMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error while connecting.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) return null;

  if (isConnected && !showReconnectForm) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs sm:text-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="font-semibold text-emerald-300">
            Google Health API v4 Connected
          </span>
          <span className="text-zinc-400 text-xs hidden md:inline">
            • Auto-syncing steps, RHR, HRV, bodyweight, sleep & workouts
          </span>
          {statusMsg && (
            <span
              className={`text-xs font-medium ml-1 ${
                statusMsg.type === 'error' ? 'text-rose-400' : 'text-cyan-300'
              }`}
            >
              ({statusMsg.text})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => handleManualSync(14)}
            disabled={syncingNow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${syncingNow ? 'animate-spin' : ''}`} />
            <span>{syncingNow ? 'Syncing Google Health...' : 'Sync Google Health (14D)'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowReconnectForm(true)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1"
          >
            Reconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 p-4 sm:p-5 space-y-3.5 shadow-lg shadow-cyan-500/5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 shrink-0 mt-0.5">
            <HeartPulse className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-cyan-200 flex items-center gap-2">
              <span>Connect Google Health API v4</span>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5" /> Replaces Apple Shortcuts
              </span>
            </h3>
            <p className="text-xs text-cyan-100/80 leading-relaxed">
              Authorize read-only access to your Google Health account to automatically sync daily{' '}
              <strong>steps, RHR, HRV, bodyweight, sleep duration, bedtime/wake times, and workout duration/calories</strong>{' '}
              directly from Google Cloud.
            </p>
          </div>
        </div>

        {isConnected && (
          <button
            type="button"
            onClick={() => setShowReconnectForm(false)}
            className="text-xs text-zinc-400 hover:text-white self-start"
          >
            Cancel
          </button>
        )}
      </div>

      <form
        onSubmit={handleConnect}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1"
      >
        {authUrl && (
          <a
            href={authUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-cyan-400 text-black hover:bg-cyan-300 transition shrink-0 shadow-sm"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>1. Authorize Google Health</span>
          </a>
        )}

        <div className="relative flex-1">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="text"
            value={tokenOrCode}
            onChange={(e) => setTokenOrCode(e.target.value)}
            placeholder="2. Paste Redirect URL (https://developers.google.com/oauthplayground/?code=...) or Refresh Token"
            className="w-full bg-[#0D0D12] border border-zinc-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !tokenOrCode.trim()}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 disabled:opacity-50 transition shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${submitting ? 'animate-spin' : ''}`} />
          <span>{submitting ? 'Connecting & Syncing...' : '3. Connect & Sync'}</span>
        </button>
      </form>

      {statusMsg && (
        <div
          className={`text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${
            statusMsg.type === 'error'
              ? 'text-rose-300 bg-rose-500/10 border border-rose-500/20'
              : 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'
          }`}
        >
          {statusMsg.type === 'success' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          <span>{statusMsg.text}</span>
        </div>
      )}
    </div>
  );
}
