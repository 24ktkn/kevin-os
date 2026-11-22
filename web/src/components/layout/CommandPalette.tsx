'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  CalendarPlus,
  Check,
  Dumbbell,
  Flame,
  GraduationCap,
  HeartPulse,
  Home,
  Plus,
  RefreshCw,
  Rocket,
  Scale,
  Search,
  Sparkles,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { getTodayDateStr } from '@/lib/date-utils';
import { CalendarName } from '@/types/task';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAGES = [
  { name: 'Home Dashboard', href: '/', icon: Home, keywords: 'home overview morning brief readiness' },
  { name: 'Mission Control (Tasks)', href: '/tasks', icon: Rocket, keywords: 'tasks calendar schedule todo' },
  { name: 'School Sync (Elentra)', href: '/school', icon: GraduationCap, keywords: 'school modules lectures elentra schulich' },
  { name: 'Anki Command Center', href: '/anki', icon: Brain, keywords: 'anki cards flashcards review leeches exam pacing' },
  { name: 'Weekly Executive Review', href: '/review', icon: BarChart3, keywords: 'sunday weekly review executive digest grade' },
  { name: 'CaRMS Med School Portfolio', href: '/portfolio', icon: Award, keywords: 'carms cv portfolio canmeds research shadowing volunteering' },
  { name: 'Habit Tracker', href: '/habits', icon: Flame, keywords: 'habits streaks wake gym journal anki' },
  { name: 'Health Tracker', href: '/health', icon: HeartPulse, keywords: 'health sleep hrv rhr steps weight biometrics' },
  { name: 'Workout Tracker (Hevy)', href: '/workouts', icon: Dumbbell, keywords: 'gym workouts hevy lifting 1rm' },
  { name: 'Meal Prep (Costco)', href: '/meals', icon: UtensilsCrossed, keywords: 'costco groceries meals prep food' },
  { name: 'Daily Journal', href: '/journal', icon: BookOpen, keywords: 'journal reflection diary notes' },
  { name: 'AI Scheduler', href: '/ai', icon: Bot, keywords: 'ai scheduler natural language timeblock' },
];

