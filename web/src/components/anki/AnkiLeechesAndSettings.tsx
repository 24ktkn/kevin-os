'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertOctagon,
  Check,
  Copy,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { AnkiActionItem, AnkiLeechGroup, AnkiSyncState } from '@/types/anki';

interface AnkiLeechesAndSettingsProps {
  syncState: AnkiSyncState | null;
  bridgeOnline: boolean;
  pendingActions: AnkiActionItem[];
  onSaveSettings: (patch: Partial<AnkiSyncState>) => Promise<void>;
  onTriggerSync: () => Promise<void>;
}

export default function AnkiLeechesAndSettings({
  syncState,
  bridgeOnline,
  pendingActions,
  onSaveSettings,
  onTriggerSync,
}: AnkiLeechesAndSettingsProps) {
  const [minLapses, setMinLapses] = useState(4);
  const [groups, setGroups] = useState<AnkiLeechGroup[]>([]);
  const [loadingLeeches, setLoadingLeeches] = useState(true);
  const [generatingTopic, setGeneratingTopic] = useState<string | null>(null);
  const [remediation, setRemediation] = useState<{
    topic: string;
    guideMarkdown: string;
    notebookLmPrompt: string;
  } | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Settings form
  const [autoHabitRule, setAutoHabitRule] = useState<'zero_review_learning' | 'min_reviews'>(
    syncState?.auto_habit_rule || 'zero_review_learning'
  );
  const [minReviews, setMinReviews] = useState(syncState?.auto_habit_min_reviews || 50);
  const [defaultDeck, setDefaultDeck] = useState(syncState?.default_deck || 'Schulich');
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const loadLeeches = useCallback(async () => {
    setLoadingLeeches(true);
    try {
      const res = await fetch(`/api/anki/leeches?minLapses=${minLapses}`);
      const data = await res.json();
      if (data.success) {
        setGroups(data.groups || []);
      }
    } finally {
      setLoadingLeeches(false);
    }
  }, [minLapses]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadLeeches();
    }, 0);
    return () => clearTimeout(t);
  }, [loadLeeches]);

  const handleGenerateRemediation = async (grp: AnkiLeechGroup) => {
    setGeneratingTopic(grp.topic);
    try {
      const res = await fetch('/api/anki/leeches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: `${grp.topic} (${grp.deckName})`,
          cards: grp.cards,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRemediation({
          topic: data.topic,
          guideMarkdown: data.guideMarkdown,
          notebookLmPrompt: data.notebookLmPrompt,
        });
      }
    } finally {
      setGeneratingTopic(null);
    }
  };

  const handleCopyPrompt = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {}
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await onSaveSettings({
        auto_habit_rule: autoHabitRule,
        auto_habit_min_reviews: minReviews,
        default_deck: defaultDeck,
      });
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* SECTION 1: Leech & Weak-Topic Remediation */}
      <div className="rounded-2xl border border-rose-500/25 bg-[#121218] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="h-5 w-5 text-rose-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Leech &amp; Weak-Topic Remediation
              </h3>
              <p className="text-xs text-zinc-400">
                Groups high-lapse cards by topic so Gemini can build side-by-side differentiation tables &amp; NotebookLM follow-up prompts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Min lapses:</span>
            <select
              value={minLapses}
              onChange={(e) => setMinLapses(parseInt(e.target.value, 10) || 4)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1 text-white font-mono"
            >
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}+ lapses
                </option>
              ))}
            </select>
          </div>
        </div>

        {loadingLeeches ? (
          <div className="py-10 text-center text-xs text-zinc-400">Scanning for leech clusters...</div>
        ) : groups.length === 0 ? (
          <div className="py-10 text-center rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-500">
            No active cards with {minLapses}+ lapses found! Your retention is holding strong.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.slice(0, 10).map((grp) => (
              <div
                key={`${grp.deckName}-${grp.topic}`}
                className="p-4 rounded-xl bg-[#0F1016] border border-zinc-800/90 space-y-2.5 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white truncate">{grp.topic}</span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0">
                      {grp.cardCount} cards · avg {grp.avgLapses} lapses
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 truncate">{grp.deckName}</div>
                  <ul className="space-y-1 pt-1">
                    {grp.cards.slice(0, 3).map((c) => (
                      <li key={c.card_id} className="text-xs text-zinc-300 line-clamp-1">
                        • ({c.lapses}×) {c.front_text}
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => handleGenerateRemediation(grp)}
                  disabled={generatingTopic === grp.topic}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-500/30 text-xs font-semibold transition cursor-pointer"
                >
                  {generatingTopic === grp.topic ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {generatingTopic === grp.topic
                      ? 'Building Remediation Guide...'
                      : 'Generate AI Remediation Guide'}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}

        {remediation && (
          <div className="p-4 rounded-xl bg-[#0C0E16] border border-cyan-500/30 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-cyan-300">
                Remediation Sheet: {remediation.topic}
              </h4>
              <button
                onClick={() => handleCopyPrompt(remediation.notebookLmPrompt)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/35 text-xs font-medium cursor-pointer"
              >
                {copiedPrompt ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedPrompt ? 'Copied NotebookLM Prompt!' : 'Copy NotebookLM Prompt'}</span>
              </button>
            </div>
            <pre className="text-xs text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed max-h-96 overflow-y-auto p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80">
              {remediation.guideMarkdown}
            </pre>
          </div>
        )}
      </div>

      {/* SECTION 2: Windows Sync Bridge Health & Auto-Habit Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Bridge Health & Setup */}
        <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {bridgeOnline ? (
                <Wifi className="h-4 w-4 text-emerald-400" />
              ) : (
                <WifiOff className="h-4 w-4 text-amber-400" />
              )}
              <h3 className="text-sm font-semibold text-white">Windows Anki Bridge</h3>
            </div>
            <button
              onClick={onTriggerSync}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3 text-cyan-400" />
              Queue AnkiWeb Sync
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-[#0F1016] border border-zinc-800">
              <div className="text-zinc-500 text-[11px]">Bridge Status</div>
              <div className={`font-semibold mt-0.5 ${bridgeOnline ? 'text-emerald-400' : 'text-amber-300'}`}>
                {bridgeOnline ? 'Online & Polling' : 'Waiting for PC / Anki'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#0F1016] border border-zinc-800">
              <div className="text-zinc-500 text-[11px]">Pending Cloud Queue</div>
              <div className="font-semibold text-white mt-0.5 font-mono">
                {pendingActions.filter((a) => a.status === 'pending').length} queued
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0B0C12] border border-zinc-800 space-y-2 text-xs">
            <div className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-cyan-400" />
              Windows One-Time Setup
            </div>
            <ol className="list-decimal list-inside space-y-1 text-zinc-400 text-[11px]">
              <li>
                In Anki Desktop: <strong>Tools → Add-ons → Get Add-ons</strong> → code{' '}
                <code className="text-cyan-300 bg-zinc-900 px-1 py-0.5 rounded">2055492159</code> (AnkiConnect), then restart Anki.
              </li>
              <li>
                Double-click <code className="text-cyan-300 bg-zinc-900 px-1 py-0.5 rounded">anki-bridge\start-bridge.bat</code> (or run{' '}
                <code className="text-cyan-300 bg-zinc-900 px-1 py-0.5 rounded">install-startup-task.ps1</code> for silent startup).
              </li>
            </ol>
          </div>
        </div>

        {/* Auto-Habit & Defaults Settings */}
        <form
          onSubmit={handleSave}
          className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-4 text-xs"
        >
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Auto-Habit &amp; Deck Defaults</h3>
          </div>

          <div>
            <label className="text-zinc-400 block mb-1">Daily Anki Habit Auto-Check Rule</label>
            <select
              value={autoHabitRule}
              onChange={(e) =>
                setAutoHabitRule(e.target.value as 'zero_review_learning' | 'min_reviews')
              }
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="zero_review_learning">
                Review + Learning cards due reach 0 (Recommended)
              </option>
              <option value="min_reviews">
                Reach minimum daily reviews count
              </option>
            </select>
          </div>

          {autoHabitRule === 'min_reviews' && (
            <div>
              <label className="text-zinc-400 block mb-1">Minimum Reviews Target</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={minReviews}
                onChange={(e) => setMinReviews(parseInt(e.target.value, 10) || 50)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white font-mono"
              />
            </div>
          )}

          <div>
            <label className="text-zinc-400 block mb-1">Default Deck for New Cards</label>
            <input
              type="text"
              value={defaultDeck}
              onChange={(e) => setDefaultDeck(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            {savedToast ? (
              <span className="text-emerald-400 font-medium">✓ Settings saved</span>
            ) : (
              <span className="text-zinc-500">4 AM ET productivity day aligned</span>
            )}
            <button
              type="submit"
              disabled={savingSettings}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-cyan-950 font-semibold transition cursor-pointer"
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
