'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  Flame,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Sunrise,
  X,
} from 'lucide-react';
import { ReadinessResult } from '@/lib/readiness';
import { MorningBriefPayload } from '@/types/digests';

interface MorningBriefAndReadinessProps {
  readiness?: ReadinessResult | null;
}

export default function MorningBriefAndReadiness({ readiness }: MorningBriefAndReadinessProps) {
  const [brief, setBrief] = useState<MorningBriefPayload | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(true);
  const [refreshingBrief, setRefreshingBrief] = useState(false);

  // ntfy.sh + Wake cutoff settings drawer
  const [showSetup, setShowSetup] = useState(false);
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [wakeCutoff, setWakeCutoff] = useState('06:00');
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);

  const loadBrief = useCallback(async (refresh = false) => {
    if (refresh) setRefreshingBrief(true);
    else setLoadingBrief(true);
    try {
      const [briefRes, settingsRes] = await Promise.all([
        fetch(`/api/brief/morning${refresh ? '?refresh=true' : ''}`).then((r) => r.json()).catch(() => null),
        fetch('/api/settings').then((r) => r.json()).catch(() => null),
      ]);
      if (briefRes?.success && briefRes.brief) setBrief(briefRes.brief);
      if (settingsRes?.success && settingsRes.settings) {
        setNtfyTopic(settingsRes.settings.ntfy_topic || '');
        setWakeCutoff(settingsRes.settings.wake_cutoff_time || '06:00');
      }
    } finally {
      setLoadingBrief(false);
      setRefreshingBrief(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadBrief(false);
    }, 0);
    return () => clearTimeout(t);
  }, [loadBrief]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSetupMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ntfy_topic: ntfyTopic.trim(),
          wake_cutoff_time: wakeCutoff,
          morning_brief_enabled: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSetupMsg('Saved ntfy.sh topic & Wake-Up cutoff time!');
      } else {
        setSetupMsg(data.error || 'Could not save settings.');
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSendTestPush = async () => {
    if (!ntfyTopic.trim()) {
      setSetupMsg('Enter your private ntfy.sh topic name first (e.g. kevin-os-brief-xxxx).');
      return;
    }
    setTestingPush(true);
    setSetupMsg(null);
    try {
      // Save topic first so cron uses it at 7:30 AM tomorrow too
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ntfy_topic: ntfyTopic.trim(), wake_cutoff_time: wakeCutoff }),
      }).catch(() => {});

      const res = await fetch('/api/brief/morning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testPush: true, ntfyTopic: ntfyTopic.trim() }),
      });
      const data = await res.json();
      if (data.pushResult?.sent) {
        setSetupMsg('Sent test Morning Brief to your iPhone via ntfy.sh! Check your notifications.');
        if (data.brief) setBrief(data.brief);
      } else {
        setSetupMsg(data.pushResult?.error || data.error || 'Failed to send test push.');
      }
    } finally {
      setTestingPush(false);
    }
  };

  const score = readiness?.score ?? brief?.readiness?.score ?? 0;
  const tier = readiness?.tier ?? brief?.readiness?.tier ?? 'Good';
  const ringColor =
    score >= 85 ? '#34d399' : score >= 70 ? '#22d3ee' : score >= 55 ? '#fbbf24' : '#fb7185';
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;

  return (
    <section className="space-y-3">
      {/* Exam Taper Mode Alert Banner (when major Schulich exam is within 7 days) */}
      {brief?.taper?.inTaperMode && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-r from-rose-950/60 via-amber-950/40 to-[#14141B] border border-rose-500/40 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-rose-200 font-medium">
            <Flame className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{brief.taper.message}</span>
          </div>
          <Link
            href="/anki"
            className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 flex items-center gap-1 shrink-0"
          >
            <span>Open Exam Pacing</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Daily Readiness Score Gauge (0-100) */}
        <div className="lg:col-span-5 rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-[#131722] via-[#121218] to-[#0F141A] p-4 sm:p-5 flex items-center gap-4 shadow-lg">
          <div className="relative h-24 w-24 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 92 92" className="h-24 w-24 -rotate-90">
              <circle cx="46" cy="46" r={radius} fill="none" stroke="#27272a" strokeWidth="7" />
              <circle
                cx="46"
                cy="46"
                r={radius}
                fill="none"
                stroke={ringColor}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black text-white font-mono leading-none">
                {score || '—'}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 mt-0.5">
                {tier}
              </span>
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                Daily Readiness Score
              </span>
              {readiness?.baselines?.avgHrv14d && (
                <span className="text-[10px] font-mono text-zinc-500">
                  14d HRV {readiness.baselines.avgHrv14d}ms
                </span>
              )}
            </div>
            <div className="text-sm font-semibold text-white">
              {readiness?.headline || 'Calculating Readiness...'}
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2">
              {readiness?.recommendation ||
                'Derived from Sleep, HRV vs 14d baseline, RHR deviation, and training load.'}
            </p>
            {readiness && readiness.score > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5 text-[10px] font-mono text-zinc-400">
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                  Sleep {readiness.breakdown.sleepPts}/40
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                  HRV {readiness.breakdown.hrvPts}/30
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                  RHR {readiness.breakdown.rhrPts}/20
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                  Load {readiness.breakdown.loadPts}/10
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 7:30 AM Automated Morning Brief + ntfy.sh iPhone Push */}
        <div className="lg:col-span-7 rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-[#141425] via-[#121218] to-[#0E1620] p-4 sm:p-5 flex flex-col justify-between gap-3 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Sunrise className="h-4 w-4 text-amber-300" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-white">7:30 AM Morning Brief</h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    {ntfyTopic ? `ntfy: ${ntfyTopic}` : 'ntfy.sh ready'}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  {brief?.headline || 'Daily readiness, Schulich classes & Anki game plan'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Link
                href="/review"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-medium text-indigo-300 transition"
                title="Open Sunday Weekly Executive Review"
              >
                <BarChart3 className="h-3 w-3" />
                <span>Weekly Review</span>
              </Link>
              <button
                onClick={() => setShowSetup((v) => !v)}
                className={`p-1.5 rounded-lg border transition cursor-pointer ${
                  showSetup
                    ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-200'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
                title="Configure 7:30 AM ntfy.sh iPhone Push & Wake Cutoff"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => loadBrief(true)}
                disabled={refreshingBrief}
                className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
                title="Regenerate Morning Brief"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingBrief ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
          </div>

          {loadingBrief ? (
            <div className="text-xs text-zinc-500 py-2">Loading today&apos;s morning brief...</div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-zinc-200 leading-relaxed">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400 inline mr-1.5 -mt-0.5" />
                {brief?.coachNote}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span className="px-2 py-0.5 rounded-md bg-zinc-900/90 border border-zinc-800">
                  🏫 {brief?.classesToday?.length || 0} classes today
                </span>
                <span className="px-2 py-0.5 rounded-md bg-zinc-900/90 border border-zinc-800">
                  ✅ {brief?.tasksTodayCount || 0} open tasks
                </span>
                {brief?.taper?.nextMajorExam && (
                  <span className="px-2 py-0.5 rounded-md bg-zinc-900/90 border border-zinc-800 text-amber-300">
                    📅 {brief.taper.nextMajorExam} ({brief.taper.daysUntil}d)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Collapsible ntfy.sh 7:30 AM Push + 6:00 AM Wake Habit Settings */}
          {showSetup && (
            <div className="pt-3 mt-1 border-t border-zinc-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-indigo-200 flex items-center gap-1.5">
                  <Bell className="h-3.5 w-3.5 text-cyan-400" />
                  7:30 AM iPhone Push (ntfy.sh) &amp; Auto-Habit Rules
                </span>
                <button onClick={() => setShowSetup(false)} className="text-zinc-500 hover:text-white cursor-pointer">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-zinc-400">
                Install the free <strong>ntfy</strong> app on iPhone → tap <strong>+</strong> → subscribe to a unique private topic name (e.g. <code className="text-cyan-300">kevin-os-brief-730</code>), paste it below, and tap Test Push.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-zinc-500 block mb-0.5">Private ntfy.sh Topic Name</label>
                  <input
                    type="text"
                    value={ntfyTopic}
                    onChange={(e) => setNtfyTopic(e.target.value)}
                    placeholder="kevin-os-brief-yourname"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-0.5">Wake Habit Cutoff (ET)</label>
                  <input
                    type="time"
                    value={wakeCutoff}
                    onChange={(e) => setWakeCutoff(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs [color-scheme:dark]"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-semibold cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{savingSettings ? 'Saving...' : 'Save Settings'}</span>
                </button>
                <button
                  onClick={handleSendTestPush}
                  disabled={testingPush}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500 text-white font-semibold cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{testingPush ? 'Sending...' : 'Send Test Push to iPhone'}</span>
                </button>
              </div>
              {setupMsg && (
                <div className="text-[11px] text-cyan-200 bg-cyan-500/10 border border-cyan-500/25 rounded-lg px-2.5 py-1.5">
                  {setupMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
