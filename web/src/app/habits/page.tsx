'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  Flame,
  CheckCircle2,
  Circle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  TrendingUp,
  Award,
  RefreshCw,
} from 'lucide-react';

interface HabitDay {
  dayNumber: number;
  dateStr: string;
  completed: boolean;
  isToday: boolean;
  isFuture: boolean;
}

interface HabitItem {
  name: string;
  icon: string;
  streak: number;
  consistencyRate: number;
  totalCompleted?: number;
  totalDays?: number;
  completedToday: boolean;
  monthName: string;
  year: number;
  days: HabitDay[];
}

interface VelocityDay {
  date: string;
  dayLabel: string;
  wake: boolean;
  gym: boolean;
  journal: boolean;
  anki: boolean;
  total: number;
}

interface RawHistoryRecord {
  'Wake Up On Time': boolean;
  'Gym Workout': boolean;
  'Journaling': boolean;
  'Anki': boolean;
  total: number;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function HabitsPage() {
  const [habits, setHabits] = useState<HabitItem[]>([]);
  const [velocity30Days, setVelocity30Days] = useState<VelocityDay[]>([]);
  const [rawHistory, setRawHistory] = useState<Record<string, RawHistoryRecord>>({});
  const [todayStr, setTodayStr] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [updatingHabit, setUpdatingHabit] = useState<string | null>(null);

  // Calendar Heatmap Controls
  const [selectedFilter, setSelectedFilter] = useState<string>('All Habits (Combined Count)');
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth() + 1); // 1-12

