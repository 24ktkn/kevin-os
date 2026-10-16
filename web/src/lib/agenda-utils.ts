import { TaskItem, CalendarName } from '@/types/task';
import { cleanDisplayTitle, cleanTaskTitle, titlesMatch } from '@/lib/date-utils';

export interface UnifiedAgendaItem {
  id: string;
  rawTitle: string;
  cleanTitle: string;
  calendar_name: CalendarName;
  due_date: string;
  due_time?: string;
  duration_mins: number;
  location?: string;
  notes?: string;

  // Calendar Timeblock Component (if present)
  timeblock?: {
    id: string; // Supabase Event row ID
    timeStr: string;
    durationMins: number;
    isCompleted: boolean;
    calendarEventId?: string;
  };

  // Google Task Checklist Component (if present)
  task?: {
    id: string; // Supabase Task row ID
    isCompleted: boolean;
    googleTaskId?: string;
  };

  isMerged: boolean; // true if both timeblock & task exist
  allCompleted: boolean; // true if all sub-components are complete
}

export function cleanAgendaTitle(str?: string): string {
  return cleanDisplayTitle(str);
}

function parseTimeToMinutes(timeStr?: string): number {
  if (!timeStr || !timeStr.trim()) return 99999; // untimed items at bottom

  const cleaned = timeStr.trim().toLowerCase();
  const isPm = cleaned.includes('pm');
  const isAm = cleaned.includes('am');
  const parts = cleaned.replace(/[a-z\s]/gi, '').split(':');
  let h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;

  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;

  return h * 60 + m;
}

/**
 * Groups today's tasks and calendar events into deduplicated UnifiedAgendaItems.
 * Pairs Google Calendar timeblocks with their associated Google Tasks while preserving
 * independent control over both.
 */
export function groupTodayAgendaItems(rawTasks: TaskItem[]): UnifiedAgendaItem[] {
  const events = rawTasks.filter((t) => t.type === 'Event');
  const tasks = rawTasks.filter((t) => t.type === 'Task');

  // Pre-compute normalized titles and index tasks for O(1) lookup by ID or exact title
  const taskByGoogleId = new Map<string, TaskItem>();
  const taskByCalEventId = new Map<string, TaskItem>();
  const taskNormMap = new Map<string, string>();

  for (const tk of tasks) {
    if (tk.google_task_id && !taskByGoogleId.has(tk.google_task_id)) {
      taskByGoogleId.set(tk.google_task_id, tk);
    }
    if (tk.calendar_event_id && !taskByCalEventId.has(tk.calendar_event_id)) {
      taskByCalEventId.set(tk.calendar_event_id, tk);
    }
    taskNormMap.set(tk.id, cleanTaskTitle(tk.title));
  }

  const pairedTaskIds = new Set<string>();
  const unified: UnifiedAgendaItem[] = [];

  // 1. Process Events and find matching Tasks
  for (const ev of events) {
    let matchingTask: TaskItem | undefined;

    if (ev.google_task_id) {
      const candidate = taskByGoogleId.get(ev.google_task_id);
      if (candidate && !pairedTaskIds.has(candidate.id)) {
        matchingTask = candidate;
      }
    }

    if (!matchingTask && ev.calendar_event_id) {
      const candidate = taskByCalEventId.get(ev.calendar_event_id);
      if (candidate && !pairedTaskIds.has(candidate.id)) {
        matchingTask = candidate;
      }
    }

    if (!matchingTask) {
      const evNorm = cleanTaskTitle(ev.title);
      if (evNorm) {
        matchingTask = tasks.find((tk) => {
          if (pairedTaskIds.has(tk.id)) return false;
          const tkNorm = taskNormMap.get(tk.id) || '';
          if (!tkNorm) return false;
          if (evNorm === tkNorm) return true;
          if (evNorm.length > 5 && tkNorm.length > 5 && (evNorm.includes(tkNorm) || tkNorm.includes(evNorm))) {
            return true;
          }
          return titlesMatch(ev.title, tk.title);
        });
      }
    }

    if (matchingTask) {
      pairedTaskIds.add(matchingTask.id);

      const clean = cleanAgendaTitle(ev.title) || cleanAgendaTitle(matchingTask.title);
      const isEventDone = Boolean(ev.is_completed);
      const isTaskDone = Boolean(matchingTask.is_completed);

      unified.push({
        id: `merged_${ev.id}_${matchingTask.id}`,
        rawTitle: ev.title,
        cleanTitle: clean,
        calendar_name: ev.calendar_name || matchingTask.calendar_name,
        due_date: ev.due_date || matchingTask.due_date,
        due_time: ev.due_time,
        duration_mins: ev.duration_mins || 30,
        location: ev.location || matchingTask.location,
        notes: ev.notes || matchingTask.notes,
        timeblock: {
          id: ev.id,
          timeStr: ev.due_time || '',
          durationMins: ev.duration_mins || 30,
          isCompleted: isEventDone,
          calendarEventId: ev.calendar_event_id,
        },
        task: {
          id: matchingTask.id,
          isCompleted: isTaskDone,
          googleTaskId: matchingTask.google_task_id,
        },
        isMerged: true,
        allCompleted: isEventDone && isTaskDone,
      });
    } else {
      // Standalone Event (e.g. Workout, Doctor Appt, etc.)
      unified.push({
        id: ev.id,
        rawTitle: ev.title,
        cleanTitle: cleanAgendaTitle(ev.title),
        calendar_name: ev.calendar_name,
        due_date: ev.due_date,
        due_time: ev.due_time,
        duration_mins: ev.duration_mins,
        location: ev.location,
        notes: ev.notes,
        timeblock: {
          id: ev.id,
          timeStr: ev.due_time || '',
          durationMins: ev.duration_mins || 30,
          isCompleted: Boolean(ev.is_completed),
          calendarEventId: ev.calendar_event_id,
        },
        isMerged: false,
        allCompleted: Boolean(ev.is_completed),
      });
    }
  }

  // 2. Process any remaining unmatched tasks
  for (const tk of tasks) {
    if (pairedTaskIds.has(tk.id)) continue;

    unified.push({
      id: tk.id,
      rawTitle: tk.title,
      cleanTitle: cleanAgendaTitle(tk.title),
      calendar_name: tk.calendar_name,
      due_date: tk.due_date,
      due_time: tk.due_time,
      duration_mins: tk.duration_mins || 0,
      location: tk.location,
      notes: tk.notes,
      task: {
        id: tk.id,
        isCompleted: Boolean(tk.is_completed),
        googleTaskId: tk.google_task_id,
      },
      isMerged: false,
      allCompleted: Boolean(tk.is_completed),
    });
  }

  // 3. Chronological sort by due_time
  unified.sort((a, b) => {
    if (a.allCompleted !== b.allCompleted) {
      return a.allCompleted ? 1 : -1;
    }
    const minsA = parseTimeToMinutes(a.due_time);
    const minsB = parseTimeToMinutes(b.due_time);
    return minsA - minsB;
  });

  return unified;
}
