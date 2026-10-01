'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Activity,
  Flame,
  CheckCircle2,
  Calendar,
  Clock,
  RefreshCw,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Moon,
  Sun,
  Heart,
  Scale,
  Zap,
  Timer,
  Check,
  Rocket,
  GraduationCap,
  Dumbbell,
  UtensilsCrossed,
  Bot,
  BookOpen,
  CalendarClock,
  CalendarCheck,
  ListTodo,
  Layers,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TaskItem, CalendarName } from '@/types/task';
import { isEventPast } from '@/lib/date-utils';
import { groupTodayAgendaItems, UnifiedAgendaItem } from '@/lib/agenda-utils';
import RescheduleModal from '@/components/tasks/RescheduleModal';

interface HealthData {
  date: string;
  raw_date: string;
  steps: number;
  steps_goal: number;
  steps_percentage: number;
  hrv: number;
  sleep_duration: string;
  sleep_hours: number;
  sleep_time: string;
  wake_time: string;
  rhr: number;
  bodyweight: number;
  workout_calories: number;
  workout_duration: number;
}

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
  completedToday: boolean;
  monthName: string;
  year: number;
  days: HabitDay[];
}

const CALENDAR_COLORS: Record<CalendarName, { bg: string; text: string; border: string }> = {
  'School': { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30' },
  'Kevin Nguyen': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  'Family': { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30' },
  'Volunteering': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
};

export default function HomePage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [habits, setHabits] = useState<HabitItem[]>([]);
  const [todayTasks, setTodayTasks] = useState<TaskItem[]>([]);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [loadingHabits, setLoadingHabits] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingHabit, setTogglingHabit] = useState<string | null>(null);

  // Fetch Health Biometrics
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const json = await res.json();
      if (json.success && json.data) {
        setHealth(json.data);
      }
    } catch (err) {
      console.error('Failed to load health metrics:', err);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  // Fetch Habits
  const fetchHabits = useCallback(async () => {
    try {
      const res = await fetch('/api/habits');
      const json = await res.json();
      if (json.success && json.habits) {
        setHabits(json.habits);
      }
    } catch (err) {
      console.error('Failed to load habits:', err);
    } finally {
      setLoadingHabits(false);
    }
  }, []);

  const [reschedulingItem, setReschedulingItem] = useState<UnifiedAgendaItem | null>(null);

  // Fetch Today's Tasks & Events from Supabase with Option A auto-sweep
  const fetchTodayTasks = useCallback(async () => {
    try {
      if (supabase) {
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('due_date', todayStr)
          .order('due_time', { ascending: true, nullsFirst: false });

        if (!error && data) {
          const raw = data as TaskItem[];
          const pastEventIds: string[] = [];

          // Option A: Auto-sweep past events to completed
          const processed = raw.map((t) => {
            if (!t.is_completed && t.type === 'Event' && isEventPast(t.due_date, t.due_time, t.duration_mins)) {
              pastEventIds.push(t.id);
              return { ...t, is_completed: true };
            }
            return t;
          });

          setTodayTasks(processed);

          if (pastEventIds.length > 0) {
            supabase
              .from('tasks')
              .update({ is_completed: true, updated_at: new Date().toISOString() })
              .in('id', pastEventIds)
              .then();
          }
        }
      }
    } catch (err) {
      console.error('Failed to load today tasks:', err);
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  // 60-second background heartbeat to check if any active timeblock has passed
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTodayTasks();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchTodayTasks]);

  // Load all initial data
  const loadAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchHealth(), fetchHabits(), fetchTodayTasks()]);
    setRefreshing(false);
  }, [fetchHealth, fetchHabits, fetchTodayTasks]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Group today's tasks into deduplicated unified items
  const unifiedAgendaItems = useMemo(() => {
    return groupTodayAgendaItems(todayTasks);
  }, [todayTasks]);

  // Toggle habit completion with instant optimistic update
  const toggleHabit = async (habitName: string, currentCompleted: boolean) => {
    const nextCompleted = !currentCompleted;
    setTogglingHabit(habitName);

    // Optimistic update
    setHabits((prev) =>
      prev.map((h) => {
        if (h.name === habitName) {
          const updatedDays = h.days.map((d) => (d.isToday ? { ...d, completed: nextCompleted } : d));
          const newStreak = nextCompleted ? h.streak + 1 : Math.max(0, h.streak - 1);
          return {
            ...h,
            completedToday: nextCompleted,
            streak: newStreak,
            days: updatedDays,
          };
        }
        return h;
      })
    );

    try {
      const res = await fetch('/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habit: habitName, completed: nextCompleted }),
      });
      const data = await res.json();
      if (!data.success) {
        // Revert on error
        fetchHabits();
      }
    } catch (err) {
      console.error('Error toggling habit:', err);
      fetchHabits();
    } finally {
      setTogglingHabit(null);
    }
  };

  // Toggle Timeblock Only (Google Calendar / Supabase Event)
  const toggleTimeblockOnly = async (eventId: string, currentCompleted: boolean) => {
    const nextCompleted = !currentCompleted;
    setTodayTasks((prev) =>
      prev.map((t) => (t.id === eventId ? { ...t, is_completed: nextCompleted } : t))
    );

    if (supabase) {
      await supabase
        .from('tasks')
        .update({ is_completed: nextCompleted, updated_at: new Date().toISOString() })
        .eq('id', eventId);
    }
  };

  // Toggle Task Checklist Only (Google Tasks / School Sync / Supabase Task)
  const toggleTaskOnly = async (
    taskId: string,
    currentCompleted: boolean,
    title: string,
    calendarName: string,
    googleTaskId?: string
  ) => {
    const nextCompleted = !currentCompleted;
    setTodayTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, is_completed: nextCompleted } : t))
    );

    fetch('/api/tasks/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        googleTaskId,
        title,
        calendar_name: calendarName,
        completed: nextCompleted,
      }),
    }).catch((err) => console.error('Failed to sync task completion to Google Tasks:', err));

    if (supabase) {
      await supabase
        .from('tasks')
        .update({ is_completed: nextCompleted, updated_at: new Date().toISOString() })
        .eq('id', taskId);

      const clean = title.replace(/^[🎓📚📝⏰\s\[\]Task:]+/gi, '').trim();
      if (clean) {
        await supabase
          .from('school_items')
          .update({ is_completed: nextCompleted, updated_at: new Date().toISOString() })
          .ilike('title', `%${clean}%`);
      }
    }
  };

  // Toggle Both Timeblock and Task Simultaneously (1-Click Complete Both)
  const toggleBoth = async (
    eventId: string,
    taskId: string,
    currentCompleted: boolean,
    title: string,
    calendarName: string,
    googleTaskId?: string
  ) => {
    const nextCompleted = !currentCompleted;
    setTodayTasks((prev) =>
      prev.map((t) => (t.id === eventId || t.id === taskId ? { ...t, is_completed: nextCompleted } : t))
    );

    fetch('/api/tasks/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        googleTaskId,
        title,
        calendar_name: calendarName,
        completed: nextCompleted,
      }),
    }).catch((err) => console.error('Failed to sync task completion to Google Tasks:', err));

    if (supabase) {
      await supabase
        .from('tasks')
        .update({ is_completed: nextCompleted, updated_at: new Date().toISOString() })
        .in('id', [eventId, taskId]);

      const clean = title.replace(/^[🎓📚📝⏰\s\[\]Task:]+/gi, '').trim();
      if (clean) {
        await supabase
          .from('school_items')
          .update({ is_completed: nextCompleted, updated_at: new Date().toISOString() })
          .ilike('title', `%${clean}%`);
      }
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0D] text-white p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto w-full">
      {/* Top Header & Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🧠</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              Personal Operating System
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            {getGreeting()}, Kevin
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            {todayFormatted} • Welcome to your unified command center.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadAll}
            disabled={refreshing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 hover:text-white transition shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <Link
            href="/tasks"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-xs font-semibold text-white transition shadow-lg shadow-cyan-500/20"
          >
            <Rocket className="h-3.5 w-3.5" />
            <span>Mission Control</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* 🧬 Biometrics Command Center */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              Biometrics Command Center
            </h2>
            {health && (
              <span className="text-[11px] font-mono text-zinc-400 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800">
                {health.date}
              </span>
            )}
          </div>
          <span className="text-xs text-zinc-400">Apple Health Synced</span>
        </div>

        {loadingHealth ? (
          <div className="h-32 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 animate-pulse flex items-center justify-center text-xs text-zinc-400">
            Loading Biometrics...
          </div>
        ) : health ? (
          <div className="space-y-3">
            {/* Daily Steps Tracker Hero Card */}
            <div className="p-5 rounded-2xl bg-[#14141B] border border-zinc-800/90 shadow-xl relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    Daily Steps Tracker
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-emerald-400 flex items-baseline gap-2">
                    {health.steps.toLocaleString()}
                    <span className="text-sm font-medium text-zinc-400">
                      / {health.steps_goal.toLocaleString()} steps
                    </span>
                  </div>
                </div>
                <div className="sm:text-right">
                  <div className="text-2xl font-black text-cyan-400">
                    {health.steps_percentage}%
                  </div>
                  <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                    Daily Goal
                  </div>
                </div>
              </div>

              {/* Steps Progress Bar */}
              <div className="w-full h-3 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-700 ease-out"
                  style={{ width: `${health.steps_percentage}%` }}
                />
              </div>
            </div>

            {/* 8-Column Compact Health Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {/* HRV */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  HRV (Variability)
                </div>
                <div className="text-xl font-black text-cyan-400">
                  {health.hrv > 0 ? `${health.hrv} ms` : 'No data'}
                </div>
              </div>

              {/* Sleep Duration */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  Sleep Duration
                </div>
                <div className="text-xl font-black text-amber-400">
                  {health.sleep_duration}
                </div>
              </div>

              {/* Fell Asleep */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  Fell Asleep
                </div>
                <div className="text-lg font-black text-amber-300 truncate">
                  {health.sleep_time}
                </div>
              </div>

              {/* Wake Up Time */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  Wake Up Time
                </div>
                <div className="text-lg font-black text-purple-400 truncate">
                  {health.wake_time}
                </div>
              </div>

              {/* Resting Heart Rate */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  Resting HR
                </div>
                <div className="text-xl font-black text-rose-400">
                  {health.rhr > 0 ? `${health.rhr} bpm` : 'No data'}
                </div>
              </div>

              {/* Bodyweight */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  Bodyweight
                </div>
                <div className="text-xl font-black text-emerald-400">
                  {health.bodyweight} lbs
                </div>
              </div>

              {/* Workout Calories */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  Workout Cal
                </div>
                <div className="text-xl font-black text-orange-400">
                  {health.workout_calories > 0 ? `${health.workout_calories} kcal` : 'No data'}
                </div>
              </div>

              {/* Workout Duration */}
              <div className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-2">
                  Workout Dur
                </div>
                <div className="text-xl font-black text-blue-400">
                  {health.workout_duration > 0 ? `${health.workout_duration} min` : 'No data'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-center text-xs text-zinc-400">
            No health data available. Connect Apple Health via Google Sheets.
          </div>
        )}
      </section>

      {/* ⚡ Habits Command Center */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-amber-400" />
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              Habits Command Center
            </h2>
          </div>
          <span className="text-xs text-zinc-400">Daily Streaks & Consistency</span>
        </div>

        {loadingHabits ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-zinc-900/50 border border-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {habits.map((habit) => (
              <div
                key={habit.name}
                className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/90 shadow-xl flex flex-col justify-between space-y-4"
              >
                {/* Header */}
                <div className="flex items-start justify-between pb-3 border-b border-zinc-800/80">
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      <span>{habit.icon}</span>
                      <span>{habit.name}</span>
                    </div>
                    <div className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mt-0.5">
                      {habit.monthName} {habit.year}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-black text-emerald-400">
                        {habit.streak} 🔥
                      </div>
                      <div className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                        Streak
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-cyan-400">
                        {habit.consistencyRate}%
                      </div>
                      <div className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                        Cons.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mini Monthly Calendar Grid */}
                <div>
                  {/* Days of week header */}
                  <div className="grid grid-cols-7 gap-1 text-center mb-1.5">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((dayChar, idx) => (
                      <div key={idx} className="text-[10px] font-bold text-zinc-400">
                        {dayChar}
                      </div>
                    ))}
                  </div>

                  {/* Month days */}
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {habit.days.map((d, dIdx) => {
                      if (d.dayNumber === 0) {
                        return <div key={`empty-${dIdx}`} className="aspect-square" />;
                      }

                      let bgClass = 'bg-[#1C1C24] text-zinc-400 border border-zinc-800/60';
                      if (d.completed) {
                        bgClass = 'bg-[#00FF66] text-black font-extrabold shadow-sm shadow-[#00FF66]/20';
                      }

                      const todayClass = d.isToday ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-[#14141B] font-bold' : '';

                      return (
                        <div
                          key={d.dateStr}
                          title={`${d.dateStr}: ${d.completed ? 'Completed' : 'Incomplete'}`}
                          className={`aspect-square rounded flex items-center justify-center text-[10px] transition-all ${bgClass} ${todayClass}`}
                        >
                          {d.dayNumber}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 1-Click Toggle Button for Today */}
                <button
                  onClick={() => toggleHabit(habit.name, habit.completedToday)}
                  disabled={togglingHabit === habit.name}
                  className={`w-full py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm ${
                    habit.completedToday
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 hover:bg-rose-500/15 hover:text-rose-400 hover:border-rose-500/40'
                      : 'bg-zinc-800/80 text-zinc-200 border border-zinc-700/80 hover:border-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10'
                  }`}
                >
                  {habit.completedToday ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Completed Today ✅</span>
                    </>
                  ) : (
                    <>
                      <span>Mark Done</span>
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 📅 Today's Agenda / Critical Tasks Snapshot */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-400" />
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              Today's Agenda & Critical Focus
            </h2>
            <span className="text-[11px] font-mono text-zinc-400 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800">
              {unifiedAgendaItems.length} items
            </span>
          </div>

          <Link
            href="/tasks"
            className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition"
          >
            <span>Open Mission Control</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loadingTasks ? (
          <div className="h-28 rounded-2xl bg-zinc-900/50 border border-zinc-800 animate-pulse flex items-center justify-center text-xs text-zinc-400">
            Loading Today's Schedule...
          </div>
        ) : unifiedAgendaItems.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[#14141B] border border-zinc-800/80 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto opacity-80" />
            <p className="text-sm font-medium text-white">No pending tasks or events for today!</p>
            <p className="text-xs text-zinc-400">
              Check your backlog or schedule upcoming school modules in Mission Control.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {unifiedAgendaItems.map((item) => {
              const calStyle = CALENDAR_COLORS[item.calendar_name] || {
                bg: 'bg-zinc-800/40',
                text: 'text-zinc-300',
                border: 'border-zinc-700',
              };

              // --- A. Merged Dual-Action Card (Timeblock + Task) ---
              if (item.isMerged && item.timeblock && item.task) {
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-2xl bg-[#14141B] border transition-all duration-150 flex flex-col justify-between gap-3 shadow-md ${
                      item.allCompleted
                        ? 'border-emerald-500/40 opacity-70 bg-emerald-950/10'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    {/* Card Top: Badges & Fast Master Action */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border ${calStyle.bg} ${calStyle.text} ${calStyle.border}`}
                          >
                            {item.calendar_name}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/20 flex items-center gap-1">
                            <Layers className="h-2.5 w-2.5" />
                            Timeblock + Task
                          </span>
                        </div>

                        {/* 1-Click Master Action: Complete Both */}
                        <button
                          onClick={() =>
                            toggleBoth(
                              item.timeblock!.id,
                              item.task!.id,
                              item.allCompleted,
                              item.cleanTitle,
                              item.calendar_name,
                              item.task!.googleTaskId
                            )
                          }
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition flex items-center gap-1 cursor-pointer ${
                            item.allCompleted
                              ? 'bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                          }`}
                          title={item.allCompleted ? 'Mark both incomplete' : 'Complete both in 1 click'}
                        >
                          <Check className="h-3 w-3" />
                          <span>{item.allCompleted ? 'All Done' : 'Complete Both'}</span>
                        </button>
                      </div>

                      {/* Clean Title */}
                      <div
                        className={`text-xs font-bold leading-snug line-clamp-2 ${
                          item.allCompleted ? 'line-through text-zinc-400' : 'text-white'
                        }`}
                      >
                        {item.cleanTitle}
                      </div>
                    </div>

                    {/* Dual Independent Action Pills */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-800/60">
                      {/* Pill 1: Calendar Timeblock */}
                      <button
                        type="button"
                        onClick={() => toggleTimeblockOnly(item.timeblock!.id, item.timeblock!.isCompleted)}
                        className={`p-2 rounded-xl border text-left transition flex items-start gap-2 cursor-pointer ${
                          item.timeblock!.isCompleted
                            ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        }`}
                        title="Click to toggle timeblock completion"
                      >
                        <div
                          className={`mt-0.5 h-3.5 w-3.5 rounded flex items-center justify-center border shrink-0 ${
                            item.timeblock!.isCompleted
                              ? 'bg-emerald-500 border-emerald-400 text-black'
                              : 'border-zinc-700 bg-zinc-900'
                          }`}
                        >
                          {item.timeblock!.isCompleted && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[9px] font-bold uppercase text-zinc-400 flex items-center gap-1">
                            <CalendarCheck className="h-2.5 w-2.5 text-cyan-400" /> Timeblock
                          </div>
                          <div className="text-[11px] font-bold font-mono text-cyan-300 truncate">
                            {item.timeblock!.timeStr || 'Untimed'}{' '}
                            {item.timeblock!.durationMins > 0 && `(${item.timeblock!.durationMins}m)`}
                          </div>
                        </div>
                      </button>

                      {/* Pill 2: Google Task Checklist */}
                      <button
                        type="button"
                        onClick={() =>
                          toggleTaskOnly(
                            item.task!.id,
                            item.task!.isCompleted,
                            item.cleanTitle,
                            item.calendar_name,
                            item.task!.googleTaskId
                          )
                        }
                        className={`p-2 rounded-xl border text-left transition flex items-start gap-2 cursor-pointer ${
                          item.task!.isCompleted
                            ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        }`}
                        title="Click to toggle Google Task deliverable"
                      >
                        <div
                          className={`mt-0.5 h-3.5 w-3.5 rounded flex items-center justify-center border shrink-0 ${
                            item.task!.isCompleted
                              ? 'bg-emerald-500 border-emerald-400 text-black'
                              : 'border-zinc-700 bg-zinc-900'
                          }`}
                        >
                          {item.task!.isCompleted && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[9px] font-bold uppercase text-zinc-400 flex items-center gap-1">
                            <ListTodo className="h-2.5 w-2.5 text-purple-400" /> Google Task
                          </div>
                          <div className="text-[11px] font-bold text-zinc-200 truncate">
                            {item.task!.isCompleted ? 'Completed' : 'Pending'}
                          </div>
                        </div>
                      </button>
                    </div>

                    {/* Footer: Status Summary & Reschedule Button */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/40 text-[10px] text-zinc-400">
                      <span className="text-zinc-500 font-mono truncate max-w-[170px]">
                        {item.allCompleted
                          ? '✓ Fully complete'
                          : item.timeblock!.isCompleted
                          ? '⏰ Timeblock passed'
                          : item.task!.isCompleted
                          ? '✓ Task done (timeblock pending)'
                          : 'Scheduled for today'}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setReschedulingItem(item);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold text-zinc-400 hover:text-cyan-400 hover:bg-cyan-500/10 border border-zinc-800 hover:border-cyan-500/30 transition cursor-pointer shrink-0"
                        title="Reschedule / Shift to another day or time"
                      >
                        <CalendarClock className="h-3 w-3" />
                        <span>Reschedule</span>
                      </button>
                    </div>
                  </div>
                );
              }

              // --- B. Standalone Item (Single Event or Task) ---
              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl bg-[#14141B] border transition-all duration-150 flex flex-col justify-between gap-2.5 shadow-md ${
                    item.allCompleted
                      ? 'border-emerald-500/30 opacity-60 bg-emerald-950/10'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => {
                        if (item.timeblock) {
                          toggleTimeblockOnly(item.timeblock.id, item.timeblock.isCompleted);
                        } else if (item.task) {
                          toggleTaskOnly(
                            item.task.id,
                            item.task.isCompleted,
                            item.cleanTitle,
                            item.calendar_name,
                            item.task.googleTaskId
                          );
                        }
                      }}
                      className={`mt-0.5 h-4.5 w-4.5 rounded-md flex items-center justify-center border transition-all shrink-0 cursor-pointer ${
                        item.allCompleted
                          ? 'bg-emerald-500 border-emerald-400 text-black shadow-sm'
                          : 'border-zinc-700 bg-zinc-900/80 hover:border-cyan-400'
                      }`}
                    >
                      {item.allCompleted && <Check className="h-3 w-3 stroke-[3]" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase border ${calStyle.bg} ${calStyle.text} ${calStyle.border}`}
                        >
                          {item.calendar_name}
                        </span>
                        {item.due_time && (
                          <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {item.due_time}
                          </span>
                        )}
                        {item.duration_mins > 0 && (
                          <span className="text-[10px] text-zinc-400 font-mono">
                            ({item.duration_mins}m)
                          </span>
                        )}
                      </div>

                      <div
                        className={`text-xs font-bold leading-snug truncate ${
                          item.allCompleted ? 'line-through text-zinc-400' : 'text-white'
                        }`}
                      >
                        {item.cleanTitle}
                      </div>

                      {item.location && (
                        <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                          📍 {item.location}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Standalone Reschedule Action */}
                  <div className="flex items-center justify-between pt-1 border-t border-zinc-800/40 text-[10px] text-zinc-400">
                    <span className="text-zinc-500">
                      {item.timeblock ? 'Calendar Event' : 'Google Task'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setReschedulingItem(item);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold text-zinc-400 hover:text-cyan-400 hover:bg-cyan-500/10 border border-zinc-800 hover:border-cyan-500/30 transition cursor-pointer"
                      title="Reschedule / Shift to another day or time"
                    >
                      <CalendarClock className="h-3 w-3" />
                      <span>Reschedule</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Available Modules Launchpad */}
      <section className="space-y-4 pt-4 border-t border-zinc-800/80">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          OS Modules Launchpad
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Link
            href="/tasks"
            className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800 hover:border-cyan-500/50 hover:bg-zinc-900/80 transition group flex flex-col justify-between space-y-3"
          >
            <div className="h-8 w-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center group-hover:scale-105 transition">
              <Rocket className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white group-hover:text-cyan-400 transition">
                Mission Control
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Master Task Tracker & GCal</div>
            </div>
          </Link>

          <Link
            href="/school"
            className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800 hover:border-purple-500/50 hover:bg-zinc-900/80 transition group flex flex-col justify-between space-y-3"
          >
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center group-hover:scale-105 transition">
              <GraduationCap className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white group-hover:text-purple-400 transition">
                School Sync
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Elentra iCal & Scheduler</div>
            </div>
          </Link>

          <div className="p-3.5 rounded-xl bg-[#14141B]/60 border border-zinc-800/60 flex flex-col justify-between space-y-3 opacity-75">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-300">Habit Tracker</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Phase 3</div>
            </div>
          </div>

          <Link
            href="/workouts"
            className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 hover:border-cyan-500/50 flex flex-col justify-between space-y-3 transition shadow-sm group"
          >
            <div className="h-8 w-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center group-hover:scale-105 transition">
              <Dumbbell className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white group-hover:text-cyan-400 transition">Workout Tracker</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Hevy Hub & Recovery</div>
            </div>
          </Link>

          <Link
            href="/meals"
            className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 hover:border-orange-500/50 flex flex-col justify-between space-y-3 transition shadow-sm group"
          >
            <div className="h-8 w-8 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center group-hover:scale-105 transition">
              <UtensilsCrossed className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white group-hover:text-orange-400 transition">Meal Prep</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Costco & Weekly Rotation</div>
            </div>
          </Link>

          <Link
            href="/ai"
            className="p-3.5 rounded-xl bg-[#14141B] border border-zinc-800/80 hover:border-purple-500/50 flex flex-col justify-between space-y-3 transition shadow-sm group"
          >
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center group-hover:scale-105 transition">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white group-hover:text-purple-400 transition">AI Scheduler</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Autonomous Day Plan</div>
            </div>
          </Link>
        </div>
      </section>

      {/* Reschedule Modal */}
      {reschedulingItem && (
        <RescheduleModal
          isOpen={Boolean(reschedulingItem)}
          onClose={() => setReschedulingItem(null)}
          item={{
            id: reschedulingItem.task?.id || reschedulingItem.timeblock?.id,
            title: reschedulingItem.cleanTitle,
            calendar_name: reschedulingItem.calendar_name,
            due_date: reschedulingItem.due_date,
            due_time: reschedulingItem.timeblock?.timeStr || reschedulingItem.due_time,
            duration_mins: reschedulingItem.timeblock?.durationMins || reschedulingItem.duration_mins,
            calendar_event_id: reschedulingItem.timeblock?.calendarEventId,
            google_task_id: reschedulingItem.task?.googleTaskId,
            type: reschedulingItem.timeblock ? 'Event' : 'Task',
          }}
          onSuccess={async () => {
            await fetchTodayTasks();
            setReschedulingItem(null);
          }}
        />
      )}
    </div>
  );
}
