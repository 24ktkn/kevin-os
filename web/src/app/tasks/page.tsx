'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Rocket,
  Plus,
  CheckCircle2,
  Calendar,
  Clock,
  RefreshCw,
  Search,
  Filter,
  Check,
  CalendarDays,
  Sparkles,
  AlertCircle,
  X,
  ListTodo,
  RotateCcw,
} from 'lucide-react';
import { TaskItem, CalendarName } from '@/types/task';
import { supabase } from '@/lib/supabase';
import { isEventPast } from '@/lib/date-utils';

const CALENDAR_COLORS: Record<CalendarName, { bg: string; text: string; border: string }> = {
  'School': { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30' },
  'Kevin Nguyen': { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  'Family': { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30' },
  'Volunteering': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
};

export default function MissionControlPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCalendar, setSelectedCalendar] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<
    'upcoming' | 'today' | 'backlog' | 'completed_events' | 'completed_tasks'
  >('upcoming');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New task form state
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDate, setNewTaskDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [newTaskTime, setNewTaskTime] = useState('10:00 AM');
  const [newTaskDuration, setNewTaskDuration] = useState(30);
  const [newTaskCalendar, setNewTaskCalendar] = useState<CalendarName>('Kevin Nguyen');
  const [newTaskNotes, setNewTaskNotes] = useState('');
  const [createTimeblock, setCreateTimeblock] = useState(false);
  const [submittingTask, setSubmittingTask] = useState(false);

  // Fetch tasks from Supabase (with localStorage fallback)
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Check local storage first
      const cached = localStorage.getItem('kevin_os_tasks');
      if (cached) {
        setTasks(JSON.parse(cached));
      }

      // 2. Query Supabase
      if (supabase) {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .order('due_date', { ascending: true });

        if (!error && data) {
          const rawTasks = data as TaskItem[];
          const pastEventIds: string[] = [];

          const processed = rawTasks.map((t) => {
            if (!t.is_completed && t.type === 'Event' && isEventPast(t.due_date, t.due_time, t.duration_mins)) {
              pastEventIds.push(t.id);
              return { ...t, is_completed: true };
            }
            return t;
          });

          setTasks(processed);
          localStorage.setItem('kevin_os_tasks', JSON.stringify(processed));

          // Auto-sweep past events in database
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
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Optimistic Toggle Task/Event Completion (Supports both checking and unchecking)
  const toggleTaskCompletion = async (id: string, currentStatus: boolean) => {
    const updatedStatus = !currentStatus;

    // Instant local UI update (< 5ms)
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, is_completed: updatedStatus } : t));
      localStorage.setItem('kevin_os_tasks', JSON.stringify(next));
      return next;
    });

    // Asynchronous Supabase update
    if (supabase) {
      await supabase
        .from('tasks')
        .update({ is_completed: updatedStatus, updated_at: new Date().toISOString() })
        .eq('id', id);

      // Also sync completion/unchecking to school_items
      const target = tasks.find((t) => t.id === id);
      if (target?.title) {
        const clean = target.title.replace(/^[🎓📚📝⏰\s\[\]Task:]+/gi, '').trim();
        if (clean) {
          await supabase
            .from('school_items')
            .update({ is_completed: updatedStatus, updated_at: new Date().toISOString() })
            .ilike('title', `%${clean}%`);
        }
      }
    }
  };

  // Add New Task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    setSubmittingTask(true);
    const newId = crypto.randomUUID();

    const taskItem: TaskItem = {
      id: newId,
      title: newTaskTitle.trim(),
      type: createTimeblock ? 'Event' : 'Task',
      calendar_name: newTaskCalendar,
      due_date: newTaskDate,
      due_time: newTaskTime,
      duration_mins: newTaskDuration,
      is_completed: false,
      is_scheduled: createTimeblock,
      notes: newTaskNotes.trim(),
      created_at: new Date().toISOString(),
    };

    // 1. Optimistic local state update
    setTasks((prev) => {
      const next = [taskItem, ...prev];
      localStorage.setItem('kevin_os_tasks', JSON.stringify(next));
      return next;
    });

    try {
      // 2. Optional Google Calendar / Tasks sync
      if (createTimeblock) {
        await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: taskItem.title,
            description: taskItem.notes,
            date: taskItem.due_date,
            time: taskItem.due_time,
            duration: taskItem.duration_mins,
            calendar: taskItem.calendar_name,
          }),
        });
      }

      // 3. Supabase persist
      if (supabase) {
        await supabase.from('tasks').insert([taskItem]);
      }

      // Reset form
      setNewTaskTitle('');
      setNewTaskNotes('');
      setIsAddModalOpen(false);
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSubmittingTask(false);
    }
  };

  // Sync Google Tasks & Calendar Sweeper
  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await fetch('/api/tasks/sync');
      await fetchTasks();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Filtering & Partitioning
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Calendar filter
    if (selectedCalendar !== 'all') {
      result = result.filter((t) => t.calendar_name === selectedCalendar);
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || (t.notes && t.notes.toLowerCase().includes(q))
      );
    }

    return result;
  }, [tasks, selectedCalendar, searchQuery]);

  // Section categorizations
  const { upcomingEvents, todayTasks, backlogTasks, completedEvents, completedTasks } = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];

    const today: TaskItem[] = [];
    const upcoming: TaskItem[] = [];
    const backlog: TaskItem[] = [];
    const compEvents: TaskItem[] = [];
    const compTasks: TaskItem[] = [];

    for (const t of filteredTasks) {
      if (t.is_completed) {
        if (t.type === 'Event') {
          compEvents.push(t);
        } else {
          compTasks.push(t);
        }
      } else if (t.type === 'Event') {
        // All active Google Calendar events appear in Upcoming Events tab
        upcoming.push(t);
      } else {
        // Tasks appear in Today's Tasks if due today or earlier, otherwise in Backlog
        if (!t.due_date) {
          backlog.push(t);
        } else if (t.due_date <= todayStr) {
          today.push(t);
        } else {
          backlog.push(t);
        }
      }
    }

    // Sort completed tasks and events in descending order (most recent first)
    const sortDesc = (a: TaskItem, b: TaskItem) => {
      const dateA = a.due_date || '';
      const dateB = b.due_date || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const timeA = a.due_time || '';
      const timeB = b.due_time || '';
      return timeB.localeCompare(timeA);
    };

    compEvents.sort(sortDesc);
    compTasks.sort(sortDesc);

    // Sort upcoming in chronological order (closest first)
    upcoming.sort((a, b) => {
      const dateA = a.due_date || '';
      const dateB = b.due_date || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.due_time || '';
      const timeB = b.due_time || '';
      return timeA.localeCompare(timeB);
    });

    // Sort today by time
    today.sort((a, b) => {
      const timeA = a.due_time || '';
      const timeB = b.due_time || '';
      return timeA.localeCompare(timeB);
    });

    return {
      upcomingEvents: upcoming,
      todayTasks: today,
      backlogTasks: backlog,
      completedEvents: compEvents,
      completedTasks: compTasks,
    };
  }, [filteredTasks]);

  const activeTaskList =
    activeTab === 'upcoming'
      ? upcomingEvents
      : activeTab === 'today'
      ? todayTasks
      : activeTab === 'backlog'
      ? backlogTasks
      : activeTab === 'completed_events'
      ? completedEvents
      : completedTasks;

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
              <Rocket className="h-5 w-5 text-cyan-400" /> Mission Control
            </h1>
            <span className="text-xs text-zinc-400 font-mono">| {todayFormatted}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">Central task tracker, timeblocks & multi-calendar overview</p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Cloud'}</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-md shadow-cyan-500/15 transition"
          >
            <Plus className="h-4 w-4" />
            <span>New Task</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div
            onClick={() => setActiveTab('upcoming')}
            className={`rounded-2xl border p-4 shadow-sm cursor-pointer transition ${
              activeTab === 'upcoming'
                ? 'border-purple-500/50 bg-[#161622] ring-1 ring-purple-500/30'
                : 'border-zinc-800/80 bg-[#121218] hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Upcoming Events</span>
              <CalendarDays className="h-4 w-4 text-purple-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{upcomingEvents.length}</div>
          </div>

          <div
            onClick={() => setActiveTab('today')}
            className={`rounded-2xl border p-4 shadow-sm cursor-pointer transition ${
              activeTab === 'today'
                ? 'border-cyan-500/50 bg-[#161622] ring-1 ring-cyan-500/30'
                : 'border-zinc-800/80 bg-[#121218] hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Today's Tasks</span>
              <AlertCircle className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{todayTasks.length}</div>
          </div>

          <div
            onClick={() => setActiveTab('backlog')}
            className={`rounded-2xl border p-4 shadow-sm cursor-pointer transition ${
              activeTab === 'backlog'
                ? 'border-amber-500/50 bg-[#161622] ring-1 ring-amber-500/30'
                : 'border-zinc-800/80 bg-[#121218] hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Unscheduled Backlog</span>
              <ListTodo className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{backlogTasks.length}</div>
          </div>

          <div
            onClick={() => setActiveTab('completed_events')}
            className={`rounded-2xl border p-4 shadow-sm cursor-pointer transition ${
              activeTab === 'completed_events'
                ? 'border-emerald-500/50 bg-[#161622] ring-1 ring-emerald-500/30'
                : 'border-zinc-800/80 bg-[#121218] hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Completed Events</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{completedEvents.length}</div>
          </div>

          <div
            onClick={() => setActiveTab('completed_tasks')}
            className={`rounded-2xl border p-4 shadow-sm cursor-pointer transition ${
              activeTab === 'completed_tasks'
                ? 'border-blue-500/50 bg-[#161622] ring-1 ring-blue-500/30'
                : 'border-zinc-800/80 bg-[#121218] hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Completed Tasks</span>
              <CheckCircle2 className="h-4 w-4 text-blue-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white tracking-tight">{completedTasks.length}</div>
          </div>
        </div>

        {/* Calendar Filter Pills & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Calendar Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <span className="text-xs text-zinc-500 mr-1 flex items-center gap-1">
              <Filter className="h-3 w-3" /> Filter:
            </span>
            {['all', 'School', 'Kevin Nguyen', 'Family', 'Volunteering'].map((cal) => (
              <button
                key={cal}
                onClick={() => setSelectedCalendar(cal)}
                className={`px-3 py-1 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                  selectedCalendar === cal
                    ? 'bg-zinc-800 text-white border border-zinc-700 shadow-sm'
                    : 'bg-[#121218] text-zinc-400 hover:text-zinc-200 border border-zinc-800/60'
                }`}
              >
                {cal === 'all' ? 'All Calendars' : cal}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative sm:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#121218] border border-zinc-800 rounded-xl pl-9 pr-3.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition"
            />
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex gap-2 border-b border-zinc-800/80 pb-2 overflow-x-auto scrollbar-none">
          {[
            { id: 'upcoming', label: `Upcoming Events (${upcomingEvents.length})` },
            { id: 'today', label: `Today's Tasks (${todayTasks.length})` },
            { id: 'backlog', label: `Backlog (${backlogTasks.length})` },
            { id: 'completed_events', label: `Completed Events (${completedEvents.length})` },
            { id: 'completed_tasks', label: `Completed Tasks (${completedTasks.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-zinc-800 text-cyan-400 border border-zinc-700 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Task List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <RefreshCw className="h-6 w-6 text-cyan-400 animate-spin" />
            <p className="text-xs text-zinc-400">Loading tasks from Supabase...</p>
          </div>
        ) : activeTaskList.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-zinc-800/80 rounded-2xl bg-[#121218]/40">
            <CheckCircle2 className="h-9 w-9 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-zinc-400">No tasks in this section</p>
            <p className="text-xs text-zinc-500 mt-1">You are all caught up!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeTaskList.map((task) => {
              const calStyle = CALENDAR_COLORS[task.calendar_name] || {
                bg: 'bg-zinc-800',
                text: 'text-zinc-300',
                border: 'border-zinc-700',
              };

              return (
                <div
                  key={task.id}
                  className={`group relative rounded-2xl border transition-all duration-150 bg-[#121218] p-4 flex flex-col justify-between gap-3 ${
                    task.is_completed
                      ? 'border-zinc-800/60 opacity-60 hover:opacity-90'
                      : 'border-zinc-800 hover:border-zinc-700 shadow-sm'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Header Row: Checkbox + Calendar Badge + Uncheck Button */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleTaskCompletion(task.id, task.is_completed)}
                          title={task.is_completed ? 'Click to uncheck (mark incomplete)' : 'Click to complete'}
                          className={`h-5 w-5 rounded-lg border flex items-center justify-center transition-all ${
                            task.is_completed
                              ? 'bg-emerald-500 border-emerald-500 text-black hover:bg-rose-500 hover:border-rose-500 hover:text-white'
                              : 'border-zinc-700 bg-zinc-900/80 hover:border-cyan-400'
                          }`}
                        >
                          {task.is_completed && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                        </button>

                        <span
                          className={`text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full border ${calStyle.bg} ${calStyle.text} ${calStyle.border}`}
                        >
                          {task.calendar_name}
                        </span>
                      </div>

                      {task.is_completed && (
                        <button
                          onClick={() => toggleTaskCompletion(task.id, task.is_completed)}
                          title="Uncheck this item and mark as incomplete"
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-zinc-400 hover:text-amber-400 hover:bg-amber-400/10 border border-zinc-800 hover:border-amber-400/30 transition"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          <span>Uncheck</span>
                        </button>
                      )}
                    </div>

                    {/* Task Title */}
                    <h3
                      className={`text-sm font-semibold tracking-tight leading-snug line-clamp-2 ${
                        task.is_completed ? 'line-through text-zinc-500' : 'text-white'
                      }`}
                    >
                      {task.title}
                    </h3>

                    {/* Notes if any */}
                    {task.notes && (
                      <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                        {task.notes}
                      </p>
                    )}
                  </div>

                  {/* Footer Meta Row */}
                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-zinc-500" />
                      {task.due_date || 'No Date'}
                    </span>
                    {task.due_time && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-zinc-500" />
                        {task.due_time} {task.type === 'Event' && task.duration_mins > 0 && `(${task.duration_mins}m)`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Add Task Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#121218] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-400" /> Create New Task
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="space-y-3.5 text-xs">
              <div>
                <label className="text-zinc-400 block mb-1">Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Study Cardiology Chapter 4"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-400 block mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newTaskDate}
                    onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                    onChange={(e) => setNewTaskDate(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark] cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-zinc-400 block mb-1">Start Time</label>
                  <input
                    type="text"
                    placeholder="10:00 AM"
                    value={newTaskTime}
                    onChange={(e) => setNewTaskTime(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-400 block mb-1">Duration (Mins)</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={newTaskDuration}
                    onChange={(e) => setNewTaskDuration(parseInt(e.target.value, 10) || 30)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-zinc-400 block mb-1">Calendar</label>
                  <select
                    value={newTaskCalendar}
                    onChange={(e) => setNewTaskCalendar(e.target.value as CalendarName)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Kevin Nguyen">Kevin Nguyen</option>
                    <option value="School">School</option>
                    <option value="Family">Family</option>
                    <option value="Volunteering">Volunteering</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-zinc-400 block mb-1">Notes / Instructions</label>
                <textarea
                  rows={2}
                  placeholder="Optional details or checklist..."
                  value={newTaskNotes}
                  onChange={(e) => setNewTaskNotes(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="timeblock"
                  checked={createTimeblock}
                  onChange={(e) => setCreateTimeblock(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-0"
                />
                <label htmlFor="timeblock" className="text-zinc-300 cursor-pointer">
                  Create Google Calendar timeblock event
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingTask}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold"
                >
                  {submittingTask ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
