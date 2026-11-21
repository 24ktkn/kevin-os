import { NextRequest } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  DEFAULT_TIMEZONE,
  addDaysToDateStr,
  cleanDisplayTitle,
  cleanTaskTitle,
  format24hTo12h,
  getProductivityDateStr,
  getTimezoneOffsetStr,
  getTodayDateStr,
  isCompletedCalendarTitle,
  isTaskEventTitle,
  parseTimeToHoursMinutes,
  titlesMatch,
} from '@/lib/date-utils';
import { groupTodayAgendaItems } from '@/lib/agenda-utils';
import { CALENDAR_MAP, getGoogleCalendarClient } from '@/lib/google-calendar';
import { getElentraBusyBlocksForDate } from '@/lib/elentra-calendar';
import {
  BusyInterval,
  RolloverTaskCandidate,
  findFirstEmptySlot,
  hasIntervalConflict,
  planRolloverTimeSlotsWithAI,
} from '@/lib/ai-rollover-scheduler';
import { TaskItem, CalendarName } from '@/types/task';
import { SchoolEvent } from '@/types/school';

import { GET as syncTasksGet } from '@/app/api/tasks/sync/route';
import { POST as completeTaskPost } from '@/app/api/tasks/complete/route';
import { POST as rescheduleTaskPost } from '@/app/api/tasks/reschedule/route';
import { POST as deleteTaskPost } from '@/app/api/tasks/delete/route';
import { POST as schedulePost } from '@/app/api/schedule/route';
import { GET as schoolFetchGet } from '@/app/api/school/fetch/route';
import { GET as healthGet } from '@/app/api/health/route';
import { GET as healthAnalyticsGet } from '@/app/api/health/analytics/route';
import { GET as googleHealthSyncGet } from '@/app/api/health/google-sync/route';
import { GET as habitsGet, POST as habitsPost } from '@/app/api/habits/route';
import { GET as workoutsGet } from '@/app/api/workouts/route';
import { GET as journalGet, POST as journalPost } from '@/app/api/journal/route';
import { GET as mealsGet, POST as mealsPost } from '@/app/api/meals/route';

const INTERNAL_ORIGIN = 'http://localhost:3000';

const KNOWN_SAFE_TABLES = [
  'tasks',
  'school_items',
  'biometrics',
  'habits',
  'workout_logs',
  'journal_entries',
  'costco_meal_items',
  'location_log',
] as const;

const BLOCKED_TABLE_PATTERNS = /auth|token|secret|password|credential|session|oauth|pg_|sql_|storage|vault/i;

function makeInternalReq(pathWithQuery: string, method: 'GET' | 'POST' = 'GET', body?: unknown): NextRequest {
  const url = `${INTERNAL_ORIGIN}${pathWithQuery}`;
  if (method === 'GET') {
    return new NextRequest(url, { method: 'GET' });
  }
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

function enumerateDates(startDate: string, endDate: string, maxDays = 14): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate && dates.length < maxDays) {
    dates.push(cursor);
    cursor = addDaysToDateStr(cursor, 1);
  }
  return dates;
}

function extractSchoolEventDate(ev: SchoolEvent): string {
  if (ev.isAllDay) {
    return String(ev.dateObj || '').slice(0, 10);
  }
  try {
    return new Date(ev.dateObj).toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
  } catch {
    return String(ev.dateObj || '').slice(0, 10);
  }
}

async function fetchBusyBlocksForDates(dates: string[]): Promise<Map<string, BusyInterval[]>> {
  const byDate = new Map<string, BusyInterval[]>();
  for (const d of dates) byDate.set(d, []);
  if (dates.length === 0) return byDate;

  const calendarApi = getGoogleCalendarClient();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const timeMin = `${firstDate}T00:00:00${getTimezoneOffsetStr(firstDate)}`;
  const timeMax = `${lastDate}T23:59:59${getTimezoneOffsetStr(lastDate)}`;

  await Promise.all([
    // 1. All 4 Google Calendars
    (async () => {
      if (!calendarApi) return;
      await Promise.all(
        Object.entries(CALENDAR_MAP).map(async ([calName, calId]) => {
          try {
            const res = await calendarApi.events.list({
              calendarId: calId,
              timeMin,
              timeMax,
              singleEvents: true,
              orderBy: 'startTime',
              maxResults: 250,
            });
            for (const ev of res.data.items || []) {
              if (!ev.summary || !ev.start?.dateTime) continue;
              if (isCompletedCalendarTitle(ev.summary)) continue;

              const start = new Date(ev.start.dateTime);
              const dStr = start.toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
              const list = byDate.get(dStr);
              if (!list) continue;

              const timeStr = start.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: DEFAULT_TIMEZONE,
              });
              let dur = 60;
              if (ev.end?.dateTime) {
                const end = new Date(ev.end.dateTime);
                dur = Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000));
              }
              const parsed = parseTimeToHoursMinutes(timeStr);
              const startMins = parsed.hours * 60 + parsed.minutes;
              const endMins = startMins + dur;
              list.push({
                id: ev.id || undefined,
                title: ev.summary,
                calendar: calName,
                startMins,
                endMins,
                startTime12h: timeStr,
                endTime12h: format24hTo12h(Math.floor((endMins % 1440) / 60), endMins % 60),
              });
            }
          } catch {
            // ignore individual calendar errors
          }
        })
      );
    })(),

    // 2. Schulich Elentra live timed classes
    Promise.all(
      dates.map(async (dStr) => {
        const classes = await getElentraBusyBlocksForDate(dStr);
        const list = byDate.get(dStr);
        if (list) list.push(...classes);
      })
    ),
  ]);

  for (const list of byDate.values()) {
    list.sort((a, b) => a.startMins - b.startMins);
  }
  return byDate;
}

