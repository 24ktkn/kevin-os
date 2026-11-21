'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertOctagon,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Brain,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database,
  Flame,
  Inbox,
  Layers,
  RefreshCw,
  Sparkles,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import {
  AnkiActionItem,
  AnkiDailyStats,
  AnkiSyncState,
  BiometricsRetentionInsights,
  ExamPacingProjection,
  ExamTarget,
} from '@/types/anki';
import AnkiCharts from '@/components/anki/AnkiCharts';
import AnkiReviewer from '@/components/anki/AnkiReviewer';
import AnkiCardBrowser from '@/components/anki/AnkiCardBrowser';
import AnkiAiStudio from '@/components/anki/AnkiAiStudio';
import AnkiLeechesAndSettings from '@/components/anki/AnkiLeechesAndSettings';
import AnkiWorkflowGuide from '@/components/anki/AnkiWorkflowGuide';
import GoogleTasksReconnectBanner from '@/components/tasks/GoogleTasksReconnectBanner';

type AnkiTab = 'overview' | 'review' | 'browser' | 'ai' | 'leeches';

interface ScheduledAnkiBlock {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMins: number;
  estimatedCards: number;
  calendar: string;
  reasoning: string;
  committed: boolean;
}

export default function AnkiPage() {
  const [activeTab, setActiveTab] = useState<AnkiTab>('overview');
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [today, setToday] = useState<AnkiDailyStats | null>(null);
  const [history, setHistory] = useState<AnkiDailyStats[]>([]);
  const [syncState, setSyncState] = useState<AnkiSyncState | null>(null);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [habitCompletedToday, setHabitCompletedToday] = useState(false);
  const [pendingActions, setPendingActions] = useState<AnkiActionItem[]>([]);
  const [pendingProposalsCount, setPendingProposalsCount] = useState(0);
  const [studyPlan, setStudyPlan] = useState<{
    targetCards: number;
    rawEstimatedMins: number;
    totalBlockMins: number;
    blocks: Array<{ label: string; durationMins: number; estimatedCards: number }>;
  } | null>(null);
  const [biometricsInsights, setBiometricsInsights] = useState<BiometricsRetentionInsights>({
    pairedDays: 0,
    points: [],
    avgRetentionGoodSleep: null,
    avgRetentionLowSleep: null,
    avgSpeedGoodSleep: null,
    avgSpeedLowSleep: null,
    avgRetentionHighHrv: null,
    avgRetentionLowHrv: null,
    medianHrv: null,
    takeaways: [],
  });
  const [examProjections, setExamProjections] = useState<ExamPacingProjection[]>([]);
  const [studyDeck, setStudyDeck] = useState<string>('ALL');

  // Auto-Schedule Today's Anki Timeblock & Google Task state
  const [schedulingAnki, setSchedulingAnki] = useState(false);
  const [includeNewInSched, setIncludeNewInSched] = useState(false);
  const [allowSplitInSched, setAllowSplitInSched] = useState(true);
  const [schedResultMsg, setSchedResultMsg] = useState<string | null>(null);
  const [schedBlocks, setSchedBlocks] = useState<ScheduledAnkiBlock[]>([]);
  const [tasksAuthError, setTasksAuthError] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/anki/stats');
      const data = await res.json();
      if (data.success) {
        setNeedsMigration(Boolean(data.needsMigration));
        setToday(data.today || null);
        setHistory(data.history || []);
        setSyncState(data.syncState || null);
        setBridgeOnline(Boolean(data.bridgeOnline));
        setHabitCompletedToday(Boolean(data.habitCompletedToday));
        setPendingActions(data.pendingActions || []);
        setPendingProposalsCount(data.pendingProposalsCount || 0);
        setStudyPlan(data.studyPlan || null);
        if (data.biometricsInsights) setBiometricsInsights(data.biometricsInsights);
        setExamProjections(data.examProjections || []);
      }
    } catch (err) {
      console.error('Failed to load Anki stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadStats();
    }, 0);
    return () => clearTimeout(t);
  }, [loadStats]);

  const availableDecks = (today?.deck_breakdown || []).map((d) => d.deck);

  const handleAutoScheduleAnki = async (commit: boolean) => {
    setSchedulingAnki(true);
    setSchedResultMsg(null);
    try {
      const res = await fetch('/api/anki/schedule-today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeNewCards: includeNewInSched,
          allowSplit: allowSplitInSched,
          calendar: 'School',
          commit,
        }),
      });
      const data = await res.json();
      if (data.taskError) setTasksAuthError(true);
      if (!res.ok || !data.success) {
        setSchedResultMsg(data.error || 'Could not schedule Anki timeblock.');
        return;
      }
      if (data.nothingDue) {
        setSchedBlocks([]);
        setSchedResultMsg(data.message);
        return;
      }
      setSchedBlocks(data.scheduledBlocks || []);
      if (commit) {
        const count = (data.scheduledBlocks || []).length;
        setSchedResultMsg(
          `Scheduled ${count} Anki timeblock${count === 1 ? '' : 's'} onto Google Calendar & Google Tasks!`
        );
      } else {
        setSchedResultMsg(
          `Found ${(data.scheduledBlocks || []).length} open slot(s) for ${data.plan?.targetCards || 0} remaining cards (~${data.plan?.totalBlockMins || 0}m total). Click Confirm & Add to push to Google.`
        );
      }
    } finally {
      setSchedulingAnki(false);
    }
  };

  const handleSaveSettings = async (patch: Partial<AnkiSyncState>) => {
    await fetch('/api/anki/stats', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadStats();
  };

  const handleSaveExamTargets = async (targets: ExamTarget[]) => {
    await handleSaveSettings({ exam_targets: targets });
  };

  const handleTriggerSync = async () => {
    await fetch('/api/anki/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trigger_sync', source: 'kevin_os_ui' }),
    });
    await loadStats();
  };

  const dueRemaining = today?.total_due_remaining || 0;
  const reviewsToday = today?.reviews_today || 0;
  const totalDayLoad = reviewsToday + dueRemaining;
  const progressPct =
    totalDayLoad > 0 ? Math.min(100, Math.round((reviewsToday / totalDayLoad) * 100)) : 0;

  const tabs: Array<{
    key: AnkiTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number | string;
  }> = [
    { key: 'overview', label: 'Overview & Pacing', icon: BarChart3 },
    { key: 'review', label: 'Review Cards', icon: BookOpenCheck, badge: dueRemaining > 0 ? dueRemaining : undefined },
    { key: 'browser', label: 'Card Browser', icon: Layers, badge: today?.total_cards || undefined },
    {
      key: 'ai',
      label: 'AI Inbox & NotebookLM',
      icon: Inbox,
      badge: pendingProposalsCount > 0 ? pendingProposalsCount : undefined,
    },
    { key: 'leeches', label: 'Leeches & Bridge', icon: AlertOctagon, badge: today?.leech_cards || undefined },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      {/* Top Sticky Bar */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0F0F14]/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Brain className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
              Anki Command Center
              {habitCompletedToday && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
                  ✓ Daily Habit Checked
                </span>
              )}
            </h1>
            <p className="text-xs text-zinc-400">
              Spaced Repetition · Gemini &amp; NotebookLM Sync · Exam Pacing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
              bridgeOnline
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
            }`}
          >
            {bridgeOnline ? (
              <Wifi className="h-3 w-3 text-emerald-400" />
            ) : (
              <WifiOff className="h-3 w-3 text-amber-400" />
            )}
            <span>{bridgeOnline ? 'Anki Bridge Live' : 'Bridge Offline (Queue Ready)'}</span>
          </div>

          <button
            onClick={() => setShowGuide((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer ${
              showGuide
                ? 'bg-indigo-500/20 text-indigo-200 border-indigo-400/50'
                : 'text-zinc-300 hover:text-white bg-zinc-900 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Gemini Guide</span>
          </button>

          <button
            onClick={() => {
              setLoading(true);
              loadStats();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        <GoogleTasksReconnectBanner
          visible={tasksAuthError}
          onReconnected={() => setTasksAuthError(false)}
        />

        {/* One-Time Supabase Migration Setup Callout */}
        {needsMigration && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/35 text-xs space-y-2">
            <div className="font-semibold text-amber-200 flex items-center gap-2">
              <Database className="h-4 w-4 text-amber-400" />
              One-Time Setup Required: Create Anki Tables in Supabase
            </div>
            <p className="text-zinc-300 leading-relaxed">
              Paste and run <code className="text-cyan-300 bg-zinc-900 px-1.5 py-0.5 rounded">web/supabase_migrations/add_anki_tables.sql</code> in your{' '}
              <a
                href="https://supabase.com/dashboard/project/lqjdolzbzxrqlpykospy/sql/new"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline hover:text-cyan-200"
              >
                Supabase SQL Editor
              </a>
              , then install AnkiConnect (<code className="text-cyan-300">2055492159</code>) and launch{' '}
              <code className="text-cyan-300 bg-zinc-900 px-1.5 py-0.5 rounded">anki-bridge\start-bridge.bat</code>.
            </p>
          </div>
        )}

        {/* KPI Cards Row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4 space-y-1.5">
            <div className="text-xs text-zinc-400 flex items-center justify-between">
              <span>Due Today</span>
              <Clock className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {dueRemaining}
              <span className="text-xs font-normal text-zinc-400 ml-1.5">
                ({today?.review_due_remaining || 0} rev + {today?.learning_remaining || 0} lrn)
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4">
            <div className="text-xs text-zinc-400 flex items-center justify-between">
              <span>Reviewed Today</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-white">{reviewsToday}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              {Math.round((today?.study_time_secs || 0) / 60)}m · {today?.avg_secs_per_card || 8.5}s/card
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4">
            <div className="text-xs text-zinc-400 flex items-center justify-between">
              <span>Retention Today</span>
              <Sparkles className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-white">
              {today?.retention_pct ? `${today.retention_pct}%` : '—'}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              Mature: {today?.mature_retention_pct ? `${today.mature_retention_pct}%` : '—'}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4">
            <div className="text-xs text-zinc-400 flex items-center justify-between">
              <span>Anki Streak</span>
              <Flame className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-white">
              {today?.streak_days || 0}d
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              {habitCompletedToday ? 'Habit auto-checked ✅' : 'Clears at 0 rev+lrn'}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4 col-span-2 lg:col-span-1">
            <div className="text-xs text-zinc-400 flex items-center justify-between">
              <span>Collection Index</span>
              <Layers className="h-4 w-4 text-purple-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-white">
              {today?.total_cards || 0}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              {today?.active_cards || 0} active · {today?.suspended_cards || 0} susp.
            </div>
          </div>
        </div>

        {/* 1-Click Anki Timeblock + Google Task Auto-Scheduler Card */}
        <section className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-[#101824] via-[#12121A] to-[#151224] p-4 sm:p-5 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center shrink-0">
                <CalendarClock className="h-4.5 w-4.5 text-cyan-300" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Auto-Schedule Today&apos;s Anki Timeblock &amp; Google Task
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {studyPlan && studyPlan.targetCards > 0
                    ? `Estimated ~${studyPlan.rawEstimatedMins}m (${studyPlan.totalBlockMins}m block${studyPlan.blocks.length > 1 ? ' split in 2' : ''}) for ${studyPlan.targetCards} remaining cards at ${today?.avg_secs_per_card || 8.5}s/card — scheduled cleanly around your classes & Google Calendar.`
                    : 'Calculates exact study time from remaining due cards and schedules a non-overlapping Google Calendar block + Google Task.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer mr-1">
                <input
                  type="checkbox"
                  checked={includeNewInSched}
                  onChange={(e) => setIncludeNewInSched(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                />
                <span>+ New ({today?.new_remaining || 0})</span>
              </label>

              <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer mr-1">
                <input
                  type="checkbox"
                  checked={allowSplitInSched}
                  onChange={(e) => setAllowSplitInSched(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                />
                <span>Split &gt;45m</span>
              </label>

              <button
                onClick={() => handleAutoScheduleAnki(false)}
                disabled={schedulingAnki}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-zinc-200 transition cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                <span>Preview Slot</span>
              </button>

              <button
                onClick={() => handleAutoScheduleAnki(true)}
                disabled={schedulingAnki}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-white text-xs font-semibold shadow-md shadow-cyan-500/20 transition cursor-pointer"
              >
                {schedulingAnki ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                <span>{schedulingAnki ? 'Scheduling...' : 'Auto-Schedule Today'}</span>
              </button>
            </div>
          </div>

          {schedResultMsg && (
            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-xs text-cyan-200 flex items-center justify-between gap-2">
              <span>{schedResultMsg}</span>
              <button onClick={() => setSchedResultMsg(null)} className="cursor-pointer">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {schedBlocks.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {schedBlocks.map((b) => (
                <div
                  key={b.id}
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                    b.committed
                      ? 'bg-emerald-950/30 border-emerald-500/35'
                      : 'bg-[#0D101A] border-indigo-500/30'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-white">
                      {b.title}{' '}
                      <span className="font-mono text-cyan-300">
                        · {b.startTime} – {b.endTime} ({b.durationMins}m)
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">{b.reasoning}</div>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                      b.committed
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-indigo-500/20 text-indigo-300'
                    }`}
                  >
                    {b.committed ? 'Added ✓' : 'Preview'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Collapsible Gemini + NotebookLM Workflow Guide Dropdown */}
        <AnkiWorkflowGuide
          open={showGuide}
          onToggle={() => setShowGuide((v) => !v)}
          onOpenAiInbox={() => setActiveTab('ai')}
          totalCards={today?.total_cards}
          suspendedCards={today?.suspended_cards}
        />

        {/* 5 Instant Navigation Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                  isActive
                    ? 'bg-zinc-800 text-white border border-zinc-700 shadow-sm'
                    : 'bg-[#121218] text-zinc-400 hover:text-zinc-200 border border-zinc-800/70'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${
                      tab.key === 'ai'
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/35'
                        : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Active Tab Content */}
        {activeTab === 'overview' && (
          <AnkiCharts
            today={today}
            history={history}
            biometricsInsights={biometricsInsights}
            examProjections={examProjections}
            examTargets={syncState?.exam_targets || []}
            availableDecks={availableDecks}
            onSaveExamTargets={handleSaveExamTargets}
            onSelectDeckToStudy={(deckName) => {
              setStudyDeck(deckName);
              setActiveTab('review');
            }}
          />
        )}

        {activeTab === 'review' && (
          <AnkiReviewer
            availableDecks={availableDecks}
            initialDeck={studyDeck}
            bridgeOnline={bridgeOnline}
            onReviewSubmitted={() => loadStats()}
          />
        )}

        {activeTab === 'browser' && (
          <AnkiCardBrowser
            availableDecks={availableDecks}
            defaultDeck={syncState?.default_deck || 'Schulich'}
            onCardsMutated={() => loadStats()}
          />
        )}

        {activeTab === 'ai' && (
          <AnkiAiStudio
            availableDecks={availableDecks}
            defaultDeck={syncState?.default_deck || 'Schulich'}
            onInboxChanged={() => loadStats()}
          />
        )}

        {activeTab === 'leeches' && (
          <AnkiLeechesAndSettings
            syncState={syncState}
            bridgeOnline={bridgeOnline}
            pendingActions={pendingActions}
            onSaveSettings={handleSaveSettings}
            onTriggerSync={handleTriggerSync}
          />
        )}
      </main>
    </div>
  );
}
