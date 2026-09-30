'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Clock,
  RotateCcw,
  Sparkles,
  CalendarDays,
  CheckCircle2,
  X,
  AlertCircle,
  Repeat,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { CalendarName, RescheduleRequest, RescheduleResponse, TaskItem } from '@/types/task';

interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: {
    id?: string;
    title: string;
    due_date?: string;
    due_time?: string;
    duration_mins?: number;
    calendar_name?: CalendarName;
    calendar_event_id?: string;
    google_task_id?: string;
    schoolUid?: string;
    recurrence_rule?: string;
    recurring_event_id?: string;
    type?: 'Task' | 'Event';
  } | null;
  onSuccess?: (rescheduled: {
    newDate: string;
    newTime: string;
    durationMins: number;
    updatedTask?: TaskItem;
  }) => void;
}

export default function RescheduleModal({ isOpen, onClose, item, onSuccess }: RescheduleModalProps) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('10:00 AM');
  const [selectedDuration, setSelectedDuration] = useState<number>(30);
  const [selectedCalendar, setSelectedCalendar] = useState<CalendarName>('Kevin Nguyen');
  const [recurrenceScope, setRecurrenceScope] = useState<'instance' | 'series'>('instance');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  useEffect(() => {
    if (item && isOpen) {
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      setSelectedDate(item.due_date || todayStr);
      setSelectedTime(item.due_time || '10:00 AM');
      setSelectedDuration(item.duration_mins && item.duration_mins > 0 ? item.duration_mins : 30);
      setSelectedCalendar(item.calendar_name || 'Kevin Nguyen');
      setRecurrenceScope('instance');
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [item, isOpen]);

  // Quick shift helpers (America/New_York relative)
  const setQuickDate = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    setSelectedDate(dateStr);
  };

  const setToNextMonday = () => {
    const d = new Date();
    const day = d.getDay(); // 0 is Sunday, 1 is Monday
    const daysUntilMonday = ((1 + 7 - day) % 7) || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    setSelectedDate(dateStr);
  };

  const handleReschedule = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!item || !selectedDate) return;

    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload: RescheduleRequest = {
        taskId: item.id,
        calendarEventId: item.calendar_event_id,
        googleTaskId: item.google_task_id,
        schoolUid: item.schoolUid,
        title: item.title,
        calendarName: selectedCalendar,
        newDate: selectedDate,
        newTime: selectedTime,
        durationMins: selectedDuration,
        scope: recurrenceScope,
      };

      const res = await fetch('/api/tasks/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data: RescheduleResponse = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to reschedule item');
      }

      setSuccessMsg(data.message || 'Successfully rescheduled!');
      if (onSuccess) {
        onSuccess({
          newDate: selectedDate,
          newTime: selectedTime,
          durationMins: selectedDuration,
          updatedTask: data.updatedTask,
        });
      }

      // Close modal automatically after brief success confirmation
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown reschedule error';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !item) return null;

  const hasRecurrence = Boolean(item.recurrence_rule || item.recurring_event_id);
  const isTimeblocked = Boolean(item.calendar_event_id || item.type === 'Event');
  const hasGoogleTask = Boolean(item.google_task_id || item.type === 'Task');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#121218] p-5 sm:p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Calendar className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                Reschedule & Shift Timeblock
              </h3>
              <p className="text-[11px] text-zinc-400">
                Moves calendar events, Google tasks, and database in lockstep
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Item Title Preview */}
        <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Target Item
          </div>
          <div className="text-xs font-bold text-white line-clamp-2">{item.title}</div>
          <div className="flex items-center gap-2 pt-1 text-[11px] text-zinc-400">
            <span>Currently:</span>
            <span className="font-mono text-zinc-300">
              {item.due_date || 'No Date'} {item.due_time ? `@ ${item.due_time}` : ''}
            </span>
          </div>
        </div>

        {/* Quick Shift Date Chips */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
            <Zap className="h-3 w-3 text-amber-400" /> Quick Date Presets
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {[
              { label: 'Today', action: () => setQuickDate(0) },
              { label: 'Tomorrow', action: () => setQuickDate(1) },
              { label: '+1 Day', action: () => setQuickDate(1) },
              { label: '+2 Days', action: () => setQuickDate(2) },
              { label: 'Next Mon', action: setToNextMonday },
              { label: '+1 Week', action: () => setQuickDate(7) },
            ].map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={preset.action}
                className="py-1.5 px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-cyan-500/40 text-[11px] font-medium text-zinc-300 hover:text-white transition cursor-pointer text-center"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date & Time Picker */}
        <form onSubmit={handleReschedule} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-zinc-400 block mb-1 font-medium">New Date *</label>
              <input
                type="date"
                required
                value={selectedDate}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 [color-scheme:dark] cursor-pointer font-mono"
              />
            </div>

            <div>
              <label className="text-zinc-400 block mb-1 font-medium">New Time *</label>
              <input
                type="text"
                required
                placeholder="10:00 AM"
                value={selectedTime}
                onChange={(e) => setSelectedTime(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          {/* Quick Time Presets */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: 'Morning (9 AM)', time: '9:00 AM' },
              { label: 'Noon (12 PM)', time: '12:00 PM' },
              { label: 'Afternoon (2:30 PM)', time: '2:30 PM' },
              { label: 'Evening (6:30 PM)', time: '6:30 PM' },
              { label: 'Night (8 PM)', time: '8:00 PM' },
            ].map((t) => (
              <button
                key={t.time}
                type="button"
                onClick={() => setSelectedTime(t.time)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition cursor-pointer border ${
                  selectedTime.toLowerCase() === t.time.toLowerCase()
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40 font-bold'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Duration & Calendar Destination */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-zinc-400 block mb-1 font-medium">Duration (Minutes)</label>
              <div className="flex items-center gap-1.5">
                {[15, 30, 45, 60, 90].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setSelectedDuration(mins)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer border ${
                      selectedDuration === mins
                        ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                        : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-800'
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1 font-medium">Calendar Category</label>
              <select
                value={selectedCalendar}
                onChange={(e) => setSelectedCalendar(e.target.value as CalendarName)}
                className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="Kevin Nguyen">Kevin Nguyen</option>
                <option value="School">School</option>
                <option value="Family">Family</option>
                <option value="Volunteering">Volunteering</option>
              </select>
            </div>
          </div>

          {/* Recurrence Scope Selector (Shown if recurring or series) */}
          {hasRecurrence && (
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 space-y-2">
              <div className="flex items-center gap-1.5 text-purple-300 font-bold text-xs">
                <Repeat className="h-3.5 w-3.5" /> Recurring Event Series Detected
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setRecurrenceScope('instance')}
                  className={`p-2 rounded-lg border text-left transition cursor-pointer ${
                    recurrenceScope === 'instance'
                      ? 'bg-purple-500/20 text-purple-200 border-purple-400 font-bold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <div>This Event Only</div>
                  <div className="text-[10px] text-zinc-500 font-normal">
                    Leaves all other recurrences unchanged
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setRecurrenceScope('series')}
                  className={`p-2 rounded-lg border text-left transition cursor-pointer ${
                    recurrenceScope === 'series'
                      ? 'bg-purple-500/20 text-purple-200 border-purple-400 font-bold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <div>Entire Series</div>
                  <div className="text-[10px] text-zinc-500 font-normal">
                    Adjusts the base recurrence time
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Destinations Sync Checklist Badges */}
          <div className="p-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 flex flex-wrap items-center gap-2 text-[10px]">
            <span className="text-zinc-500 font-semibold uppercase">Will Sync Across:</span>
            {isTimeblocked && (
              <span className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                <CheckCircle2 className="h-2.5 w-2.5" /> Google Calendar [{selectedCalendar}]
              </span>
            )}
            {hasGoogleTask && (
              <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                <CheckCircle2 className="h-2.5 w-2.5" /> Google Tasks
              </span>
            )}
            {item.schoolUid && (
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="h-2.5 w-2.5" /> School Sync Module
              </span>
            )}
            <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700 flex items-center gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" /> Supabase Database
            </span>
          </div>

          {/* Error / Success Feedback */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-1.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedDate}
              className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold shadow-md shadow-cyan-500/20 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                  <span>Rescheduling...</span>
                </>
              ) : (
                <>
                  <span>Save & Sync Cloud</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