/**
 * 1. Complete daily overview: tasks, classes, biometrics, habits, and meals.
 */
export async function getKevinOsOverview(params: { syncFirst?: boolean } = {}) {
  const todayStr = getTodayDateStr();
  let syncSummary: unknown = null;

  if (params.syncFirst !== false) {
    try {
      const syncRes = await syncTasksGet();
      const syncJson = await syncRes.json();
      syncSummary = {
        calendarEventsSynced: syncJson?.results?.calendarEventsSynced ?? 0,
        tasksSynced: syncJson?.results?.tasksSynced ?? 0,
        aiRolloverRescheduled: syncJson?.results?.aiRolloverRescheduled ?? 0,
      };
    } catch (err) {
      syncSummary = { warning: err instanceof Error ? err.message : 'Sync skipped' };
    }
  }

  const [agenda, healthRes, habitsRes, mealsRes] = await Promise.all([
    getScheduleAndTasks({ startDate: todayStr, endDate: todayStr, includeCompleted: true, syncFirst: false }),
    healthGet(makeInternalReq('/api/health')).then((r) => r.json()).catch(() => null),
    habitsGet().then((r) => r.json()).catch(() => null),
    mealsGet(makeInternalReq('/api/meals')).then((r) => r.json()).catch(() => null),
  ]);

  const habits = Array.isArray(habitsRes?.habits)
    ? habitsRes.habits.map((h: Record<string, unknown>) => ({
        name: h.name,
        completedToday: h.completedToday,
        streak: h.streak,
        consistencyRate: h.consistencyRate,
      }))
    : [];

  const groceryItems = Array.isArray(mealsRes?.groceryItems) ? mealsRes.groceryItems : [];
  const uncheckedGroceries = groceryItems.filter((g: { isChecked?: boolean }) => !g.isChecked).length;

  return {
    date: todayStr,
    timezone: DEFAULT_TIMEZONE,
    syncSummary,
    todayAgenda: agenda,
    latestHealth: healthRes?.data || null,
    habitsToday: habits,
    mealPrep: mealsRes?.success
      ? {
          activeTrip: mealsRes.activeTrip,
          activeWeek: mealsRes.activeWeek,
          weekTheme: mealsRes.weeklyPlan?.theme,
          uncheckedGroceryCount: uncheckedGroceries,
          totalGroceryCount: groceryItems.length,
        }
      : null,
  };
}

/**
 * 2. Read tasks, Google Calendar timeblocks, and Elentra classes for a date or range.
 */
