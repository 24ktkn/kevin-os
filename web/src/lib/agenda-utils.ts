import { TaskItem, CalendarName } from '@/types/task';

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
  if (!str) return '';
  return str
    .replace(/\\,/g, ',')
    .replace(/\\/g, '')
    .replace(/^[🎓📚📝⏰\s\[\]Task:]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function titlesMatch(a: string, b: string): boolean {
  const normA = cleanAgendaTitle(a).toLowerCase();
  const normB = cleanAgendaTitle(b).toLowerCase();

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // Partial / prefix match for longer module titles (>= 15 chars)
  if (normA.length >= 15 && normB.length >= 15) {
    if (normA.includes(normB) || normB.includes(normA)) return true;
  }

  // Extract core title without duration prefix if present: e.g. "(56 min) Approach..."
  const coreA = normA.replace(/^\(\s*\d+\s*(?:mins?|minutes?|hours?|hrs?)\s*\)\s*/gi, '').trim();
  const coreB = normB.replace(/^\(\s*\d+\s*(?:mins?|minutes?|hours?|hrs?)\s*\)\s*/gi, '').trim();

  if (coreA && coreB && (coreA === coreB || (coreA.length >= 12 && (coreA.includes(coreB) || coreB.includes(coreA))))) {
    return true;
  }

  return false;
}

/**
 * Groups today's tasks and calendar events into deduplicated UnifiedAgendaItems.
 * Pairs Google Calendar timeblocks with their associated Google Tasks while preserving
 * independent control over both.
 */
export function groupTodayAgendaItems(rawTasks: TaskItem[]): UnifiedAgendaItem[] {
  const events = rawTasks.filter((t) => t.type === 'Event');
  const tasks = rawTasks.filter((t) => t.type === 'Task');

  const pairedTaskIds = new Set<string>();
  const unified: UnifiedAgendaItem[] = [];

  // 1. Process Events and find matching Tasks
  for (const ev of events) {
    // Find matching task by linked IDs or title
    const matchingTask = tasks.find((tk) => {
      if (pairedTaskIds.has(tk.id)) return false;

      // Match by explicit foreign keys if populated
      if (ev.google_task_id && tk.google_task_id && ev.google_task_id === tk.google_task_id) return true;
      if (ev.calendar_event_id && tk.calendar_event_id && ev.calendar_event_id === tk.calendar_event_id) return true;

      // Match by title
      return titlesMatch(ev.title, tk.title);
    });

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
    // If one is allCompleted and other is not, show active ones first
    if (a.allCompleted !== b.allCompleted) {
      return a.allCompleted ? 1 : -1;
    }
    const minsA = parseTimeToMinutes(a.due_time);
    const minsB = parseTimeToMinutes(b.due_time);
    return minsA - minsB;
  });

  return unified;
}