  const fetchHabits = useCallback(async () => {
    try {
      const res = await fetch('/api/habits');
      const data = await res.json();
      if (data.success) {
        setHabits(data.habits || []);
        setTodayStr(data.today || '');
        if (data.velocity30Days) setVelocity30Days(data.velocity30Days);
        if (data.rawHistory) setRawHistory(data.rawHistory);
      }
    } catch (err) {
      console.error('Failed to load habits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHabits();
  }, [fetchHabits]);

  // Toggle Habit Completion with Optimistic UI
  const handleToggleHabit = async (habitName: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    setUpdatingHabit(habitName);

    // Optimistic update
    setHabits((prev) =>
      prev.map((h) => {
        if (h.name === habitName) {
          const newStreak = nextStatus ? h.streak + 1 : Math.max(0, h.streak - 1);
          return { ...h, completedToday: nextStatus, streak: newStreak };
        }
        return h;
      })
    );

    // Update rawHistory optimistically
    if (todayStr) {
      setRawHistory((prev) => {
        const cur = prev[todayStr] || {
          'Wake Up On Time': false,
          'Gym Workout': false,
          'Journaling': false,
          'Anki': false,
          total: 0,
        };
        const updated = { ...cur, [habitName]: nextStatus };
        updated.total =
          (updated['Wake Up On Time'] ? 1 : 0) +
          (updated['Gym Workout'] ? 1 : 0) +
          (updated['Journaling'] ? 1 : 0) +
          (updated['Anki'] ? 1 : 0);
        return { ...prev, [todayStr]: updated };
      });
    }

    try {
      await fetch('/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habit: habitName, completed: nextStatus }),
      });
    } catch (err) {
      console.error('Failed to persist habit:', err);
      fetchHabits(); // rollback on error
    } finally {
      setUpdatingHabit(null);
    }
  };

  // Month Navigation
  const handlePrevMonth = () => {
    if (calMonth === 1) {
      setCalMonth(12);
      setCalYear((y) => y - 1);
    } else {
      setCalMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calMonth === 12) {
      setCalMonth(1);
      setCalYear((y) => y + 1);
    } else {
      setCalMonth((m) => m + 1);
    }
  };

  // Monthly Calendar Grid Generator
  const calendarGrid = useMemo(() => {
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    // 0 = Sun, 1 = Mon ... 6 = Sat -> convert to Mon = 0 .. Sun = 6
    const firstDayWeekday = (new Date(calYear, calMonth - 1, 1).getDay() + 6) % 7;

    const cells: Array<{
      dayNum: number;
      dateStr: string;
      isToday: boolean;
      isFuture: boolean;
      record?: RawHistoryRecord;
    }> = [];

    // Pre-pad empty days
    for (let i = 0; i < firstDayWeekday; i++) {
      cells.push({ dayNum: 0, dateStr: '', isToday: false, isFuture: false });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dStr === todayStr;
      const isFuture = dStr > todayStr;
      const record = rawHistory[dStr];

      cells.push({
        dayNum: day,
        dateStr: dStr,
        isToday,
        isFuture,
        record,
      });
    }

    return cells;
  }, [calYear, calMonth, todayStr, rawHistory]);

  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0F0F14]/90 backdrop-blur-md px-4 sm:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-400" /> Habit Core Engine
            </h1>
            <span className="text-xs text-zinc-400 font-mono">| {todayFormatted}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Daily execution routines, streak tracking & consistency analytics (2:00 AM Night Owl Rollover)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setLoading(true);
              fetchHabits();
            }}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Sync Ledger</span>
          </button>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {/* SECTION 1: TODAY'S QUICK CHECK-OFF MATRIX */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-400 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-400" /> Today&apos;s Target Agenda
            </h2>
            <span className="text-xs font-mono text-zinc-500">
              Target Date: <span className="text-white font-semibold">{todayStr || 'Today'}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {habits.map((h) => {
              const isUpdating = updatingHabit === h.name;
              return (
                <div
                  key={h.name}
                  onClick={() => !isUpdating && handleToggleHabit(h.name, h.completedToday)}
                  className={`group cursor-pointer rounded-2xl p-5 border transition-all duration-200 select-none relative overflow-hidden ${
                    h.completedToday
                      ? 'bg-emerald-950/20 border-emerald-500/40 shadow-lg shadow-emerald-950/30'
                      : 'bg-[#121218] border-zinc-800 hover:border-zinc-700 hover:bg-[#16161F]'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-11 w-11 rounded-xl flex items-center justify-center text-xl transition-all ${
                          h.completedToday
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 scale-105'
                            : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 group-hover:border-zinc-600'
                        }`}
                      >
                        {h.icon}
                      </div>
                      <div>
                        <h3
                          className={`text-sm font-bold tracking-tight transition-colors ${
                            h.completedToday ? 'text-emerald-400' : 'text-white group-hover:text-cyan-300'
                          }`}
                        >
                          {h.name}
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {h.completedToday ? (
                            <span className="text-emerald-400 font-medium flex items-center gap-1">
                              ✓ Completed for today
                            </span>
                          ) : (
                            <span>Tap to complete routine</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={`h-7 w-7 rounded-full flex items-center justify-center transition-all ${
                        h.completedToday
                          ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/30'
                          : 'border-2 border-zinc-700 text-transparent group-hover:border-cyan-400'
                      }`}
                    >
                      {h.completedToday ? (
                        <CheckCircle2 className="h-5 w-5 stroke-[2.5]" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </button>
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5 text-amber-500" />
                      <strong className="text-white">{h.streak}</strong> day streak
                    </span>
                    <span className="text-cyan-400 font-medium font-mono">{h.consistencyRate}% consistent</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 2: STREAK MATRIX & CONSISTENCY KPIS */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {habits.map((h) => (
            <div
              key={`kpi-${h.name}`}
              className="rounded-2xl border border-zinc-800/80 bg-[#121218] p-5 space-y-3 relative overflow-hidden"
            >
              <div className="flex items-center justify-between text-xs text-zinc-400 uppercase tracking-wider">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Award className="h-3.5 w-3.5 text-cyan-400" /> {h.name}
                </span>
                <span className="font-mono text-emerald-400 font-bold">{h.consistencyRate}%</span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-white tracking-tight">{h.streak}</span>
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                  <Flame className="h-4 w-4 text-amber-500 animate-bounce" /> Day Streak
                </span>
              </div>

              <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, h.consistencyRate)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
                <span>Total hit: {h.totalCompleted ?? '—'} days</span>
                <span>Tracked: {h.totalDays ?? '—'} days</span>
              </div>
            </div>
          ))}
        </section>

        {/* SECTION 3: 30-DAY COMPLETENESS VELOCITY */}
        <section className="rounded-2xl border border-zinc-800/80 bg-[#121218] p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-300 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" /> 30-Day Completeness Velocity
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Stacked daily habits completed over the last 30 productivity cycles
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400"></span> 4/4 Full Hit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-cyan-400"></span> 3/4 Solid
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-400"></span> 2/4 Half
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-zinc-600"></span> 1/4 Partial
              </span>
            </div>
          </div>

          {/* Velocity Bar Chart */}
          <div className="pt-2">
            <div className="flex items-end gap-1.5 sm:gap-2 h-36 border-b border-zinc-800/80 pb-2 overflow-x-auto">
              {velocity30Days.map((v) => {
                const heightPct =
                  v.total === 4
                    ? 100
                    : v.total === 3
                    ? 75
                    : v.total === 2
                    ? 50
                    : v.total === 1
                    ? 25
                    : 6;
                const barColor =
                  v.total === 4
                    ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-md shadow-emerald-500/20'
                    : v.total === 3
                    ? 'bg-gradient-to-t from-cyan-600 to-cyan-400'
                    : v.total === 2
                    ? 'bg-gradient-to-t from-indigo-600 to-indigo-400'
                    : v.total === 1
                    ? 'bg-zinc-600'
                    : 'bg-zinc-800/60';

                return (
                  <div
                    key={v.date}
                    className="flex-1 min-w-[12px] flex flex-col items-center justify-end h-full group relative"
                  >
                    {/* Hover Tooltip */}
                    <div className="absolute -top-12 z-30 hidden group-hover:flex flex-col items-center pointer-events-none whitespace-nowrap bg-zinc-900 border border-zinc-700 text-white text-[10px] px-2 py-1 rounded-md shadow-xl">
                      <span className="font-semibold">{v.dayLabel}</span>
                      <span className="text-zinc-400">{v.total}/4 Habits Done</span>
                    </div>

                    <div
                      className={`w-full rounded-t-md transition-all duration-300 ${barColor}`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono pt-2">
              <span>30 Days Ago</span>
              <span>15 Days Ago</span>
              <span>Today ({todayStr})</span>
            </div>
          </div>
        </section>

        {/* SECTION 4: MONTHLY HABIT CALENDAR HEATMAP */}
        <section className="rounded-2xl border border-zinc-800/80 bg-[#121218] p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-300 flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-cyan-400" /> Monthly Habit Calendar Heatmap
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Visual matrix of all habit routines for {MONTH_NAMES[calMonth - 1]} {calYear}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Habit Filter Dropdown */}
              <select
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="All Habits (Combined Count)">All Habits (Combined Count)</option>
                <option value="Wake Up On Time">Wake Up On Time ⏰</option>
                <option value="Gym Workout">Gym Workout 💪</option>
                <option value="Journaling">Journaling ✍️</option>
                <option value="Anki">Anki 🎴</option>
              </select>

              {/* Month / Year Navigator */}
              <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                <button
                  onClick={handlePrevMonth}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                  title="Previous Month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-semibold px-2 text-white">
                  {MONTH_NAMES[calMonth - 1]} {calYear}
                </span>
                <button
                  onClick={handleNextMonth}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                  title="Next Month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Calendar Grid */}
          <div className="space-y-2">
            {/* Weekday Header */}
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-zinc-400 uppercase tracking-wider py-1">
              <div>Mon</div>
              <div>Tue</div>
              <div>Wed</div>
              <div>Thu</div>
              <div>Fri</div>
              <div>Sat</div>
              <div>Sun</div>
            </div>

            {/* Calendar Cells */}
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {calendarGrid.map((c, i) => {
                if (c.dayNum === 0) {
                  return <div key={`empty-${i}`} className="h-16 sm:h-20 rounded-xl bg-transparent" />;
                }

                let isCompleted = false;
                let completionCount = 0;
                if (c.record) {
                  completionCount = c.record.total;
                  if (selectedFilter === 'All Habits (Combined Count)') {
                    isCompleted = completionCount > 0;
                  } else {
                    isCompleted = Boolean(c.record[selectedFilter as keyof RawHistoryRecord]);
                  }
                }

                // Color coding
                let tileBg = 'bg-zinc-900/60 border-zinc-800/60 text-zinc-500';
                if (!c.isFuture && isCompleted) {
                  if (selectedFilter === 'All Habits (Combined Count)') {
                    if (completionCount === 4) {
                      tileBg = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-sm';
                    } else if (completionCount === 3) {
                      tileBg = 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300';
                    } else if (completionCount === 2) {
                      tileBg = 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300';
                    } else {
                      tileBg = 'bg-zinc-800/90 border-zinc-700/80 text-zinc-300';
                    }
                  } else {
                    tileBg = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-sm';
                  }
                } else if (!c.isFuture && c.record) {
                  tileBg = 'bg-[#14141B] border-zinc-800/80 text-zinc-500';
                }

                if (c.isToday) {
                  tileBg += ' ring-2 ring-cyan-400 ring-offset-2 ring-offset-[#0A0A0D]';
                }

                return (
                  <div
                    key={c.dateStr}
                    className={`h-16 sm:h-20 rounded-xl border p-2 flex flex-col justify-between transition-all duration-150 group relative ${tileBg}`}
                  >
                    {/* Hover Info Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center pointer-events-none z-30 whitespace-nowrap bg-black/90 border border-zinc-700 text-white text-[11px] p-2 rounded-lg shadow-2xl">
                      <span className="font-bold">{c.dateStr}</span>
                      <div className="text-[10px] text-zinc-300 mt-1 space-y-0.5 text-left">
                        <div>⏰ Wake: {c.record?.['Wake Up On Time'] ? '✓ Done' : '✕ Missed'}</div>
                        <div>💪 Gym: {c.record?.['Gym Workout'] ? '✓ Done' : '✕ Missed'}</div>
                        <div>✍️ Journal: {c.record?.['Journaling'] ? '✓ Done' : '✕ Missed'}</div>
                        <div>🎴 Anki: {c.record?.['Anki'] ? '✓ Done' : '✕ Missed'}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${c.isToday ? 'text-cyan-400' : ''}`}>{c.dayNum}</span>
                      {c.isToday && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                          TODAY
                        </span>
                      )}
                    </div>

                    <div className="text-right">
                      {selectedFilter === 'All Habits (Combined Count)' ? (
                        <span
                          className={`text-xs font-mono font-bold ${
                            completionCount === 4
                              ? 'text-emerald-400'
                              : completionCount === 3
                              ? 'text-cyan-400'
                              : completionCount === 2
                              ? 'text-indigo-400'
                              : completionCount === 1
                              ? 'text-zinc-400'
                              : 'text-zinc-600'
                          }`}
                        >
                          {completionCount > 0 ? `${completionCount}/4` : '—'}
                        </span>
                      ) : (
                        <span className="text-xs font-bold">
                          {isCompleted ? '✓' : c.isFuture ? '' : '—'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
