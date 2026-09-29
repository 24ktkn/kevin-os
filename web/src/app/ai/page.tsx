'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bot,
  Sparkles,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Undo2,
  ArrowRight,
  RefreshCw,
  Rocket,
  Check,
  Zap,
} from 'lucide-react';
import {
  CalendarBusyBlock,
  BacklogTask,
  ProposedTask,
  ScheduledCommitItem,
} from '@/types/ai';

const CALENDAR_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Kevin Nguyen': { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
  'School': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  'Family': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  'Volunteering': { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
};

export default function AISchedulerPage() {
  const [targetDate, setTargetDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [loadingContext, setLoadingContext] = useState(true);
  const [busyBlocks, setBusyBlocks] = useState<CalendarBusyBlock[]>([]);
  const [backlogTasks, setBacklogTasks] = useState<BacklogTask[]>([]);

  // Task Input State
  const [tasksInput, setTasksInput] = useState<string>('');

  // AI Generation State
  const [generating, setGenerating] = useState(false);
  const [proposedTasks, setProposedTasks] = useState<ProposedTask[]>([]);
  const [generationSummary, setGenerationSummary] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Commit State
  const [committing, setCommitting] = useState(false);
  const [commitSuccess, setCommitSuccess] = useState<string>('');
  const [lastCommittedItems, setLastCommittedItems] = useState<ScheduledCommitItem[]>([]);
  const [undoing, setUndoing] = useState(false);

  // 1. Fetch Calendar Context & Backlog
  const fetchContext = useCallback(async (date: string) => {
    setLoadingContext(true);
    setErrorMessage('');
    try {
      const res = await fetch(`/api/ai/context?date=${date}`);
      const json = await res.json();
      if (json.success) {
        setBusyBlocks(json.busyBlocks || []);
        setBacklogTasks(json.backlogTasks || []);
      }
    } catch (err) {
      console.error('Failed to load AI scheduler context:', err);
    } finally {
      setLoadingContext(false);
    }
  }, []);

  useEffect(() => {
    fetchContext(targetDate);
  }, [targetDate, fetchContext]);

  // Append a backlog task into the prompt textarea
  const appendTaskToInput = (title: string, listName: string) => {
    const taskTag = `• ${title} (${listName}, 45m)`;
    setTasksInput((prev) => (prev ? `${prev.trim()}\n${taskTag}` : taskTag));
  };

  // Add quick prompt templates
  const addTemplate = (template: string) => {
    setTasksInput((prev) => (prev ? `${prev.trim()}\n${template}` : template));
  };

  // 2. Trigger Gemini AI Scheduling
  const handleGenerateSchedule = async () => {
    if (!tasksInput.trim()) {
      setErrorMessage('Please enter at least one task or select from your backlog.');
      return;
    }

    setGenerating(true);
    setErrorMessage('');
    setCommitSuccess('');
    setProposedTasks([]);

    try {
      const res = await fetch('/api/ai/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: targetDate,
          tasksInput,
          busyBlocks,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setProposedTasks(json.scheduledTasks || []);
        setGenerationSummary(json.summary || '');
      } else {
        setErrorMessage(json.error || 'Failed to generate schedule with Gemini');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown generation error';
      setErrorMessage(msg);
    } finally {
      setGenerating(false);
    }
  };

  // 3. Commit Schedule to Google Cloud & Supabase
  const handleCommitSchedule = async () => {
    if (proposedTasks.length === 0) return;

    setCommitting(true);
    setErrorMessage('');
    setCommitSuccess('');

    try {
      const res = await fetch('/api/ai/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDate,
          tasks: proposedTasks,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setCommitSuccess(json.message);
        setLastCommittedItems(json.scheduledItems || []);
        setProposedTasks([]);
        setTasksInput('');
        await fetchContext(targetDate); // Refresh context to show new busy blocks
      } else {
        setErrorMessage(json.error || 'Failed to commit schedule');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown commit error';
      setErrorMessage(msg);
    } finally {
      setCommitting(false);
    }
  };

  // 4. Undo Schedule
  const handleUndoSchedule = async () => {
    if (lastCommittedItems.length === 0) return;

    setUndoing(true);
    setErrorMessage('');

    try {
      const res = await fetch('/api/ai/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lastCommittedItems,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setCommitSuccess(`Undo complete: ${json.message}`);
        setLastCommittedItems([]);
        await fetchContext(targetDate);
      } else {
        setErrorMessage(json.error || 'Failed to undo schedule');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown undo error';
      setErrorMessage(msg);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0D] text-white p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-purple-500 to-indigo-600 flex items-center justify-center shadow-md shadow-purple-500/20">
              <Bot className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
              Intelligence Engine
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
            Gemini AI Task Auto-Scheduler
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Autonomous non-overlapping timeblocking and schedule synthesis powered by Google Gemini.
          </p>
        </div>

        {/* Date Selector & Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800">
            <Calendar className="h-3.5 w-3.5 text-purple-400" />
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none"
            />
          </div>

          <button
            onClick={() => fetchContext(targetDate)}
            disabled={loadingContext}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 hover:text-white transition shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingContext ? 'animate-spin text-purple-400' : ''}`} />
            <span>Sync Context</span>
          </button>
        </div>
      </div>

      {/* Existing Calendar Busy Blocks Banner */}
      <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-white flex items-center gap-2">
              Existing Schedule on {targetDate}
              <span className="text-[10px] px-2 py-0.2 rounded-full bg-zinc-800 text-zinc-400 font-semibold">
                {busyBlocks.length} busy events
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5">
              Gemini will protect these blocks and schedule around them between 8:00 AM and 10:00 PM.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {busyBlocks.slice(0, 4).map((b, idx) => (
            <span
              key={idx}
              className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono"
            >
              {b.startTime}: {b.title}
            </span>
          ))}
          {busyBlocks.length > 4 && (
            <span className="text-[11px] px-2 py-1 rounded-md bg-zinc-900 text-zinc-500 font-mono">
              +{busyBlocks.length - 4} more
            </span>
          )}
        </div>
      </div>

      {/* Main Two-Column Work Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Tasks Input & Backlog (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Backlog Task Quick-Picks */}
          {backlogTasks.length > 0 && (
            <div className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-zinc-400 tracking-wider">
                  Pick From Google Tasks Backlog
                </span>
                <span className="text-[10px] text-zinc-500">Tap to add</span>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                {backlogTasks.slice(0, 8).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => appendTaskToInput(task.title, task.listName)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/50 text-zinc-300 hover:text-white transition flex items-center gap-1.5 text-left"
                  >
                    <Plus className="h-3 w-3 text-purple-400 shrink-0" />
                    <span className="truncate max-w-[180px]">{task.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt Input Box */}
          <div className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                Unstructured Tasks to Schedule
              </label>
              {tasksInput && (
                <button
                  onClick={() => setTasksInput('')}
                  className="text-[11px] text-zinc-500 hover:text-rose-400 transition"
                >
                  Clear
                </button>
              )}
            </div>

            <textarea
              rows={8}
              value={tasksInput}
              onChange={(e) => setTasksInput(e.target.value)}
              placeholder="Paste or type tasks here, for example:&#10;• Organic Chemistry Lab Report (School, 90m)&#10;• Call Landlord about lease (Family, 15m)&#10;• Grocery run to Costco (60m)&#10;• Meal prep high-protein bowls (45m)"
              className="w-full p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-white placeholder-zinc-500 text-xs font-mono leading-relaxed focus:outline-none focus:border-purple-500 transition"
            />

            {/* Quick Starters */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                '+ Study Block (90m, School)',
                '+ Clean Apartment (30m, Family)',
                '+ Code Project (60m, Kevin)',
                '+ Gym Session (60m, Kevin)',
              ].map((template, idx) => (
                <button
                  key={idx}
                  onClick={() => addTemplate(template)}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                >
                  {template}
                </button>
              ))}
            </div>

            {/* Generate Action Button */}
            <button
              onClick={handleGenerateSchedule}
              disabled={generating || !tasksInput.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-xs font-bold text-white shadow-lg shadow-purple-600/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Sparkles className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
              <span>{generating ? 'Gemini is Synthesizing Schedule...' : 'Auto-Schedule with Gemini'}</span>
            </button>
          </div>

          {/* Error Message Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Right Column: AI Schedule Output & Day Canvas (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Commit Success Banner */}
          {commitSuccess && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{commitSuccess}</span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/tasks"
                  className="px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 font-bold transition flex items-center gap-1"
                >
                  <span>View in Tasks</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>
                {lastCommittedItems.length > 0 && (
                  <button
                    onClick={handleUndoSchedule}
                    disabled={undoing}
                    className="px-2.5 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold transition flex items-center gap-1"
                  >
                    <Undo2 className="h-3 w-3" />
                    <span>Undo</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Scheduled Plan Card List */}
          {proposedTasks.length > 0 ? (
            <div className="p-5 rounded-2xl bg-[#14141B] border border-purple-500/30 space-y-4 shadow-xl shadow-purple-500/5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    Proposed AI Schedule Preview
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">{generationSummary}</p>
                </div>

                <button
                  onClick={handleCommitSchedule}
                  disabled={committing}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition flex items-center gap-2 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  <span>{committing ? 'Pushing to Cloud...' : 'Confirm & Push to Calendar'}</span>
                </button>
              </div>

              {/* Task Items */}
              <div className="space-y-2.5">
                {proposedTasks.map((task, idx) => {
                  const colors = CALENDAR_COLORS[task.calendar] || CALENDAR_COLORS['Kevin Nguyen'];

                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${colors.bg} ${colors.text} border ${colors.border}`}
                          >
                            {task.calendar}
                          </span>
                          <span className="text-sm font-bold text-white">{task.itemName}</span>
                        </div>

                        {task.reasoning && (
                          <div className="text-[11px] text-zinc-400 italic">
                            💡 {task.reasoning}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-4 sm:text-right shrink-0">
                        <div>
                          <div className="text-[10px] font-bold uppercase text-zinc-500">Scheduled</div>
                          <div className="text-xs font-black text-cyan-400 font-mono">
                            {task.startTimeFormatted} – {task.endTimeFormatted}
                          </div>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-zinc-800 text-[11px] font-bold text-zinc-300">
                          {task.durationMins}m
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Day Canvas Timeline (When Idle) */
            <div className="p-6 rounded-2xl bg-[#14141B] border border-zinc-800/80 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Target Day Schedule Canvas (8:00 AM – 10:00 PM)
                </span>
                <span className="text-xs text-zinc-500 font-mono">{targetDate}</span>
              </div>

              {busyBlocks.length > 0 ? (
                <div className="space-y-2">
                  {busyBlocks.map((b, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="h-2 w-2 rounded-full bg-cyan-400 shrink-0" />
                        <div>
                          <div className="text-xs font-bold text-zinc-200">{b.title}</div>
                          <div className="text-[10px] text-zinc-500">Calendar: [{b.calendar}]</div>
                        </div>
                      </div>

                      <div className="text-xs font-mono font-bold text-zinc-400">
                        {b.startTime} – {b.endTime}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center text-zinc-500 text-xs">
                  No existing events on {targetDate}. The entire day from 8 AM to 10 PM is completely open for scheduling!
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
