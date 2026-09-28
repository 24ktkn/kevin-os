'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { SchoolEvent, SchoolCategory } from '@/types/school';

const CALENDAR_MAP: Record<string, string> = {
  'School': '0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com',
  'Kevin Nguyen': '24ktkn@gmail.com',
  'Family': 'family05668227215423587251@group.calendar.google.com',
  'Volunteering': '57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com',
};

export default function SchoolSyncPage() {
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Local state for overrides, completions, and scheduling
  const [overrides, setOverrides] = useState<Record<string, SchoolCategory>>({});
  const [completions, setCompletions] = useState<Record<string, boolean>>({});
  const [scheduledItems, setScheduledItems] = useState<
    Record<string, { date: string; time: string; duration: number; calendar: string }>
  >({});

  // Schedule form state per card
  const [formState, setFormState] = useState<
    Record<string, { date: string; time: string; duration: number; calendar: string }>
  >({});

  // Load local persistence on mount
  useEffect(() => {
    try {
      const storedOverrides = localStorage.getItem('kevin_school_overrides');
      if (storedOverrides) setOverrides(JSON.parse(storedOverrides));

      const storedCompletions = localStorage.getItem('kevin_school_completions');
      if (storedCompletions) setCompletions(JSON.parse(storedCompletions));

      const storedScheduled = localStorage.getItem('kevin_school_scheduled');
      if (storedScheduled) setScheduledItems(JSON.parse(storedScheduled));
    } catch {
      // ignore storage errors
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
      setEvents(data.events || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendar();
  }, []);

  // Persist handlers
  const handleOverrideCategory = (uid: string, newCat: SchoolCategory) => {
    const updated = { ...overrides, [uid]: newCat };
    setOverrides(updated);
    localStorage.setItem('kevin_school_overrides', JSON.stringify(updated));
  };

  const handleToggleComplete = (uid: string, completed: boolean) => {
    const updated = { ...completions, [uid]: completed };
    setCompletions(updated);
    localStorage.setItem('kevin_school_completions', JSON.stringify(updated));
  };

  const handleScheduleItem = (uid: string) => {
    const defaultEvent = events.find((e) => e.uid === uid);
    const existing = formState[uid] || {
      date: defaultEvent ? new Date(defaultEvent.dateObj).toISOString().split('T')[0] : '',
      time: '10:00',
      duration: defaultEvent?.duration || 60,
      calendar: 'School',
    };

    const updated = { ...scheduledItems, [uid]: existing };
    setScheduledItems(updated);
    localStorage.setItem('kevin_school_scheduled', JSON.stringify(updated));
    setExpandedId(null);
  };

  // Processed and categorized events
  const categorized = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
      const isPast = eventDate.getTime() < today.getTime();

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

        <div className="flex items-center gap-2">
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
                time: '10:00',
                duration: event.duration,
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
                            <Sparkles className="h-3 w-3" /> Already Scheduled
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
                          {formattedDate}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-zinc-400" />
                          {formattedTime} ({event.duration} mins)
                        </span>
                        {event.location && (
                          <span className="text-zinc-500 text-xs truncate max-w-xs">
                            📍 {event.location}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex items-center gap-2 self-start">
                      {event.isCompleted ? (
                        <button
                          onClick={() => handleToggleComplete(event.uid, false)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/80 transition"
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Undo
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggleComplete(event.uid, true)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition shadow-sm"
                        >
                          <Check className="h-3.5 w-3.5" /> Mark Complete
                        </button>
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
                          <span>Timeblock & Schedule to Mission Control</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="text-zinc-400 block mb-1">Target Date</label>
                            <input
                              type="date"
                              value={currentForm.date}
                              onChange={(e) =>
                                setFormState({
                                  ...formState,
                                  [event.uid]: { ...currentForm, date: e.target.value },
                                })
                              }
                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <div>
                            <label className="text-zinc-400 block mb-1">Start Time</label>
                            <input
                              type="time"
                              value={currentForm.time}
                              onChange={(e) =>
                                setFormState({
                                  ...formState,
                                  [event.uid]: { ...currentForm, time: e.target.value },
                                })
                              }
                              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500"
                            />
                          </div>

                          <div>
                            <label className="text-zinc-400 block mb-1">Duration (Mins)</label>
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
                            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-medium shadow-md shadow-cyan-500/10 transition"
                          >
                            Add to Schedule & Calendar
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