export async function getScheduleAndTasks(params: {
  startDate?: string;
  endDate?: string;
  includeCompleted?: boolean;
  calendar?: CalendarName;
  syncFirst?: boolean;
} = {}) {
  const todayStr = getTodayDateStr();
  const startDate = params.startDate || todayStr;
  const endDate = params.endDate || startDate;
  const includeCompleted = params.includeCompleted !== false;

  if (params.syncFirst) {
    await syncTasksGet().catch(() => {});
  }

  const dates = enumerateDates(startDate, endDate, 14);
  const sb = supabaseAdmin || supabase;

  const [tasksQueryRes, elentraLists] = await Promise.all([
    (async () => {
      if (!sb) return [] as TaskItem[];
      let query = sb
        .from('tasks')
        .select('*')
        .gte('due_date', startDate)
        .lte('due_date', endDate)
        .order('due_date', { ascending: true })
        .order('due_time', { ascending: true });

      if (params.calendar) {
        query = query.eq('calendar_name', params.calendar);
      }

      const { data } = await query;
      const rows = (data || []) as TaskItem[];

      // Also include overdue incomplete tasks when inspecting today
      if (startDate <= todayStr && endDate >= todayStr) {
        let overdueQ = sb
          .from('tasks')
          .select('*')
          .eq('is_completed', false)
          .lt('due_date', startDate);
        if (params.calendar) {
          overdueQ = overdueQ.eq('calendar_name', params.calendar);
        }
        const { data: overdueData } = await overdueQ;
        if (overdueData) {
          const seen = new Set(rows.map((r) => r.id));
          for (const od of overdueData as TaskItem[]) {
            if (!seen.has(od.id) && (od.type === 'Task' || isTaskEventTitle(od.title))) {
              rows.push({ ...od, due_date: todayStr });
            }
          }
        }
      }

      return rows;
    })(),
    Promise.all(
      dates.map(async (dStr) => ({
        date: dStr,
        classes: await getElentraBusyBlocksForDate(dStr),
      }))
    ),
  ]);

  const byDate: Record<
    string,
    {
      date: string;
      elentraClasses: Array<{
        title: string;
        startTime: string;
        endTime: string;
        location?: string;
      }>;
      outstandingTasks: Array<Record<string, unknown>>;
      completedItems: Array<Record<string, unknown>>;
    }
  > = {};

  for (const entry of elentraLists) {
    const dayRawRows = tasksQueryRes.filter((r) => r.due_date === entry.date);
    const unified = groupTodayAgendaItems(dayRawRows);

    const outstanding: Array<Record<string, unknown>> = [];
    const completed: Array<Record<string, unknown>> = [];

    for (const item of unified) {
      const summaryObj = {
        id: item.task?.id || item.timeblock?.id || item.id,
        title: item.cleanTitle,
        calendar: item.calendar_name,
        dueDate: item.due_date,
        time: item.timeblock?.timeStr || item.due_time || 'Untimed',
        durationMins: item.timeblock?.durationMins || item.duration_mins || 0,
        hasTimeblock: Boolean(item.timeblock),
        hasGoogleTask: Boolean(item.task),
        isCompleted: item.allCompleted,
        calendarEventId: item.timeblock?.calendarEventId,
        googleTaskId: item.task?.googleTaskId,
        location: item.location || undefined,
      };

      if (item.allCompleted) {
        if (includeCompleted) completed.push(summaryObj);
      } else {
        outstanding.push(summaryObj);
      }
    }

    byDate[entry.date] = {
      date: entry.date,
      elentraClasses: entry.classes.map((c) => ({
        title: c.title,
        startTime: c.startTime12h,
        endTime: c.endTime12h,
        location: c.location,
      })),
      outstandingTasks: outstanding,
      completedItems: completed,
    };
  }

  const totalOutstanding = Object.values(byDate).reduce(
    (sum, d) => sum + d.outstandingTasks.length,
    0
  );

  return {
    startDate,
    endDate,
    today: todayStr,
    totalOutstanding,
    days: Object.values(byDate),
  };
}

/**
 * 3. List Schulich Elentra school modules, classes, or assignments merged with Supabase state.
 */