type PaletteTab = 'search' | 'task' | 'log';

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<PaletteTab>('search');
  const [query, setQuery] = useState('');

  // Inline Anki search results
  const [ankiResults, setAnkiResults] = useState<
    Array<{ card_id: number; deck_name: string; front_text: string; suspended: boolean }>
  >([]);
  const [searchingAnki, setSearchingAnki] = useState(false);

  // Quick Task / Timeblock state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDate, setTaskDate] = useState(() => getTodayDateStr());
  const [taskTime, setTaskTime] = useState('');
  const [taskDuration, setTaskDuration] = useState(45);
  const [taskCal, setTaskCal] = useState<CalendarName>('School');
  const [savingAction, setSavingAction] = useState(false);

  // Quick Log state (Weight / Habit / Journal)
  const [quickWeight, setQuickWeight] = useState('');
  const [quickJournal, setQuickJournal] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      setStatusMsg(null);
      inputRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [isOpen, tab]);

  useEffect(() => {
    if (!isOpen || tab !== 'search') return;
    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      if (trimmed.length < 3) {
        setAnkiResults([]);
        return;
      }
      setSearchingAnki(true);
      try {
        const res = await fetch(`/api/anki/cards?q=${encodeURIComponent(trimmed)}&limit=6`);
        const data = await res.json();
        if (data.success && Array.isArray(data.cards)) {
          setAnkiResults(data.cards);
        }
      } catch {
        // ignore
      } finally {
        setSearchingAnki(false);
      }
    }, 240);
    return () => clearTimeout(timer);
  }, [query, isOpen, tab]);

  if (!isOpen) return null;

  const qLower = query.trim().toLowerCase();
  const filteredPages = qLower
    ? PAGES.filter(
        (p) =>
          p.name.toLowerCase().includes(qLower) ||
          p.keywords.toLowerCase().includes(qLower) ||
          p.href.toLowerCase().includes(qLower)
      )
    : PAGES;

  const navigate = (href: string) => {
    onClose();
    setQuery('');
    router.push(href);
  };

  const handleQuickTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setSavingAction(true);
    setStatusMsg(null);
    try {
      const skipCal = !taskTime.trim();
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle.trim(),
          date: taskDate,
          time: taskTime.trim() || '11:59 PM',
          duration: skipCal ? 0 : taskDuration,
          calendar: taskCal,
          skipCalendar: skipCal,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg(
          skipCal
            ? `Added "${taskTitle.trim()}" to Google Tasks & Kevin-OS!`
            : `Timeblocked "${taskTitle.trim()}" on ${taskDate} at ${taskTime.trim()}!`
        );
        setTaskTitle('');
        setTaskTime('');
      } else {
        setStatusMsg(data.error || 'Could not schedule task.');
      }
    } finally {
      setSavingAction(false);
    }
  };

  const handleQuickWeight = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = parseFloat(quickWeight);
    if (!w || w < 60 || w > 380) return;
    setSavingAction(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/health/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: getTodayDateStr(), weight: w, timezone: 'America/New_York' }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg(`Logged today's bodyweight: ${w} lbs!`);
        setQuickWeight('');
      }
    } finally {
      setSavingAction(false);
    }
  };

  const handleQuickHabit = async (habitName: string) => {
    setSavingAction(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habitName, completed: true }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg(`Checked off "${habitName}" for today!`);
      }
    } finally {
      setSavingAction(false);
    }
  };

  const handleQuickJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickJournal.trim()) return;
    setSavingAction(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: getTodayDateStr(),
          journal: quickJournal.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg('Saved quick note to today’s Journal!');
        setQuickJournal('');
      }
    } finally {
      setSavingAction(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-3 sm:px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-[#11121A] border border-zinc-700/80 shadow-2xl shadow-black/60 overflow-hidden">
        {/* Top Mode Tabs + Close */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2 bg-[#0D0E14]">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTab('search')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                tab === 'search'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Jump &amp; Search</span>
            </button>
            <button
              onClick={() => setTab('task')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                tab === 'task'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/35'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              <span>Quick Task</span>
            </button>
            <button
              onClick={() => setTab('log')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                tab === 'log'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Quick Log</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
            aria-label="Close command palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {statusMsg && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-xs text-emerald-200 flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* TAB 1: Jump to Page + Live 8,000+ Anki Card Search */}
        {tab === 'search' && (
          <div className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredPages.length > 0) {
                    navigate(filteredPages[0].href);
                  }
                }}
                placeholder="Jump to any page or search 8,000+ Anki cards (e.g. 'anki', 'vancomycin', 'carms')..."
                className="w-full bg-[#0A0B10] border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
              {filteredPages.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 px-2">
                    Kevin-OS Pages
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {filteredPages.map((p) => {
                      const Icon = p.icon;
                      return (
                        <button
                          key={p.href}
                          onClick={() => navigate(p.href)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs text-zinc-200 hover:text-white bg-zinc-900/50 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition cursor-pointer"
                        >
                          <Icon className="h-4 w-4 text-cyan-400 shrink-0" />
                          <span className="truncate font-medium">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {query.trim().length >= 3 && (
                <div className="space-y-1.5 pt-1 border-t border-zinc-800/80">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-400">
                      Live Anki Card Matches
                    </span>
                    {searchingAnki && <RefreshCw className="h-3 w-3 text-cyan-400 animate-spin" />}
                  </div>
                  {ankiResults.length === 0 && !searchingAnki ? (
                    <div className="text-xs text-zinc-500 px-2 py-2">
                      No matching Anki cards for &ldquo;{query.trim()}&rdquo;.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {ankiResults.map((c) => (
                        <button
                          key={c.card_id}
                          onClick={() => navigate('/anki')}
                          className="w-full text-left p-2.5 rounded-xl bg-[#0D101A] hover:bg-zinc-900 border border-zinc-800 hover:border-indigo-500/40 transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2 text-[10px] mb-0.5">
                            <span className="font-mono text-cyan-300 truncate">{c.deck_name}</span>
                            {c.suspended && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300">
                                Suspended
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-200 line-clamp-2">{c.front_text}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Quick Capture Task / Timeblock */}
        {tab === 'task' && (
          <form onSubmit={handleQuickTaskSubmit} className="p-4 space-y-3 text-xs">
            <div>
              <label className="text-zinc-400 block mb-1">Task or Timeblock Title</label>
              <input
                ref={inputRef}
                type="text"
                required
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g. Review Hematology slides or Email Dr. Smith"
                className="w-full bg-[#0A0B10] border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="text-zinc-400 block mb-1">Date</label>
                <input
                  type="date"
                  value={taskDate}
                  onChange={(e) => setTaskDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-white [color-scheme:dark]"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Time (Opt. for Cal)</label>
                <input
                  type="text"
                  value={taskTime}
                  onChange={(e) => setTaskTime(e.target.value)}
                  placeholder="e.g. 2:00 PM"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Duration (m)</label>
                <input
                  type="number"
                  min={15}
                  max={300}
                  step={15}
                  value={taskDuration}
                  onChange={(e) => setTaskDuration(parseInt(e.target.value, 10) || 45)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Calendar</label>
                <select
                  value={taskCal}
                  onChange={(e) => setTaskCal(e.target.value as CalendarName)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-white"
                >
                  <option value="School">School</option>
                  <option value="Kevin Nguyen">Kevin Nguyen</option>
                  <option value="Family">Family</option>
                  <option value="Volunteering">Volunteering</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-zinc-500">
                Leave time blank for Google Task only, or set time to also timeblock on Calendar.
              </span>
              <button
                type="submit"
                disabled={savingAction}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 text-white font-semibold cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{savingAction ? 'Adding...' : 'Add Task'}</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 3: Quick Log Weight, Habits & Journal */}
        {tab === 'log' && (
          <div className="p-4 space-y-4 text-xs">
            {/* Quick Habits */}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-500">
                1-Tap Check Off Habit Today
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {['Wake Up On Time', 'Gym Workout', 'Journaling', 'Anki'].map((h) => (
                  <button
                    key={h}
                    onClick={() => handleQuickHabit(h)}
                    disabled={savingAction}
                    className="px-2.5 py-2 rounded-xl bg-zinc-900 hover:bg-emerald-500/15 border border-zinc-800 hover:border-emerald-500/35 text-zinc-200 hover:text-emerald-200 font-medium transition cursor-pointer"
                  >
                    ✓ {h}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Bodyweight */}
            <form onSubmit={handleQuickWeight} className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-zinc-400 flex items-center gap-1.5 mb-1">
                  <Scale className="h-3.5 w-3.5 text-cyan-400" />
                  Log Today&apos;s Bodyweight (lbs)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={quickWeight}
                  onChange={(e) => setQuickWeight(e.target.value)}
                  placeholder="e.g. 172.4"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={savingAction || !quickWeight}
                className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/35 font-semibold cursor-pointer"
              >
                Save Weight
              </button>
            </form>

            {/* Quick Journal Line */}
            <form onSubmit={handleQuickJournal} className="space-y-2">
              <label className="text-zinc-400 flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
                Quick Journal Thought (Today)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickJournal}
                  onChange={(e) => setQuickJournal(e.target.value)}
                  placeholder="Quick reflection or win from today..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white"
                />
                <button
                  type="submit"
                  disabled={savingAction || !quickJournal.trim()}
                  className="px-4 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/35 font-semibold cursor-pointer"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="px-4 py-2 border-t border-zinc-800/80 bg-[#0B0C11] flex items-center justify-between text-[10px] text-zinc-500">
          <span>Shortcut: ⌘K / Ctrl+K anywhere in Kevin-OS</span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
}
