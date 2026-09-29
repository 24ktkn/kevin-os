'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GraduationCap,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  Check,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Undo2,
  CalendarDays,
  Sparkles,
  Database,
  ListTodo,
} from 'lucide-react';
import { SchoolEvent, SchoolCategory } from '@/types/school';
import { supabase } from '@/lib/supabase';

const CALENDAR_MAP: Record<string, string> = {
  'School': '0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com',
  'Kevin Nguyen': '24ktkn@gmail.com',
  'Family': 'family05668227215423587251@group.calendar.google.com',
  'Volunteering': '57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com',
};

export default function SchoolSyncPage() {
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingTasks, setSyncingTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);

  // Local & Supabase state tracking
  const [overrides, setOverrides] = useState<Record<string, SchoolCategory>>({});
  const [completions, setCompletions] = useState<Record<string, boolean>>({});
  const [scheduledItems, setScheduledItems] = useState<
    Record<string, { date: string; time: string; duration: number; calendar: string; isTaskOnly?: boolean }>
  >({});

  // Schedule form state per card
  const [formState, setFormState] = useState<
    Record<string, { date: string; time: string; duration: number; calendar: string }>
  >({});

  // Load from Supabase (with fallback to localStorage)
  const loadStoredData = useCallback(async () => {
    try {
      const storedOverrides = localStorage.getItem('kevin_school_overrides');
      if (storedOverrides) setOverrides(JSON.parse(storedOverrides));

      const storedCompletions = localStorage.getItem('kevin_school_completions');
      if (storedCompletions) setCompletions(JSON.parse(storedCompletions));

      const storedScheduled = localStorage.getItem('kevin_school_scheduled');
      if (storedScheduled) setScheduledItems(JSON.parse(storedScheduled));
    } catch {
      // ignore
    }

    if (supabase) {
      try {
        const { data, error: supaErr } = await supabase.from('school_items').select('*');
        if (!supaErr && data) {
          setSupabaseConnected(true);
          const newOverrides: Record<string, SchoolCategory> = {};
          const newCompletions: Record<string, boolean> = {};
          const newScheduled: Record<string, { date: string; time: string; duration: number; calendar: string; isTaskOnly?: boolean }> = {};

          for (const row of data) {
            if (row.category) newOverrides[row.uid] = row.category as SchoolCategory;
            if (typeof row.is_completed === 'boolean') newCompletions[row.uid] = row.is_completed;
            if (row.is_scheduled && row.scheduled_date) {
              newScheduled[row.uid] = {
                date: row.scheduled_date,
                time: row.scheduled_time || '10:00 AM',
                duration: row.duration_mins || 0,
                calendar: row.target_calendar || 'School',
              };
            }
          }

          setOverrides((prev) => ({ ...prev, ...newOverrides }));
          setCompletions((prev) => ({ ...prev, ...newCompletions }));
          setScheduledItems((prev) => ({ ...prev, ...newScheduled }));
        }
      } catch {
        // Table might not exist yet
      }
    }
  }, []);

  // Check Google Tasks completion status and sync with local/Supabase
  const syncGoogleTasks = useCallback(async (currentEvents: SchoolEvent[]) => {
    setSyncingTasks(true);
    try {
      const res = await fetch('/api/tasks/sync');
      const data = await res.json();
      const completedList: string[] = data.completedTitles || data.results?.completedTitles || [];

      if (completedList.length > 0) {
        const cleanStr = (s: string) =>
          s.replace(/^[🎓📚📝⏰\s\[\]Task:]+/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();

        const cleanedCompleted = completedList.map(cleanStr);
        const newCompletions: Record<string, boolean> = {};

        for (const ev of currentEvents) {
          const cleanSummary = cleanStr(ev.summary);
          const isMatch =
            completedList.includes(ev.summary) ||
            cleanedCompleted.includes(cleanSummary) ||
            completedList.some((t) => t.includes(ev.summary) || ev.summary.includes(t)) ||
            cleanedCompleted.some((t) => t.includes(cleanSummary) || cleanSummary.includes(t));

          if (isMatch) {
            newCompletions[ev.uid] = true;

            if (supabase) {
              await supabase
                .from('school_items')
                .update({ is_completed: true, updated_at: new Date().toISOString() })
                .eq('uid', ev.uid);
            }
          }
        }

        if (Object.keys(newCompletions).length > 0) {
          setCompletions((prev) => {
            const merged = { ...prev, ...newCompletions };
            localStorage.setItem('kevin_school_completions', JSON.stringify(merged));
            return merged;
          });
        }
      }
    } catch (err) {
      console.error('Two-way task sync error:', err);
    } finally {
      setSyncingTasks(false);
    }
  }, []);

  // Fetch school feed
  const fetchCalendar = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/school/fetch');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch');
      const fetched = data.events || [];
      setEvents(fetched);
      syncGoogleTasks(fetched);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendar();
    loadStoredData();
  }, [loadStoredData]);

  // Persist handlers (Updates LocalStorage + Supabase in parallel)
  const handleOverrideCategory = async (uid: string, newCat: SchoolCategory) => {
    const updated = { ...overrides, [uid]: newCat };
    setOverrides(updated);
    localStorage.setItem('kevin_school_overrides', JSON.stringify(updated));

    if (supabase) {
      const ev = events.find((e) => e.uid === uid);
      await supabase.from('school_items').upsert({
        uid,
        title: ev?.summary || 'Untitled',
        category: newCat,
        updated_at: new Date().toISOString(),
      });
    }
  };

  const handleToggleComplete = async (uid: string, completed: boolean) => {
    const updated = { ...completions, [uid]: completed };
    setCompletions(updated);
    localStorage.setItem('kevin_school_completions', JSON.stringify(updated));

    const ev = events.find((e) => e.uid === uid);
    const title = ev?.summary || 'Untitled';

    // 1. Sync directly to Google Tasks via complete API
    if (title && title !== 'Untitled') {
      fetch('/api/tasks/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          calendar_name: 'School',
          completed,
        }),
      }).catch((err) => console.error('Failed to sync school module completion to Google Tasks:', err));
    }

    if (supabase) {
      await supabase.from('school_items').upsert({
        uid,
        title,
        category: overrides[uid] || ev?.category || 'module',
        is_completed: completed,
        updated_at: new Date().toISOString(),
      });

      if (title && title !== 'Untitled') {
        await supabase
          .from('tasks')
          .update({ is_completed: completed, updated_at: new Date().toISOString() })
          .ilike('title', `%${title}%`);
      }
    }
  };

  // Schedule handler: supports both calendar timeblocking and task-only creation
  const handleScheduleItem = async (
    uid: string,
    opts?: { skipCalendar?: boolean; isAssignmentDue?: boolean }
  ) => {
    const defaultEvent = events.find((e) => e.uid === uid);
    const eventDateObj = defaultEvent ? new Date(defaultEvent.dateObj) : new Date();
    const isTaskOnly = Boolean(opts?.skipCalendar || opts?.isAssignmentDue);

    const defaultTimeStr = defaultEvent?.isAllDay
      ? '11:59 PM'
      : eventDateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const existing = formState[uid] || {
      date: eventDateObj.toISOString().split('T')[0],
      time: isTaskOnly ? defaultTimeStr : '10:00 AM',
      duration: isTaskOnly ? 0 : defaultEvent?.duration || 60,
      calendar: 'School',
    };

    setSchedulingId(uid);

    try {
      // 1. Call backend route
      const scheduleRes = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: defaultEvent?.summary || 'Untitled',
          description: defaultEvent?.description || '',
          date: existing.date,
          time: existing.time,
          duration: existing.duration,
          calendar: existing.calendar,
          skipCalendar: isTaskOnly,
        }),
      });

      const schedData = await scheduleRes.json();
      if (!scheduleRes.ok) {
        console.error('Google schedule error:', schedData.error);
      }

      // 2. Update local state
      const updated = { ...scheduledItems, [uid]: { ...existing, isTaskOnly } };
      setScheduledItems(updated);
      localStorage.setItem('kevin_school_scheduled', JSON.stringify(updated));
      setExpandedId(null);

      // 3. Upsert to Supabase
      if (supabase) {
        await supabase.from('school_items').upsert({
          uid,
          title: defaultEvent?.summary || 'Untitled',
          category: overrides[uid] || defaultEvent?.category || 'module',
          is_scheduled: true,
          scheduled_date: existing.date,
          scheduled_time: existing.time,
          duration_mins: existing.duration,
          target_calendar: existing.calendar,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Failed to schedule:', err);
    } finally {
      setSchedulingId(null);
    }
  };

  // Processed and categorized events
  const categorized = useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const activeMods: SchoolEvent[] = [];
    const activeAss: SchoolEvent[] = [];
    const upcomingCls: SchoolEvent[] = [];
    const compMods: SchoolEvent[] = [];
    const compAss: SchoolEvent[] = [];
    const pastCls: SchoolEvent[] = [];

    for (const e of events) {
      const effectiveCategory = overrides[e.uid] || e.category;
      const isDone = completions[e.uid] === true;
      const isSched = Boolean(scheduledItems[e.uid]);
      const eventDate = new Date(e.dateObj);

      // Check if past: All-day events compare to midnight; timed classes compare to current time
      let isPast = false;
      if (e.isAllDay) {
        isPast = eventDate.getTime() < todayMidnight.getTime();
      } else {
        const eventEndTime = eventDate.getTime() + (e.duration || 60) * 60 * 1000;
        isPast = eventEndTime < now.getTime();
      }

      const enriched: SchoolEvent = {
        ...e,
        category: effectiveCategory,
        isCompleted: isDone,
        isScheduled: isSched,
        scheduledDate: scheduledItems[e.uid]?.date,
        scheduledTime: scheduledItems[e.uid]?.time,
      };

      if (effectiveCategory === 'module') {
        if (isDone) compMods.push(enriched);
        else activeMods.push(enriched);
      } else if (effectiveCategory === 'assignment') {
        if (isDone) compAss.push(enriched);
        else activeAss.push(enriched);
      } else {
        // Classes
        if (isPast || isDone) pastCls.push(enriched);
        else upcomingCls.push(enriched);
      }
    }

    return {
      activeMods,
      activeAss,
      upcomingCls,
      compMods,
      compAss,
      pastCls,
    };
  }, [events, overrides, completions, scheduledItems]);

  const tabs = [
    { label: 'Active Modules', icon: GraduationCap, items: categorized.activeMods, badgeColor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
    { label: 'Active Assignments', icon: BookOpen, items: categorized.activeAss, badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    { label: 'Upcoming Classes', icon: Calendar, items: categorized.upcomingCls, badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    { label: 'Comp. Modules', icon: CheckCircle2, items: categorized.compMods, badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    { label: 'Comp. Assignments', icon: CheckCircle2, items: categorized.compAss, badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    { label: 'Past Classes', icon: Clock, items: categorized.pastCls, badgeColor: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
  ];

  const currentItems = tabs[activeTab]?.items || [];
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return currentItems;
    const q = searchQuery.toLowerCase();
    return currentItems.filter(
      (e) => e.summary.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
  }, [currentItems, searchQuery]);

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0F0F14]/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
              Kevin-OS <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">v2.0 Next.js</span>
            </h1>
            <p className="text-xs text-zinc-400">School Sync & Academic Timeblocker</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
            <Database className={`h-3 w-3 ${supabaseConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span>{supabaseConnected ? 'Supabase Live' : 'Local Storage Mode'}</span>
          </div>

          <button
            onClick={() => syncGoogleTasks(events)}
            disabled={syncingTasks}
            title="Check Google Tasks for completed items"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition"
          >
            <ListTodo className={`h-3.5 w-3.5 ${syncingTasks ? 'animate-pulse text-cyan-400' : 'text-zinc-400'}`} />
            <span className="hidden md:inline">Sync Tasks</span>
          </button>

          <button
            onClick={fetchCalendar}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline">Refresh Feed</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Active Modules</span>
              <GraduationCap className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{categorized.activeMods.length}</div>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Active Assignments</span>
              <BookOpen className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{categorized.activeAss.length}</div>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Upcoming Classes</span>
              <Calendar className="h-4 w-4 text-blue-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{categorized.upcomingCls.length}</div>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4 shadow-sm">
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Completed Items</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">
              {categorized.compMods.length + categorized.compAss.length}
            </div>
          </div>
        </div>

        {/* Search & Tabs Controls */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search across all modules, assignments, or lectures..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#121218] border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition"
            />
          </div>

          {/* 6 Tabs - 0ms Instant Switch */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {tabs.map((tab, idx) => {
              const Icon = tab.icon;
              const isActive = activeTab === idx;
              return (
                <button
                  key={tab.label}
                  onClick={() => setActiveTab(idx)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-150 ${
                    isActive
                      ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                      : 'bg-[#121218] text-zinc-400 hover:text-zinc-200 border border-zinc-800/60 hover:border-zinc-700'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
                  <span>{tab.label}</span>
                  <span className={`text-[11px] px-1.5 py-0.2 rounded-full border ${tab.badgeColor}`}>
                    {tab.items.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {/* Event List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-3">
            <RefreshCw className="h-8 w-8 text-cyan-400 animate-spin" />
            <p className="text-sm text-zinc-400">Syncing live schedule from Schulich Elentra...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-zinc-800/80 rounded-2xl bg-[#121218]/40">
            <CheckCircle2 className="h-10 w-10 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-zinc-400">No items found in this section</p>
            <p className="text-xs text-zinc-500 mt-1">Everything is caught up or filtered out.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5">
            {filteredItems.map((event) => {
              const dateObj = new Date(event.dateObj);
              const isExpanded = expandedId === event.uid;
              const isAssignment = event.category === 'assignment';
              const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
              const formattedTime = event.isAllDay
                ? 'All Day'
                : dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

              const currentForm = formState[event.uid] || {
                date: dateObj.toISOString().split('T')[0],
                time: isAssignment ? formattedTime : '10:00 AM',
                duration: isAssignment ? 60 : event.duration,
                calendar: 'School',
              };

              return (
                <div
                  key={event.uid}
                  className={`rounded-2xl border transition-all duration-200 bg-[#121218] p-5 shadow-sm ${
                    event.isCompleted
                      ? 'border-zinc-800/80 opacity-70'
                      : event.isScheduled
                      ? 'border-emerald-500/40 shadow-emerald-500/5'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[11px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full border ${
                            event.category === 'module'
                              ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                              : event.category === 'assignment'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          }`}
                        >
                          {event.category}
                        </span>

                        {event.isScheduled && (
                          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            {isAssignment ? 'Due Date in Google Tasks' : 'Already Scheduled'}
                          </span>
                        )}

                        {event.isCompleted && (
                          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 flex items-center gap-1">
                            <Check className="h-3 w-3 text-emerald-400" /> Completed
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-semibold text-white tracking-tight leading-snug">
                        {event.summary}
                      </h3>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                        <span className="flex items-center gap-1 text-zinc-300">
                          <CalendarDays className="h-3.5 w-3.5 text-zinc-400" />
                          {isAssignment ? `Due: ${formattedDate}` : formattedDate}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-zinc-400" />
                          {formattedTime} {!isAssignment && `(${event.duration} mins)`}
                        </span>
                        {event.location && (
                          <span className="text-zinc-500 text-xs truncate max-w-xs">
                            📍 {event.location}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 self-start">
                      {event.isCompleted ? (
                        <button
                          onClick={() => handleToggleComplete(event.uid, false)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/80 transition"
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Undo
                        </button>
                      ) : (
                        <>
                          {/* Dedicated 1-Click Assignment Due Date Task Button */}
                          {isAssignment && !event.isScheduled && (
                            <button
                              onClick={() => handleScheduleItem(event.uid, { skipCalendar: true, isAssignmentDue: true })}
                              disabled={schedulingId === event.uid}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition shadow-sm"
                            >
                              <ListTodo className="h-3.5 w-3.5" />
                              <span>{schedulingId === event.uid ? 'Adding to Tasks...' : 'Add Due Date to Tasks'}</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleToggleComplete(event.uid, true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition shadow-sm"
                          >
                            <Check className="h-3.5 w-3.5" /> Mark Complete
                          </button>
                        </>
                      )}

                      {!event.isCompleted && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : event.uid)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/80 transition"
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card Description Snippet */}
                  {event.description && (
                    <p className="mt-3 text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                      {event.description}
                    </p>
                  )}

                  {/* Expandable Scheduling & Overrides Panel */}
                  {isExpanded && !event.isCompleted && (
                    <div className="mt-4 pt-4 border-t border-zinc-800/80 space-y-4">
                      {/* Override Category Section */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400 flex items-center gap-1">
                          <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-500" />
                          Category Override:
                        </span>
                        <select
                          value={event.category}
                          onChange={(e) =>
                            handleOverrideCategory(event.uid, e.target.value as SchoolCategory)
                          }
                          className="bg-zinc-900 border border-zinc-700 text-xs rounded-md px-2.5 py-1 text-zinc-200 focus:outline-none focus:border-cyan-500"
                        >
                          <option value="module">🎓 Online Module</option>
                          <option value="assignment">📝 Assignment</option>
                          <option value="class">🏫 Class / Lecture</option>
                        </select>
                      </div>

                      {/* Timeblock Scheduler Form */}
                      <div className="p-3.5 rounded-xl bg-[#0F0F14] border border-zinc-800/90 space-y-3">
                        <div className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                          <span>
                            {isAssignment
                              ? '📅 Timeblock Study / Working Session on Google Calendar'
                              : '📅 Timeblock & Add to Google Tasks'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="text-zinc-400 block mb-1">
                              {isAssignment ? 'Working Session Date' : 'Target Date'}
                            </label>
                            <input
                              type="date"
                              value={currentForm.date}
                              onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                              onChange={(e) =>
                                setFormState({
                                  ...formState,
                                  [event.uid]: { ...currentForm, date: e.target.value },
                                })
                              }
                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark] cursor-pointer"
                            />
                          </div>

                          <div>
                            <label className="text-zinc-400 block mb-1">
                              {isAssignment ? 'Working Session Start Time' : 'Start Time (e.g. 10:00 AM)'}
                            </label>
                            <input
                              type="text"
                              placeholder="10:00 AM"
                              value={currentForm.time}
                              onChange={(e) =>
                                setFormState({
                                  ...formState,
                                  [event.uid]: { ...currentForm, time: e.target.value },
                                })
                              }
                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500 font-mono text-xs"
                            />
                          </div>

                          <div>
                            <label className="text-zinc-400 block mb-1">
                              {isAssignment ? 'Working Session Duration (Mins)' : 'Duration (Mins)'}
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={600}
                              value={currentForm.duration}
                              onChange={(e) =>
                                setFormState({
                                  ...formState,
                                  [event.uid]: {
                                    ...currentForm,
                                    duration: parseInt(e.target.value, 10) || 60,
                                  },
                                })
                              }
                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <div>
                            <label className="text-zinc-400 block mb-1">Assign to Calendar</label>
                            <select
                              value={currentForm.calendar}
                              onChange={(e) =>
                                setFormState({
                                  ...formState,
                                  [event.uid]: { ...currentForm, calendar: e.target.value },
                                })
                              }
                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500"
                            >
                              {Object.keys(CALENDAR_MAP).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="pt-1 flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleScheduleItem(event.uid)}
                            disabled={schedulingId === event.uid}
                            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 text-white text-xs font-medium shadow-md shadow-cyan-500/10 transition flex items-center gap-1.5"
                          >
                            {schedulingId === event.uid && <RefreshCw className="h-3 w-3 animate-spin" />}
                            <span>
                              {schedulingId === event.uid
                                ? 'Syncing to Google...'
                                : isAssignment
                                ? 'Add Working Session to Calendar'
                                : 'Add to Schedule & Calendar'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