export async function getSchoolModules(params: {
  startDate?: string;
  endDate?: string;
  category?: 'module' | 'class' | 'assignment' | 'all';
  onlyUnscheduled?: boolean;
  onlyIncomplete?: boolean;
} = {}) {
  const todayStr = getTodayDateStr();
  const startDate = params.startDate || addDaysToDateStr(todayStr, -7);
  const endDate = params.endDate || addDaysToDateStr(todayStr, 14);
  const category = params.category || 'module';
  const onlyUnscheduled = Boolean(params.onlyUnscheduled);
  const onlyIncomplete = params.onlyIncomplete !== false;

  const sb = supabaseAdmin || supabase;

  const [icsRes, dbSchoolRows, dbTasks] = await Promise.all([
    schoolFetchGet(makeInternalReq('/api/school/fetch')).then((r) => r.json()),
    sb
      ? sb
          .from('school_items')
          .select('uid, title, category, is_completed, is_scheduled, scheduled_date, scheduled_time, duration_mins, target_calendar')
          .then((r) => (r.data || []).filter((s) => !String(s.uid).startsWith('__system_')))
      : Promise.resolve([]),
    sb
      ? sb
          .from('tasks')
          .select('id, title, due_date, due_time, duration_mins, calendar_name, is_completed, is_scheduled, calendar_event_id, google_task_id')
          .then((r) => r.data || [])
      : Promise.resolve([]),
  ]);

  const icsEvents: SchoolEvent[] = Array.isArray(icsRes?.events) ? icsRes.events : [];
  const schoolByUid = new Map<string, Record<string, unknown>>();
  for (const row of dbSchoolRows as Array<Record<string, unknown>>) {
    if (row.uid) schoolByUid.set(String(row.uid), row);
  }

  const results: Array<{
    uid: string;
    title: string;
    rawSummary: string;
    category: string;
    releaseDate: string;
    durationMins: number;
    isCompleted: boolean;
    isScheduled: boolean;
    scheduledDate: string | null;
    scheduledTime: string | null;
    targetCalendar: string | null;
  }> = [];

  for (const ev of icsEvents) {
    const releaseDate = extractSchoolEventDate(ev);
    if (releaseDate < startDate || releaseDate > endDate) continue;

    const dbRow = schoolByUid.get(ev.uid);
    const effectiveCategory = String(dbRow?.category || ev.category || 'class');
    if (category !== 'all' && effectiveCategory !== category) continue;

    const matchedTask = (dbTasks as Array<Record<string, unknown>>).find(
      (t) => t.title && titlesMatch(String(t.title), ev.summary)
    );

    const isCompleted = Boolean(dbRow?.is_completed) || Boolean(matchedTask?.is_completed);
    const isScheduled =
      Boolean(dbRow?.is_scheduled) ||
      Boolean(matchedTask?.is_scheduled) ||
      Boolean(matchedTask?.calendar_event_id);

    if (onlyIncomplete && isCompleted) continue;
    if (onlyUnscheduled && isScheduled) continue;

    results.push({
      uid: ev.uid,
      title: cleanDisplayTitle(ev.summary),
      rawSummary: ev.summary,
      category: effectiveCategory,
      releaseDate,
      durationMins:
        Number(dbRow?.duration_mins) ||
        Number(matchedTask?.duration_mins) ||
        ev.duration ||
        60,
      isCompleted,
      isScheduled,
      scheduledDate:
        (dbRow?.scheduled_date as string | null) ||
        (matchedTask?.due_date as string | null) ||
        null,
      scheduledTime:
        (dbRow?.scheduled_time as string | null) ||
        (matchedTask?.due_time as string | null) ||
        null,
      targetCalendar:
        (dbRow?.target_calendar as string | null) ||
        (matchedTask?.calendar_name as string | null) ||
        null,
    });
  }

  results.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  return {
    startDate,
    endDate,
    category,
    count: results.length,
    items: results,
  };
}

/**
 * 4. Schedule a single task, module, or standalone event onto Google Calendar + Google Tasks + Supabase.
 */
export async function scheduleItem(params: {
  title: string;
  date?: string;
  time?: string;
  durationMins?: number;
  calendar?: CalendarName;
  autoFindEmptySlot?: boolean;
  isStandaloneEvent?: boolean;
  skipCalendar?: boolean;
  skipTask?: boolean;
  description?: string;
  location?: string;
  repeat?: string;
}) {
  const targetDate = params.date || getTodayDateStr();
  const durationMins = Math.max(5, params.durationMins || 60);
  const calendar: CalendarName = params.calendar || 'School';
  let assignedTime = params.time?.trim() || '';
  let slotReasoning: string | undefined;

  if (!params.skipCalendar && (params.autoFindEmptySlot || !assignedTime)) {
    const busyMap = await fetchBusyBlocksForDates([targetDate]);
    const busyBlocks = busyMap.get(targetDate) || [];
    const slotMap = await planRolloverTimeSlotsWithAI(targetDate, busyBlocks, [
      {
        id: 'schedule-single',
        title: params.title,
        calendar,
        durationMins,
        preferredTimeStr: assignedTime || undefined,
      },
    ]);
    const picked = slotMap.get('schedule-single');
    if (picked) {
      assignedTime = picked.startTime12h;
      slotReasoning = picked.reasoning;
    } else {
      const fallbackMins = findFirstEmptySlot(durationMins, busyBlocks, 8 * 60);
      assignedTime = format24hTo12h(Math.floor(fallbackMins / 60), fallbackMins % 60);
    }
  }

  const res = await schedulePost(
    makeInternalReq('/api/schedule', 'POST', {
      title: params.title,
      description: params.description || '',
      location: params.location || '',
      date: targetDate,
      time: assignedTime || '10:00 AM',
      duration: durationMins,
      calendar,
      skipCalendar: Boolean(params.skipCalendar),
      skipTask: Boolean(params.skipTask),
      isStandaloneEvent: Boolean(params.isStandaloneEvent),
      repeat: params.repeat,
    })
  );
  const json = await res.json();

  return {
    ...json,
    scheduledDate: targetDate,
    scheduledTime: assignedTime || '10:00 AM',
    durationMins,
    calendar,
    slotReasoning,
  };
}

/**
 * 5. Automatically schedule all unscheduled online modules for a week around classes & existing events.
 */
export async function scheduleWeekModules(params: {
  startDate?: string;
  endDate?: string;
  moduleTitles?: string[];
  includeOverdueModules?: boolean;
  maxModulesPerDay?: number;
  preferredStartHour?: number;
  dryRun?: boolean;
} = {}) {
  const todayStr = getTodayDateStr();
  const startDate = params.startDate || todayStr;
  const endDate = params.endDate || addDaysToDateStr(startDate, 6);
  const maxModulesPerDay = Math.max(1, Math.min(8, params.maxModulesPerDay || 4));
  const earliestStartMins = Math.max(6, Math.min(20, params.preferredStartHour || 8)) * 60;
  const dryRun = Boolean(params.dryRun);

  const days = enumerateDates(startDate, endDate, 14);
  if (days.length === 0) {
    return { success: false, error: 'endDate must be on or after startDate.' };
  }

  const moduleFetchStart = params.includeOverdueModules
    ? addDaysToDateStr(startDate, -14)
    : startDate;

  const [schoolRes, busyByDate] = await Promise.all([
    getSchoolModules({
      startDate: moduleFetchStart,
      endDate,
      category: 'module',
      onlyUnscheduled: true,
      onlyIncomplete: true,
    }),
    fetchBusyBlocksForDates(days),
  ]);

  let targetModules = schoolRes.items;
  if (params.moduleTitles && params.moduleTitles.length > 0) {
    const requested = params.moduleTitles;
    targetModules = targetModules.filter((m) =>
      requested.some((reqTitle) => titlesMatch(m.rawSummary, reqTitle) || titlesMatch(m.title, reqTitle))
    );
  }

  if (targetModules.length === 0) {
    return {
      success: true,
      dryRun,
      startDate,
      endDate,
      scheduledCount: 0,
      message: 'No unscheduled incomplete online modules found in this date range.',
      plannedSlots: [],
    };
  }

  // Round duration nicely up to nearest 15 mins (minimum 30 mins, matching Kevin's standard study blocks)
  const computeBlockDuration = (rawMins: number) => {
    const safe = Math.max(15, rawMins || 45);
    return Math.ceil(safe / 15) * 15;
  };

  // Track occupied intervals & assigned module count per day
  const occupiedByDay = new Map<string, Array<{ startMins: number; endMins: number }>>();
  const assignedCountByDay = new Map<string, number>();
  const dayCandidatesMap = new Map<
    string,
    Array<{
      mod: (typeof targetModules)[number];
      blockDurationMins: number;
    }>
  >();

  for (const d of days) {
    const busy = busyByDate.get(d) || [];
    occupiedByDay.set(
      d,
      busy.map((b) => ({ startMins: b.startMins, endMins: b.endMins }))
    );
    assignedCountByDay.set(d, 0);
    dayCandidatesMap.set(d, []);
  }

  // Compute remaining daytime open minutes on a day (8 AM - 10 PM)
  const estimateFreeMins = (d: string) => {
    const occ = occupiedByDay.get(d) || [];
    let busyTotal = 0;
    for (const b of occ) {
      const s = Math.max(earliestStartMins, b.startMins);
      const e = Math.min(22 * 60, b.endMins);
      if (e > s) busyTotal += e - s;
    }
    return Math.max(0, 22 * 60 - earliestStartMins - busyTotal);
  };

  // Assign each module to the best day (>= releaseDate when within window) with free capacity
  const skipped: Array<{ uid: string; title: string; reason: string }> = [];

  for (const mod of targetModules) {
    const blockDur = computeBlockDuration(mod.durationMins);
    const eligibleDays = days.filter((d) => d >= mod.releaseDate && d >= todayStr);
    const candidateDays = eligibleDays.length > 0 ? eligibleDays : days.filter((d) => d >= todayStr);
    const searchDays = candidateDays.length > 0 ? candidateDays : days;

    // Prefer days under maxModulesPerDay sorted by most free time (tie-breaking earlier dates)
    const rankedDays = [...searchDays]
      .filter((d) => (assignedCountByDay.get(d) || 0) < maxModulesPerDay)
      .sort((a, b) => {
        const countDiff = (assignedCountByDay.get(a) || 0) - (assignedCountByDay.get(b) || 0);
        if (countDiff !== 0) return countDiff;
        return estimateFreeMins(b) - estimateFreeMins(a);
      });

    let placedDay: string | null = null;
    for (const d of rankedDays) {
      const occ = occupiedByDay.get(d) || [];
      const testSlot = findFirstEmptySlot(blockDur, occ, earliestStartMins);
      if (!hasIntervalConflict(testSlot, testSlot + blockDur, occ, 0) && testSlot + blockDur <= 22 * 60 + 30) {
        placedDay = d;
        break;
      }
    }

    if (!placedDay) {
      skipped.push({
        uid: mod.uid,
        title: mod.title,
        reason: 'No open daytime slot remaining within the requested date range.',
      });
      continue;
    }

    dayCandidatesMap.get(placedDay)!.push({ mod, blockDurationMins: blockDur });
    assignedCountByDay.set(placedDay, (assignedCountByDay.get(placedDay) || 0) + 1);
  }

  // Run AI slot planner per day with assigned modules
  const plannedSlots: Array<{
    uid: string;
    title: string;
    rawSummary: string;
    date: string;
    startTime: string;
    endTime: string;
    durationMins: number;
    reasoning: string;
    committed?: boolean;
    calendarEventId?: string | null;
    googleTaskId?: string | null;
  }> = [];

  for (const d of days) {
    const entries = dayCandidatesMap.get(d) || [];
    if (entries.length === 0) continue;

    // Sort longest first so 90m blocks get clean wide gaps
    entries.sort((a, b) => b.blockDurationMins - a.blockDurationMins);
    const busyBlocks = busyByDate.get(d) || [];
    const aiCandidates: RolloverTaskCandidate[] = entries.map((e) => ({
      id: e.mod.uid,
      title: e.mod.title,
      calendar: 'School',
      durationMins: e.blockDurationMins,
    }));

    const slotMap = await planRolloverTimeSlotsWithAI(d, busyBlocks, aiCandidates);

    for (const e of entries) {
      const assigned = slotMap.get(e.mod.uid);
      if (!assigned) continue;
      plannedSlots.push({
        uid: e.mod.uid,
        title: e.mod.title,
        rawSummary: e.mod.rawSummary,
        date: d,
        startTime: assigned.startTime12h,
        endTime: assigned.endTime12h,
        durationMins: assigned.durationMins,
        reasoning: assigned.reasoning,
      });
    }
  }

  plannedSlots.sort((a, b) =>
    a.date !== b.date
      ? a.date.localeCompare(b.date)
      : (() => {
          const pa = parseTimeToHoursMinutes(a.startTime);
          const pb = parseTimeToHoursMinutes(b.startTime);
          return pa.hours * 60 + pa.minutes - (pb.hours * 60 + pb.minutes);
        })()
  );

  if (!dryRun) {
    const sb = supabaseAdmin || supabase;
    for (const slot of plannedSlots) {
      const schedRes = await schedulePost(
        makeInternalReq('/api/schedule', 'POST', {
          title: slot.title,
          description: `Scheduled via Kevin-OS MCP (${slot.durationMins}m). ${slot.reasoning}`,
          date: slot.date,
          time: slot.startTime,
          duration: slot.durationMins,
          calendar: 'School',
          skipCalendar: false,
          skipTask: false,
          isStandaloneEvent: false,
        })
      );
      const schedJson = await schedRes.json();
      slot.committed = Boolean(schedJson?.success);
      slot.calendarEventId = schedJson?.calendarEventId || null;
      slot.googleTaskId = schedJson?.taskId || null;

      if (sb && slot.committed) {
        await sb.from('school_items').upsert({
          uid: slot.uid,
          title: slot.rawSummary,
          category: 'module',
          is_completed: false,
          is_scheduled: true,
          scheduled_date: slot.date,
          scheduled_time: slot.startTime,
          duration_mins: slot.durationMins,
          target_calendar: 'School',
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  return {
    success: true,
    dryRun,
    startDate,
    endDate,
    scheduledCount: plannedSlots.length,
    skippedCount: skipped.length,
    plannedSlots,
    skipped,
  };
}

/**
 * 6. Complete or uncomplete a task / timeblock / school module across all systems.
 */
export async function completeTask(params: {
  title?: string;
  taskId?: string;
  googleTaskId?: string;
  calendarEventId?: string;
  calendarName?: CalendarName;
  completed: boolean;
  timeblockOnly?: boolean;
}) {
  const res = await completeTaskPost(
    makeInternalReq('/api/tasks/complete', 'POST', {
      taskId: params.taskId,
      googleTaskId: params.googleTaskId,
      calendarEventId: params.calendarEventId,
      title: params.title,
      calendar_name: params.calendarName,
      completed: params.completed,
      timeblockOnly: params.timeblockOnly,
    })
  );
  return await res.json();
}

/**
 * 7. Reschedule an existing task / module to a new date/time or an AI-selected open slot.
 */
export async function rescheduleTask(params: {
  title?: string;
  taskId?: string;
  calendarEventId?: string;
  googleTaskId?: string;
  newDate: string;
  newTime?: string;
  durationMins?: number;
  autoFindEmptySlot?: boolean;
  calendarName?: CalendarName;
  createTimeblock?: boolean;
}) {
  const autoSlot =
    typeof params.autoFindEmptySlot === 'boolean' ? params.autoFindEmptySlot : !params.newTime;

  const res = await rescheduleTaskPost(
    makeInternalReq('/api/tasks/reschedule', 'POST', {
      taskId: params.taskId,
      calendarEventId: params.calendarEventId,
      googleTaskId: params.googleTaskId,
      title: params.title,
      newDate: params.newDate,
      newTime: params.newTime,
      durationMins: params.durationMins,
      autoFindEmptySlot: autoSlot,
      calendarName: params.calendarName,
      createTimeblock: params.createTimeblock,
    })
  );
  return await res.json();
}

/**
 * 8. Delete a task/timeblock across Google Calendar, Google Tasks, and Supabase.
 */
export async function deleteTask(params: {
  title?: string;
  taskId?: string;
  calendarEventId?: string;
  googleTaskId?: string;
  calendarName?: CalendarName;
}) {
  const res = await deleteTaskPost(
    makeInternalReq('/api/tasks/delete', 'POST', {
      taskId: params.taskId,
      calendarEventId: params.calendarEventId,
      googleTaskId: params.googleTaskId,
      calendarName: params.calendarName,
      title: params.title,
    })
  );
  return await res.json();
}

/**
 * 9. Health, sleep, HRV/RHR, steps, habits, and workouts trend summary.
 */
export async function getHealthSummary(params: {
  timeframe?: 'week' | 'month' | 'quarter' | 'year' | 'all';
  includeDailyPoints?: boolean;
  syncGoogleHealth?: boolean;
} = {}) {
  const timeframe = params.timeframe || 'week';
  let googleSyncResult: unknown = null;

  if (params.syncGoogleHealth) {
    try {
      const gs = await googleHealthSyncGet(makeInternalReq('/api/health/google-sync?days=7'));
      googleSyncResult = await gs.json();
    } catch (err) {
      googleSyncResult = { warning: err instanceof Error ? err.message : 'Google Health sync failed' };
    }
  }

  const [analyticsJson, latestJson, habitsJson, workoutsJson] = await Promise.all([
    healthAnalyticsGet(makeInternalReq(`/api/health/analytics?timeframe=${timeframe}`)).then((r) =>
      r.json()
    ),
    healthGet(makeInternalReq('/api/health')).then((r) => r.json()).catch(() => null),
    habitsGet().then((r) => r.json()).catch(() => null),
    workoutsGet().then((r) => r.json()).catch(() => null),
  ]);

  return {
    timeframe,
    googleSyncResult,
    latestDay: latestJson?.data || null,
    summary: analyticsJson?.summary || null,
    dailyMetrics:
      params.includeDailyPoints !== false
        ? (analyticsJson?.dailyPoints || []).slice(-31)
        : undefined,
    monthlyRollups: timeframe === 'quarter' || timeframe === 'year' || timeframe === 'all'
      ? analyticsJson?.monthlyRollups || []
      : undefined,
    habits: Array.isArray(habitsJson?.habits)
      ? habitsJson.habits.map((h: Record<string, unknown>) => ({
          name: h.name,
          streak: h.streak,
          consistencyRate: h.consistencyRate,
          completedToday: h.completedToday,
          totalCompleted: h.totalCompleted,
        }))
      : [],
    workoutsOverview: workoutsJson?.success
      ? {
          totalWorkouts: workoutsJson.totalWorkouts,
          totalVolumeLbs: workoutsJson.totalVolumeLbs,
          averageDurationMins: workoutsJson.averageDurationMins,
          recentSessions: (workoutsJson.recentSessions || []).slice(0, 7),
          muscleRecovery: workoutsJson.muscleRecovery || [],
        }
      : null,
  };
}

/**
 * 10. Habits read & write.
 */
export async function getHabitsData() {
  const res = await habitsGet();
  return await res.json();
}

export async function logHabit(params: {
  habit: 'Wake Up On Time' | 'Gym Workout' | 'Journaling' | 'Anki';
  completed: boolean;
  date?: string;
}) {
  const res = await habitsPost(makeInternalReq('/api/habits', 'POST', params));
  return await res.json();
}

/**
 * 11. Workouts read (sessions, PRs, muscle recovery, exercise logs).
 */
export async function getWorkoutsData(params: { includeExerciseLogs?: boolean } = {}) {
  const res = await workoutsGet();
  const data = await res.json();
  if (!params.includeExerciseLogs && data?.recentLogs) {
    return { ...data, recentLogs: data.recentLogs.slice(0, 15) };
  }
  return data;
}

/**
 * 12. Journal read & write (supports appending or replacing).
 */
export async function getJournalData(params: { date?: string; recentDays?: number } = {}) {
  const targetDate = params.date || getProductivityDateStr();

  if (params.recentDays && params.recentDays > 1) {
    const sb = supabaseAdmin || supabase;
    const clampedDays = Math.min(30, Math.max(1, params.recentDays));
    const startDate = addDaysToDateStr(targetDate, -(clampedDays - 1));
    if (sb) {
      const { data } = await sb
        .from('journal_entries')
        .select('date, entry, updated_at')
        .gte('date', startDate)
        .lte('date', targetDate)
        .order('date', { ascending: false });
      return {
        success: true,
        startDate,
        endDate: targetDate,
        entries: data || [],
      };
    }
  }

  const res = await journalGet(makeInternalReq(`/api/journal?date=${encodeURIComponent(targetDate)}`));
  return await res.json();
}

export async function saveJournalEntry(params: {
  date?: string;
  entry: string;
  mode?: 'append' | 'replace';
}) {
  const targetDate = params.date || getProductivityDateStr();
  const mode = params.mode || 'append';
  let finalEntry = params.entry;
  let existingPhotos: string[] = [];

  if (mode === 'append') {
    const existing = await getJournalData({ date: targetDate });
    if (existing?.entry && String(existing.entry).trim()) {
      finalEntry = `${String(existing.entry).trim()}\n\n${params.entry.trim()}`;
    }
    if (Array.isArray(existing?.photos)) {
      existingPhotos = existing.photos;
    }
  }

  const res = await journalPost(
    makeInternalReq('/api/journal', 'POST', {
      date: targetDate,
      entry: finalEntry,
      photos: existingPhotos,
    })
  );
  return await res.json();
}

/**
 * 13. Meals, recipes, and Costco grocery checklist read & toggle.
 */
export async function getMealsAndGroceries(params: { trip?: string; week?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.trip) qs.set('trip', params.trip);
  if (params.week) qs.set('week', String(params.week));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await mealsGet(makeInternalReq(`/api/meals${suffix}`));
  return await res.json();
}

export async function toggleGroceryItem(params: {
  id?: string;
  itemName?: string;
  isChecked?: boolean;
  clearAll?: boolean;
}) {
  if (params.clearAll) {
    const res = await mealsPost(makeInternalReq('/api/meals', 'POST', { clearAll: true }));
    return await res.json();
  }

  let targetId = params.id;
  if (!targetId && params.itemName) {
    const current = await getMealsAndGroceries();
    const items = (current?.groceryItems || []) as Array<{ id: string; itemName: string }>;
    const q = cleanTaskTitle(params.itemName);
    const matched = items.find(
      (i) => cleanTaskTitle(i.itemName) === q || cleanTaskTitle(i.itemName).includes(q)
    );
    if (!matched) {
      return { success: false, error: `Could not find grocery item matching "${params.itemName}".` };
    }
    targetId = matched.id;
  }

  const res = await mealsPost(
    makeInternalReq('/api/meals', 'POST', {
      id: targetId,
      isChecked: Boolean(params.isChecked),
    })
  );
  return await res.json();
}

/**
 * 14. Future-proof read-only query tool for any Kevin-OS Supabase table (current or newly added).
 * Strictly excludes system token/secret rows and auth/internal tables.
 */
export async function queryKevinOsTable(params: {
  table?: string;
  limit?: number;
  orderBy?: string;
  ascending?: boolean;
  equals?: Record<string, string | number | boolean>;
} = {}) {
  if (!params.table) {
    return {
      knownTables: [...KNOWN_SAFE_TABLES],
      note: 'Pass any non-secret Kevin-OS Supabase table name to read rows (including future tables added to Kevin-OS). System rows (__system_*) are automatically redacted.',
    };
  }

  const tableName = params.table.trim();
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(tableName) || BLOCKED_TABLE_PATTERNS.test(tableName)) {
    return {
      success: false,
      error: `Table "${tableName}" is invalid or restricted for security.`,
    };
  }

  const sb = supabaseAdmin || supabase;
  if (!sb) {
    return { success: false, error: 'Supabase client is not configured.' };
  }

  const limit = Math.min(100, Math.max(1, params.limit || 25));
  let query = sb.from(tableName).select('*');

  if (params.equals) {
    for (const [col, val] of Object.entries(params.equals)) {
      if (/^[a-z][a-z0-9_]{0,62}$/.test(col)) {
        query = query.eq(col, val);
      }
    }
  }

  if (params.orderBy && /^[a-z][a-z0-9_]{0,62}$/.test(params.orderBy)) {
    query = query.order(params.orderBy, { ascending: Boolean(params.ascending) });
  }

  const { data, error } = await query.limit(limit);
  if (error) {
    return { success: false, error: error.message };
  }

  // Always strip system credential/cache rows (e.g. __system_google_tasks_token__)
  const safeRows = (data || []).filter((row: Record<string, unknown>) => {
    const uid = String(row.uid || row.id || '');
    return !uid.startsWith('__system_');
  });

  return {
    success: true,
    table: tableName,
    count: safeRows.length,
    rows: safeRows,
  };
}
