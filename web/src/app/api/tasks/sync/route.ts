import { NextResponse } from 'next/server';
import { tasks_v1 } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  isEventPast,
  getTodayDateStr,
  isTaskEventTitle,
  isCompletedCalendarTitle,
  stripTaskEventPrefix,
  formatCompletedCalendarSummary,
  cleanTaskTitle,
  computeStartEndIso,
  parseTimeToHoursMinutes,
  format24hTo12h,
} from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClientAsync,
  buildScheduledNotesTag,
} from '@/lib/google-calendar';
import {
  BusyInterval,
  RolloverTaskCandidate,
  AssignedRolloverSlot,
  planRolloverTimeSlotsWithAI,
} from '@/lib/ai-rollover-scheduler';

export const dynamic = 'force-dynamic';

interface PreCleanedSchoolRow {
  uid: string;
  title: string;
  clean: string;
  is_completed: boolean;
  is_scheduled: boolean;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  duration_mins?: number | null;
  target_calendar?: string | null;
  updated_at?: string | null;
}

interface PreCleanedTaskRow {
  id: string;
  title: string;
  clean: string;
  due_date: string;
  due_time: string;
  duration_mins: number;
  google_task_id: string | null;
  calendar_event_id: string | null;
  calendar_name: string;
  is_completed: boolean;
  is_scheduled?: boolean;
  updated_at?: string | null;
}

interface PreCleanedEventRow {
  id: string;
  title: string;
  clean: string;
  calendar_name: string;
  due_date: string;
  due_time: string;
  duration_mins: number;
  location: string;
  notes: string;
  calendar_event_id: string | null;
  google_task_id: string | null;
  is_completed: boolean;
  updated_at?: string | null;
}

interface IndexedGTask {
  calName: string;
  listId: string;
  item: tasks_v1.Schema$Task;
  clean: string;
}

function titlesMatchClean(cleanA: string, cleanB: string): boolean {
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  return cleanA.length > 5 && cleanB.length > 5 && (cleanA.includes(cleanB) || cleanB.includes(cleanA));
}

function parseIsoMs(iso?: string | null): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function listAllGoogleTasks(tasksApi: tasks_v1.Tasks, listId: string) {
  const allItems: tasks_v1.Schema$Task[] = [];
  let pageToken: string | undefined;

  do {
    const res = await tasksApi.tasks.list({
      tasklist: listId,
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    if (res.data.items) allItems.push(...res.data.items);
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return allItems;
}

function resolveTaskCompletion(params: {
  existingEv?: PreCleanedEventRow;
  matchedTask?: PreCleanedTaskRow;
  matchedSchool?: PreCleanedSchoolRow;
  matchedGTask?: IndexedGTask;
  evSummary?: string;
}): {
  finalCompleted: boolean;
  uncheckNewerInGoogle: boolean;
  needsPushCompletedToGoogleTask: boolean;
} {
  const { existingEv, matchedTask, matchedSchool, matchedGTask, evSummary } = params;

  const evHasCheckmark = isCompletedCalendarTitle(evSummary);
  const evDone = Boolean(existingEv?.is_completed);
  const tkDone = Boolean(matchedTask?.is_completed);
  const scDone = Boolean(matchedSchool?.is_completed);
  const gtDone = matchedGTask?.item?.status === 'completed';

  if (gtDone) {
    return {
      finalCompleted: true,
      uncheckNewerInGoogle: false,
      needsPushCompletedToGoogleTask: false,
    };
  }

  const dbDone = evHasCheckmark || evDone || tkDone || scDone;
  if (!dbDone) {
    return {
      finalCompleted: false,
      uncheckNewerInGoogle: false,
      needsPushCompletedToGoogleTask: false,
    };
  }

  const dbMaxUpdatedMs = Math.max(
    evDone ? parseIsoMs(existingEv?.updated_at) : 0,
    tkDone ? parseIsoMs(matchedTask?.updated_at) : 0,
    scDone ? parseIsoMs(matchedSchool?.updated_at) : 0
  );
  const gtUpdatedMs = matchedGTask
    ? parseIsoMs(matchedGTask.item.completed || matchedGTask.item.updated)
    : 0;

  // Only treat Google Tasks `needsAction` as an intentional external uncheck if Google Tasks
  // was updated strictly AFTER (> 5s) the latest completion timestamp in Supabase.
  if (matchedGTask && dbMaxUpdatedMs > 0 && gtUpdatedMs > dbMaxUpdatedMs + 5000) {
    return {
      finalCompleted: false,
      uncheckNewerInGoogle: true,
      needsPushCompletedToGoogleTask: false,
    };
  }

  return {
    finalCompleted: true,
    uncheckNewerInGoogle: false,
    needsPushCompletedToGoogleTask: Boolean(matchedGTask?.item?.id),
  };
}

export async function GET() {
  const syncStartedAtIso = new Date().toISOString();
  const syncStartedAtMs = parseIsoMs(syncStartedAtIso);

  const completedTitles: string[] = [];
  const completedTitleSet = new Set<string>();
  const completedCleanTitles = new Set<string>();
  const addCompletedTitle = (title?: string | null) => {
    const trimmed = title?.trim();
    if (!trimmed) return;
    if (!completedTitleSet.has(trimmed)) {
      completedTitleSet.add(trimmed);
      completedTitles.push(trimmed);
    }
    const clean = cleanTaskTitle(trimmed);
    if (clean) completedCleanTitles.add(clean);
  };

  const syncResults = {
    calendarEventsSynced: 0,
    tasksSynced: 0,
    aiRolloverRescheduled: 0,
    errors: [] as string[],
  };
  const sb = supabaseAdmin || supabase;
  const todayStr = getTodayDateStr();

  // Track which tasks had their due_date updated via Google Calendar event move or rollover
  const calendarMovedTaskIds = new Set<string>();
  const claimedTaskIdsInCalendarPass = new Set<string>();
  const mutatedDuringSyncRowIds = new Set<string>();
  const mutatedDuringSyncSchoolUids = new Set<string>();

  const calendarApi = getGoogleCalendarClient();
  const { tasksApi, hasCredentials, clientId, clientSecret, refreshToken } = await getGoogleTasksClientAsync();

  // Upfront / refreshable state from Supabase and Google Tasks
  let allSchoolRows: PreCleanedSchoolRow[] = [];
  let allDbTasks: PreCleanedTaskRow[] = [];
  let allDbEvents: PreCleanedEventRow[] = [];
  const eventsByCalEventId = new Map<string, PreCleanedEventRow[]>();
  const tasksByGoogleId = new Map<string, PreCleanedTaskRow>();
  const tasksByCalEventId = new Map<string, PreCleanedTaskRow>();

  const prefetchedTasklists = new Map<string, tasks_v1.Schema$Task[]>();
  const gTaskById = new Map<string, IndexedGTask>();
  let indexedGTasks: IndexedGTask[] = [];

  const findMatchingGTask = (
    googleTaskId?: string | null,
    cleanTitle?: string,
    preferredCalName?: string
  ): IndexedGTask | undefined => {
    if (googleTaskId) {
      const byId = gTaskById.get(googleTaskId);
      if (byId) return byId;
    }
    if (!cleanTitle) return undefined;
    if (preferredCalName) {
      const sameCal = indexedGTasks.find(
        (g) => g.calName === preferredCalName && titlesMatchClean(g.clean, cleanTitle)
      );
      if (sameCal) return sameCal;
    }
    return indexedGTasks.find((g) => titlesMatchClean(g.clean, cleanTitle));
  };

  const loadSyncStateFromSources = async (isPostAiRefresh: boolean) => {
    await Promise.all([
      // 1. Fetch Supabase tables in parallel
      (async () => {
        if (!sb) return;
        const [schoolRes, tasksRes, eventsRes] = await Promise.all([
          sb
            .from('school_items')
            .select(
              'uid, title, is_completed, is_scheduled, scheduled_date, scheduled_time, duration_mins, target_calendar, updated_at'
            ),
          sb
            .from('tasks')
            .select(
              'id, title, due_date, due_time, duration_mins, google_task_id, calendar_event_id, calendar_name, is_completed, is_scheduled, updated_at'
            )
            .eq('type', 'Task'),
          sb
            .from('tasks')
            .select(
              'id, title, calendar_name, due_date, due_time, duration_mins, location, notes, calendar_event_id, google_task_id, is_completed, updated_at'
            )
            .eq('type', 'Event')
            .order('created_at', { ascending: false }),
        ]);

        if (schoolRes.data) {
          allSchoolRows = schoolRes.data
            .filter((r) => r.uid && !String(r.uid).startsWith('__system_'))
            .map((r) => {
              const row: PreCleanedSchoolRow = {
                uid: r.uid,
                title: r.title || '',
                clean: cleanTaskTitle(r.title),
                is_completed: Boolean(r.is_completed),
                is_scheduled: Boolean(r.is_scheduled),
                scheduled_date: r.scheduled_date,
                scheduled_time: r.scheduled_time,
                duration_mins: r.duration_mins,
                target_calendar: r.target_calendar,
                updated_at: r.updated_at || null,
              };
              if (row.is_completed) addCompletedTitle(row.title);
              if (isPostAiRefresh && parseIsoMs(row.updated_at) > syncStartedAtMs) {
                mutatedDuringSyncSchoolUids.add(row.uid);
              }
              return row;
            });
        }

        if (tasksRes.data) {
          tasksByGoogleId.clear();
          tasksByCalEventId.clear();
          allDbTasks = tasksRes.data.map((t) => {
            const row: PreCleanedTaskRow = {
              id: t.id,
              title: t.title || '',
              clean: cleanTaskTitle(t.title),
              due_date: t.due_date || '',
              due_time: t.due_time || '',
              duration_mins: t.duration_mins || 0,
              google_task_id: t.google_task_id || null,
              calendar_event_id: t.calendar_event_id || null,
              calendar_name: t.calendar_name || 'School',
              is_completed: Boolean(t.is_completed),
              is_scheduled: Boolean(t.is_scheduled),
              updated_at: t.updated_at || null,
            };
            if (row.is_completed) addCompletedTitle(row.title);
            if (isPostAiRefresh && parseIsoMs(row.updated_at) > syncStartedAtMs) {
              mutatedDuringSyncRowIds.add(row.id);
            }
            if (row.google_task_id && !tasksByGoogleId.has(row.google_task_id)) {
              tasksByGoogleId.set(row.google_task_id, row);
            }
            if (row.calendar_event_id && !tasksByCalEventId.has(row.calendar_event_id)) {
              tasksByCalEventId.set(row.calendar_event_id, row);
            }
            return row;
          });
        }

        if (eventsRes.data) {
          eventsByCalEventId.clear();
          allDbEvents = eventsRes.data.map((e) => {
            const row: PreCleanedEventRow = {
              id: e.id,
              title: e.title || '',
              clean: cleanTaskTitle(e.title),
              calendar_name: e.calendar_name || 'Kevin Nguyen',
              due_date: e.due_date || '',
              due_time: e.due_time || '',
              duration_mins: e.duration_mins || 30,
              location: e.location || '',
              notes: e.notes || '',
              calendar_event_id: e.calendar_event_id || null,
              google_task_id: e.google_task_id || null,
              is_completed: Boolean(e.is_completed),
              updated_at: e.updated_at || null,
            };
            if (row.is_completed && isTaskEventTitle(row.title)) {
              addCompletedTitle(row.title);
            }
            if (isPostAiRefresh && parseIsoMs(row.updated_at) > syncStartedAtMs) {
              mutatedDuringSyncRowIds.add(row.id);
            }
            if (row.calendar_event_id) {
              const list = eventsByCalEventId.get(row.calendar_event_id) || [];
              list.push(row);
              eventsByCalEventId.set(row.calendar_event_id, list);
            }
            return row;
          });
        }
      })(),

      // 2. Fetch all 4 Google Tasklists in parallel with full pagination
      (async () => {
        if (!tasksApi || !hasCredentials) return;
        const freshLists = await Promise.all(
          Object.entries(TASKLIST_MAP).map(async ([calName, listId]) => {
            try {
              const items = await listAllGoogleTasks(tasksApi, listId);
              return { calName, listId, items, ok: true };
            } catch (err: unknown) {
              if (!isPostAiRefresh) {
                const msg = err instanceof Error ? err.message : String(err);
                syncResults.errors.push(`Tasklist ${calName} (${listId}): ${msg}`);
              }
              return { calName, listId, items: prefetchedTasklists.get(calName) || [], ok: false };
            }
          })
        );

        gTaskById.clear();
        indexedGTasks = [];
        for (const { calName, listId, items } of freshLists) {
          prefetchedTasklists.set(calName, items);
          for (const item of items) {
            if (!item.title) continue;
            const entry: IndexedGTask = {
              calName,
              listId,
              item,
              clean: cleanTaskTitle(item.title),
            };
            indexedGTasks.push(entry);
            if (item.id && !gTaskById.has(item.id)) {
              gTaskById.set(item.id, entry);
            }
            if (item.status === 'completed') {
              addCompletedTitle(item.title);
            }
          }
        }
      })(),
    ]);
  };

  await loadSyncStateFromSources(false);

  // 1. Sync Google Calendar Events (-7 days to +30 days)
  try {
    if (calendarApi) {
      const now = new Date();
      const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Fetch all 4 calendars in parallel
      const calendarResponses = await Promise.all(
        Object.entries(CALENDAR_MAP).map(async ([calName, calId]) => {
          try {
            const res = await calendarApi.events.list({
              calendarId: calId,
              timeMin,
              timeMax,
              singleEvents: true,
              orderBy: 'startTime',
              maxResults: 150,
            });
            return { calName, calId, events: res.data.items || [] };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            syncResults.errors.push(`Calendar ${calName}: ${msg}`);
            return { calName, calId, events: [] };
          }
        })
      );

      const duplicateEventIdsToDelete: string[] = [];

      // Pre-pass: Collect all busy intervals on todayStr and all past incomplete task timeblocks to roll over via AI
      const todayBusyBlocks: BusyInterval[] = [];
      const rolloverCandidates: RolloverTaskCandidate[] = [];

      for (const { calName, events } of calendarResponses) {
        for (const ev of events) {
          if (!ev.summary || !ev.id || !ev.start?.dateTime) continue;

          const start = new Date(ev.start.dateTime);
          const evDateStr = start.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
          const evTimeStr = start.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/New_York',
          });

          let evDurationMins = 60;
          if (ev.end?.dateTime) {
            const end = new Date(ev.end.dateTime);
            evDurationMins = Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000));
          }

          const { hours, minutes } = parseTimeToHoursMinutes(evTimeStr);
          const startMins = hours * 60 + minutes;
          const endMins = startMins + evDurationMins;

          const cleanEvTitle = cleanTaskTitle(ev.summary);
          const isTaskBlock = isTaskEventTitle(ev.summary);

          // Check whether this item is already marked completed across DB, School Sync, Calendar prefix, or Google Tasks
          const existingEv = eventsByCalEventId.get(ev.id)?.[0];
          const matchedTk =
            tasksByCalEventId.get(ev.id) ||
            (isTaskBlock && cleanEvTitle
              ? allDbTasks.find(
                  (tk) =>
                    (!tk.calendar_event_id || tk.calendar_event_id === ev.id) &&
                    titlesMatchClean(tk.clean, cleanEvTitle)
                )
              : undefined);
          const matchedSchool =
            isTaskBlock && cleanEvTitle
              ? allSchoolRows.find((s) => titlesMatchClean(s.clean, cleanEvTitle))
              : undefined;
          const matchedGTask = isTaskBlock
            ? findMatchingGTask(
                matchedTk?.google_task_id || existingEv?.google_task_id,
                cleanEvTitle,
                calName
              )
            : undefined;

          const isCompleted = isTaskBlock
            ? resolveTaskCompletion({
                existingEv,
                matchedTask: matchedTk,
                matchedSchool,
                matchedGTask,
                evSummary: ev.summary,
              }).finalCompleted
            : Boolean(existingEv?.is_completed) ||
              Boolean(matchedTk?.is_completed) ||
              isCompletedCalendarTitle(ev.summary);

          if (evDateStr === todayStr && !isCompleted) {
            const endH = Math.floor((endMins % 1440) / 60);
            const endM = endMins % 60;
            todayBusyBlocks.push({
              id: ev.id,
              title: ev.summary,
              calendar: calName,
              startMins,
              endMins,
              startTime12h: evTimeStr,
              endTime12h: format24hTo12h(endH, endM),
            });
          } else if (isTaskBlock && !isCompleted && evDateStr < todayStr) {
            const predeterminedDuration =
              evDurationMins ||
              matchedTk?.duration_mins ||
              matchedSchool?.duration_mins ||
              30;

            rolloverCandidates.push({
              id: ev.id,
              title: cleanEvTitle || ev.summary,
              calendar: calName,
              durationMins: predeterminedDuration,
              preferredTimeStr: evTimeStr,
            });
          }
        }
      }

      // If any incomplete online modules / task timeblocks need to roll over from past days to todayStr,
      // use the AI Rollover Scheduler to place each into an empty timeblock on todayStr that fits its duration
      let rolloverSlotMap = new Map<string, AssignedRolloverSlot>();
      if (rolloverCandidates.length > 0) {
        rolloverSlotMap = await planRolloverTimeSlotsWithAI(
          todayStr,
          todayBusyBlocks,
          rolloverCandidates
        );

        // Post-AI Live Freshness Refresh: if the user completed any task while Gemini was thinking,
        // re-fetch live DB + Google Tasks state and cancel stale rollovers immediately.
        await loadSyncStateFromSources(true);
      }

      for (const { calName, calId, events } of calendarResponses) {
        for (const ev of events) {
          if (!ev.summary || !ev.id) continue;

          let dateStr = '';
          let timeStr = 'All Day';
          let durationMins = 60;

          if (ev.start?.dateTime) {
            const start = new Date(ev.start.dateTime);
            dateStr = start.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            timeStr = start.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: 'America/New_York',
            });

            if (ev.end?.dateTime) {
              const end = new Date(ev.end.dateTime);
              durationMins = Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000));
            }
          } else if (ev.start?.date) {
            dateStr = ev.start.date;
          }

          if (!dateStr) continue;

          if (sb) {
            const cleanEvTitle = cleanTaskTitle(ev.summary);
            const isTaskBlock = isTaskEventTitle(ev.summary);

            // Find matching Task row in memory (only for task timeblocks or explicitly linked events)
            let matchedTask = tasksByCalEventId.get(ev.id);
            if (!matchedTask && isTaskBlock && cleanEvTitle) {
              matchedTask = allDbTasks.find(
                (tk) =>
                  !claimedTaskIdsInCalendarPass.has(tk.id) &&
                  (!tk.calendar_event_id || tk.calendar_event_id === ev.id) &&
                  titlesMatchClean(tk.clean, cleanEvTitle)
              );
            }
            if (matchedTask) {
              claimedTaskIdsInCalendarPass.add(matchedTask.id);
            }

            const existingRows = eventsByCalEventId.get(ev.id) || [];
            const existing = existingRows[0];

            if (existingRows.length > 1) {
              for (let i = 1; i < existingRows.length; i++) {
                duplicateEventIdsToDelete.push(existingRows[i].id);
              }
            }

            const matchedSchoolRows =
              isTaskBlock && cleanEvTitle && allSchoolRows.length > 0
                ? allSchoolRows.filter((row) => titlesMatchClean(row.clean, cleanEvTitle))
                : [];
            const primarySchool = matchedSchoolRows[0];

            const matchedGTask = isTaskBlock
              ? findMatchingGTask(
                  matchedTask?.google_task_id || existing?.google_task_id,
                  cleanEvTitle,
                  calName
                )
              : undefined;

            // Populate missing google_task_id link from prefetched Google Tasklists
            if (matchedTask && !matchedTask.google_task_id && matchedGTask?.item?.id) {
              matchedTask.google_task_id = matchedGTask.item.id;
              tasksByGoogleId.set(matchedGTask.item.id, matchedTask);
            }

            const completionResolution = isTaskBlock
              ? resolveTaskCompletion({
                  existingEv: existing,
                  matchedTask,
                  matchedSchool: primarySchool,
                  matchedGTask,
                  evSummary: ev.summary,
                })
              : {
                  finalCompleted:
                    isEventPast(dateStr, timeStr === 'All Day' ? '' : timeStr, durationMins) ||
                    Boolean(existing?.is_completed) ||
                    Boolean(matchedTask?.is_completed) ||
                    isCompletedCalendarTitle(ev.summary),
                  uncheckNewerInGoogle: false,
                  needsPushCompletedToGoogleTask: false,
                };

            let { finalCompleted, uncheckNewerInGoogle, needsPushCompletedToGoogleTask } =
              completionResolution;

            // Auto-rollover incomplete task timeblocks from past dates to todayStr using AI empty-slot scheduling
            let wasRolledOverFromPast = false;
            let rolloverStartIso: string | null = null;
            let rolloverEndIso: string | null = null;

            if (isTaskBlock && !finalCompleted && dateStr < todayStr) {
              // Live last-millisecond guard right before touching Google Calendar for rollover:
              // If the user ticked this task off during AI planning or earlier rollover patches, abort rollover!
              let completedInFlight = false;
              try {
                const liveChecks = await Promise.all([
                  sb
                    .from('tasks')
                    .select('id, is_completed')
                    .or(
                      matchedTask?.id
                        ? `calendar_event_id.eq.${ev.id},id.eq.${matchedTask.id}`
                        : `calendar_event_id.eq.${ev.id}`
                    ),
                  primarySchool
                    ? sb.from('school_items').select('uid, is_completed').eq('uid', primarySchool.uid)
                    : Promise.resolve({ data: null }),
                  tasksApi && matchedGTask?.item?.id
                    ? tasksApi.tasks
                        .get({ tasklist: matchedGTask.listId, task: matchedGTask.item.id })
                        .catch(() => null)
                    : Promise.resolve(null),
                ]);

                const liveTasks = liveChecks[0]?.data || [];
                const liveSchool = liveChecks[1]?.data || [];
                const liveGTask = liveChecks[2]?.data;

                if (
                  liveTasks.some((r) => r.is_completed) ||
                  liveSchool.some((r) => r.is_completed) ||
                  liveGTask?.status === 'completed'
                ) {
                  completedInFlight = true;
                  finalCompleted = true;
                  uncheckNewerInGoogle = false;
                  needsPushCompletedToGoogleTask = Boolean(
                    matchedGTask?.item?.id && liveGTask?.status !== 'completed'
                  );
                  if (matchedGTask && liveGTask?.status === 'completed') {
                    matchedGTask.item.status = 'completed';
                  }
                }
              } catch {
                // Fall through with existing state on transient check error
              }

              if (!completedInFlight) {
                wasRolledOverFromPast = true;
                dateStr = todayStr;
                const aiSlot = rolloverSlotMap.get(ev.id);
                if (aiSlot) {
                  timeStr = aiSlot.startTime12h;
                  durationMins = aiSlot.durationMins;
                  syncResults.aiRolloverRescheduled++;
                }

                if (ev.start?.dateTime && timeStr !== 'All Day') {
                  const computed = computeStartEndIso(todayStr, timeStr, durationMins);
                  rolloverStartIso = computed.startDateTime;
                  rolloverEndIso = computed.endDateTime;
                }
              }
            }

            // Sync Google Calendar summary prefix ("✅ [Task]" when done vs "🎓 [Task]" when active) and/or rollover slot
            const expectedSummary = isTaskBlock
              ? formatCompletedCalendarSummary(ev.summary, finalCompleted)
              : ev.summary;
            const summaryChanged = isTaskBlock && expectedSummary !== ev.summary;
            const hasRolloverPatch = Boolean(rolloverStartIso && rolloverEndIso);

            if (hasRolloverPatch || summaryChanged) {
              try {
                const patchBody: Record<string, unknown> = {};
                if (hasRolloverPatch && rolloverStartIso && rolloverEndIso) {
                  patchBody.start = { dateTime: rolloverStartIso, timeZone: 'America/New_York' };
                  patchBody.end = { dateTime: rolloverEndIso, timeZone: 'America/New_York' };
                }
                if (summaryChanged) {
                  patchBody.summary = expectedSummary;
                }
                await calendarApi.events.patch({
                  calendarId: calId,
                  eventId: ev.id,
                  requestBody: patchBody,
                });
                if (summaryChanged) {
                  ev.summary = expectedSummary;
                }
              } catch (calPatchErr) {
                console.warn('Failed to patch Google Calendar task block:', calPatchErr);
              }
            }

            // If DB/School/Calendar says completed while Google Tasks says needsAction (and not externally unchecked), push completion to Google Tasks
            if (needsPushCompletedToGoogleTask && tasksApi && matchedGTask?.item?.id) {
              try {
                await tasksApi.tasks.patch({
                  tasklist: matchedGTask.listId,
                  task: matchedGTask.item.id,
                  requestBody: {
                    status: 'completed',
                    completed: new Date().toISOString(),
                  },
                });
                matchedGTask.item.status = 'completed';
                matchedGTask.item.completed = new Date().toISOString();
              } catch (pushErr) {
                console.warn('Failed to push completion to Google Tasks:', pushErr);
              }
            }

            if (finalCompleted && isTaskBlock) {
              addCompletedTitle(ev.summary);
            }

            // Ensure a companion Task row exists for every Task timeblock
            const effectiveEvTime = timeStr === 'All Day' ? '' : timeStr;
            if (isTaskBlock && !matchedTask) {
              const cleanTaskSummary = stripTaskEventPrefix(ev.summary);
              const { data: insertedTask } = await sb
                .from('tasks')
                .insert({
                  title: cleanTaskSummary || ev.summary,
                  type: 'Task',
                  calendar_name: calName,
                  due_date: dateStr,
                  due_time: effectiveEvTime,
                  duration_mins: durationMins,
                  location: ev.location || '',
                  notes: ev.description || '',
                  calendar_event_id: ev.id,
                  google_task_id: matchedGTask?.item?.id || existing?.google_task_id || null,
                  is_completed: finalCompleted,
                  is_scheduled: true,
                })
                .select(
                  'id, title, due_date, due_time, duration_mins, google_task_id, calendar_event_id, calendar_name, is_completed, updated_at'
                )
                .single();

              if (insertedTask) {
                const newTaskRow: PreCleanedTaskRow = {
                  id: insertedTask.id,
                  title: insertedTask.title || '',
                  clean: cleanTaskTitle(insertedTask.title),
                  due_date: insertedTask.due_date || dateStr,
                  due_time: insertedTask.due_time || '',
                  duration_mins: insertedTask.duration_mins || durationMins,
                  google_task_id: insertedTask.google_task_id || null,
                  calendar_event_id: insertedTask.calendar_event_id || ev.id,
                  calendar_name: insertedTask.calendar_name || calName,
                  is_completed: Boolean(insertedTask.is_completed),
                  is_scheduled: true,
                  updated_at: insertedTask.updated_at || null,
                };
                matchedTask = newTaskRow;
                allDbTasks.push(newTaskRow);
                tasksByCalEventId.set(ev.id, newTaskRow);
                claimedTaskIdsInCalendarPass.add(newTaskRow.id);
              }
            }

            const resolvedGoogleTaskId =
              matchedTask?.google_task_id || matchedGTask?.item?.id || existing?.google_task_id || null;
            const evLocation = ev.location || '';
            const evNotes = ev.description || '';

            if (existing) {
              const eventChanged =
                existing.title !== ev.summary ||
                existing.calendar_name !== calName ||
                existing.due_date !== dateStr ||
                existing.due_time !== effectiveEvTime ||
                existing.duration_mins !== durationMins ||
                existing.location !== evLocation ||
                existing.notes !== evNotes ||
                existing.google_task_id !== resolvedGoogleTaskId ||
                existing.is_completed !== finalCompleted;

              if (eventChanged) {
                const nowIso = new Date().toISOString();
                await sb
                  .from('tasks')
                  .update({
                    title: ev.summary,
                    type: 'Event',
                    calendar_name: calName,
                    due_date: dateStr,
                    due_time: effectiveEvTime,
                    duration_mins: durationMins,
                    location: evLocation,
                    notes: evNotes,
                    calendar_event_id: ev.id,
                    google_task_id: resolvedGoogleTaskId,
                    is_completed: finalCompleted,
                    is_scheduled: true,
                    updated_at: nowIso,
                  })
                  .eq('id', existing.id);

                existing.title = ev.summary;
                existing.calendar_name = calName;
                existing.due_date = dateStr;
                existing.due_time = effectiveEvTime;
                existing.duration_mins = durationMins;
                existing.location = evLocation;
                existing.notes = evNotes;
                existing.google_task_id = resolvedGoogleTaskId;
                existing.is_completed = finalCompleted;
                existing.updated_at = nowIso;
              }
            } else {
              const insertPayload = {
                title: ev.summary,
                type: 'Event',
                calendar_name: calName,
                due_date: dateStr,
                due_time: effectiveEvTime,
                duration_mins: durationMins,
                location: evLocation,
                notes: evNotes,
                calendar_event_id: ev.id,
                google_task_id: resolvedGoogleTaskId,
                is_completed: finalCompleted,
                is_scheduled: true,
              };
              const { data: insertedEv } = await sb
                .from('tasks')
                .insert(insertPayload)
                .select('id, updated_at')
                .single();
              if (insertedEv) {
                const newEvRow: PreCleanedEventRow = {
                  id: insertedEv.id,
                  title: ev.summary,
                  clean: cleanEvTitle,
                  calendar_name: calName,
                  due_date: dateStr,
                  due_time: effectiveEvTime,
                  duration_mins: durationMins,
                  location: evLocation,
                  notes: evNotes,
                  calendar_event_id: ev.id,
                  google_task_id: resolvedGoogleTaskId,
                  is_completed: finalCompleted,
                  updated_at: insertedEv.updated_at || null,
                };
                allDbEvents.push(newEvRow);
                eventsByCalEventId.set(ev.id, [newEvRow]);
              }
            }

            // Two-Way Calendar -> Task Sync (only write when changed, and never patch due/notes on completed tasks)
            if (matchedTask) {
              const nextTaskDueTime = effectiveEvTime || matchedTask.due_time || '';
              const nextTaskGoogleId = matchedTask.google_task_id || resolvedGoogleTaskId;
              const dateOrTimeChanged =
                wasRolledOverFromPast ||
                matchedTask.due_date !== dateStr ||
                (effectiveEvTime && matchedTask.due_time !== effectiveEvTime) ||
                matchedTask.duration_mins !== durationMins;

              const taskChanged =
                matchedTask.due_date !== dateStr ||
                matchedTask.due_time !== nextTaskDueTime ||
                matchedTask.duration_mins !== durationMins ||
                matchedTask.calendar_event_id !== ev.id ||
                matchedTask.google_task_id !== nextTaskGoogleId ||
                matchedTask.calendar_name !== calName ||
                matchedTask.is_completed !== finalCompleted ||
                !matchedTask.is_scheduled;

              if (taskChanged) {
                const nowIso = new Date().toISOString();
                await sb
                  .from('tasks')
                  .update({
                    due_date: dateStr,
                    due_time: nextTaskDueTime,
                    duration_mins: durationMins,
                    calendar_event_id: ev.id,
                    google_task_id: nextTaskGoogleId,
                    calendar_name: calName,
                    is_completed: finalCompleted,
                    is_scheduled: true,
                    updated_at: nowIso,
                  })
                  .eq('id', matchedTask.id);

                matchedTask.due_date = dateStr;
                matchedTask.due_time = nextTaskDueTime;
                matchedTask.duration_mins = durationMins;
                matchedTask.calendar_event_id = ev.id;
                matchedTask.google_task_id = nextTaskGoogleId;
                matchedTask.calendar_name = calName;
                matchedTask.is_completed = finalCompleted;
                matchedTask.is_scheduled = true;
                matchedTask.updated_at = nowIso;
              }

              calendarMovedTaskIds.add(matchedTask.id);
              if (nextTaskGoogleId) {
                calendarMovedTaskIds.add(nextTaskGoogleId);
              }

              // Patch Google Task due date & scheduled tag ONLY for incomplete tasks whose schedule actually changed
              if (!finalCompleted && dateOrTimeChanged && tasksApi && nextTaskGoogleId) {
                const targetTaskLists = Array.from(
                  new Set([
                    TASKLIST_MAP[calName] || '@default',
                    TASKLIST_MAP[matchedTask.calendar_name || 'School'] || '@default',
                    ...Object.values(TASKLIST_MAP),
                  ])
                );

                for (const tListId of targetTaskLists) {
                  try {
                    const existingGTask = matchedGTask?.listId === tListId
                      ? { data: matchedGTask.item }
                      : await tasksApi.tasks.get({
                          tasklist: tListId,
                          task: nextTaskGoogleId,
                        });
                    if (existingGTask.data) {
                      const updatedNotes = buildScheduledNotesTag(
                        existingGTask.data.notes,
                        dateStr,
                        effectiveEvTime,
                        durationMins
                      );
                      const currentDueDate = existingGTask.data.due?.split('T')[0] || '';
                      if (
                        currentDueDate !== dateStr ||
                        (existingGTask.data.notes || '') !== updatedNotes
                      ) {
                        await tasksApi.tasks.patch({
                          tasklist: tListId,
                          task: nextTaskGoogleId,
                          requestBody: {
                            due: `${dateStr}T00:00:00.000Z`,
                            notes: updatedNotes,
                          },
                        });
                      }
                      break;
                    }
                  } catch {
                    // Try next tasklist
                  }
                }
              }
            }

            // Sync matching school_items in memory (only update rows that actually changed)
            if (matchedSchoolRows.length > 0) {
              const nextSchedTime = timeStr === 'All Day' ? '10:00 AM' : timeStr;
              const rowsToUpdate = matchedSchoolRows.filter(
                (row) =>
                  !row.is_scheduled ||
                  row.scheduled_date !== dateStr ||
                  row.scheduled_time !== nextSchedTime ||
                  row.duration_mins !== durationMins ||
                  row.target_calendar !== calName ||
                  (finalCompleted && !row.is_completed) ||
                  (uncheckNewerInGoogle && row.is_completed)
              );

              if (rowsToUpdate.length > 0) {
                const nowIso = new Date().toISOString();
                const scheduleOnlyUids: string[] = [];
                const scheduleAndDoneUids: string[] = [];
                const scheduleAndUndoneUids: string[] = [];

                for (const row of rowsToUpdate) {
                  row.is_scheduled = true;
                  row.scheduled_date = dateStr;
                  row.scheduled_time = nextSchedTime;
                  row.duration_mins = durationMins;
                  row.target_calendar = calName;

                  if (finalCompleted && !row.is_completed) {
                    row.is_completed = true;
                    row.updated_at = nowIso;
                    scheduleAndDoneUids.push(row.uid);
                  } else if (uncheckNewerInGoogle && row.is_completed) {
                    row.is_completed = false;
                    row.updated_at = nowIso;
                    scheduleAndUndoneUids.push(row.uid);
                  } else {
                    scheduleOnlyUids.push(row.uid);
                  }
                }

                const basePayload = {
                  is_scheduled: true,
                  scheduled_date: dateStr,
                  scheduled_time: nextSchedTime,
                  duration_mins: durationMins,
                  target_calendar: calName,
                  updated_at: nowIso,
                };

                await Promise.all([
                  scheduleOnlyUids.length > 0
                    ? sb.from('school_items').update(basePayload).in('uid', scheduleOnlyUids)
                    : Promise.resolve(),
                  scheduleAndDoneUids.length > 0
                    ? sb
                        .from('school_items')
                        .update({ ...basePayload, is_completed: true })
                        .in('uid', scheduleAndDoneUids)
                    : Promise.resolve(),
                  scheduleAndUndoneUids.length > 0
                    ? sb
                        .from('school_items')
                        .update({ ...basePayload, is_completed: false })
                        .in('uid', scheduleAndUndoneUids)
                    : Promise.resolve(),
                ]);
              }
            }

            syncResults.calendarEventsSynced++;
          }
        }
      }

      if (sb && duplicateEventIdsToDelete.length > 0) {
        await sb.from('tasks').delete().in('id', duplicateEventIdsToDelete);
      }
    } else {
      syncResults.errors.push('Google Calendar credentials missing');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    syncResults.errors.push(`Calendar sync: ${msg}`);
  }

  // 2. Sync Google Tasks across all prefetched lists
  try {
    if (tasksApi && hasCredentials) {
      for (const [calName, listId] of Object.entries(TASKLIST_MAP)) {
        const items = prefetchedTasklists.get(calName) || [];

        for (const item of items) {
          if (!item.title) continue;
          const taskTitle = item.title.trim();
          if (!taskTitle) continue;

          const cleanTask = cleanTaskTitle(taskTitle);
          const isGoogleDone = item.status === 'completed';

          let existingTask = item.id ? tasksByGoogleId.get(item.id) : undefined;
          if (!existingTask && cleanTask) {
            existingTask = allDbTasks.find(
              (t) => t.title === taskTitle || titlesMatchClean(t.clean, cleanTask)
            );
          }

          const matchedSchoolRows =
            cleanTask && allSchoolRows.length > 0
              ? allSchoolRows.filter((row) => titlesMatchClean(row.clean, cleanTask))
              : [];

          const matchedEvents = allDbEvents.filter(
            (ev) =>
              (item.id && ev.google_task_id === item.id) ||
              (isTaskEventTitle(ev.title) &&
                cleanTask &&
                titlesMatchClean(ev.clean, cleanTask) &&
                (!ev.google_task_id || !item.id || ev.google_task_id === item.id))
          );
          const primaryEvent = matchedEvents[0];

          const completionResolution = resolveTaskCompletion({
            existingEv: primaryEvent,
            matchedTask: existingTask,
            matchedSchool: matchedSchoolRows[0],
            matchedGTask: { calName, listId, item, clean: cleanTask },
            evSummary: primaryEvent?.title,
          });
          const resolvedDone = completionResolution.finalCompleted;

          // If Supabase/Calendar says completed while Google Tasks lags behind, push completion to Google Tasks
          if (completionResolution.needsPushCompletedToGoogleTask && item.id) {
            try {
              const doneIso = new Date().toISOString();
              await tasksApi.tasks.patch({
                tasklist: listId,
                task: item.id,
                requestBody: {
                  status: 'completed',
                  completed: doneIso,
                },
              });
              item.status = 'completed';
              item.completed = doneIso;
            } catch (pushErr) {
              console.warn('Failed to push task completion to Google Tasks:', pushErr);
            }
          }

          if (resolvedDone) {
            addCompletedTitle(taskTitle);
          }

          let dateStr = item.due ? item.due.split('T')[0] : '';

          // Auto-rollover incomplete tasks from past dates to todayStr (NEVER roll over completed tasks)
          if (!resolvedDone && !isGoogleDone && (!dateStr || dateStr < todayStr)) {
            const wasOverdueInGoogle = Boolean(dateStr && dateStr < todayStr);
            dateStr = todayStr;
            if (wasOverdueInGoogle && item.id) {
              try {
                await tasksApi.tasks.patch({
                  tasklist: listId,
                  task: item.id,
                  requestBody: {
                    due: `${todayStr}T00:00:00.000Z`,
                  },
                });
              } catch (rollTaskErr) {
                console.warn('Failed to roll over Google Task due date to today:', rollTaskErr);
              }
            }
          }

          if (sb) {
            // 1. Sync matching school_items only when completion differs
            if (matchedSchoolRows.length > 0) {
              if (resolvedDone) {
                const schoolUidsToDone = matchedSchoolRows
                  .filter((r) => !r.is_completed && !mutatedDuringSyncSchoolUids.has(r.uid))
                  .map((r) => {
                    r.is_completed = true;
                    return r.uid;
                  });
                if (schoolUidsToDone.length > 0) {
                  await sb
                    .from('school_items')
                    .update({ is_completed: true, updated_at: new Date().toISOString() })
                    .in('uid', schoolUidsToDone);
                }
              } else if (completionResolution.uncheckNewerInGoogle) {
                const schoolUidsToUndo = matchedSchoolRows
                  .filter((r) => r.is_completed && !mutatedDuringSyncSchoolUids.has(r.uid))
                  .map((r) => {
                    r.is_completed = false;
                    return r.uid;
                  });
                if (schoolUidsToUndo.length > 0) {
                  await sb
                    .from('school_items')
                    .update({ is_completed: false, updated_at: new Date().toISOString() })
                    .in('uid', schoolUidsToUndo);
                }
              }
            }

            // 2. Update or insert Supabase Task row ONLY if changed (avoid no-op writes!)
            if (existingTask) {
              const isMovedByCalendar =
                calendarMovedTaskIds.has(existingTask.id) ||
                (item.id ? calendarMovedTaskIds.has(item.id) : false);

              const nextDueDate =
                !isMovedByCalendar && dateStr ? dateStr : existingTask.due_date;
              const nextGoogleId = item.id || existingTask.google_task_id || null;
              const allowCompletionChange = !mutatedDuringSyncRowIds.has(existingTask.id);
              const nextCompleted = allowCompletionChange
                ? resolvedDone
                : existingTask.is_completed;

              const taskChanged =
                existingTask.title !== taskTitle ||
                existingTask.calendar_name !== calName ||
                existingTask.is_completed !== nextCompleted ||
                existingTask.google_task_id !== nextGoogleId ||
                existingTask.due_date !== nextDueDate;

              if (taskChanged) {
                const nowIso = new Date().toISOString();
                const taskUpdatePayload: Record<string, unknown> = {
                  title: taskTitle,
                  type: 'Task',
                  calendar_name: calName,
                  is_completed: nextCompleted,
                  google_task_id: nextGoogleId,
                  updated_at: nowIso,
                };
                if (!isMovedByCalendar && dateStr) {
                  taskUpdatePayload.due_date = dateStr;
                }

                await sb.from('tasks').update(taskUpdatePayload).eq('id', existingTask.id);
                existingTask.title = taskTitle;
                existingTask.calendar_name = calName;
                existingTask.is_completed = nextCompleted;
                existingTask.due_date = nextDueDate;
                existingTask.updated_at = nowIso;
                if (item.id) {
                  existingTask.google_task_id = item.id;
                  tasksByGoogleId.set(item.id, existingTask);
                }
              } else if (item.id && !tasksByGoogleId.has(item.id)) {
                tasksByGoogleId.set(item.id, existingTask);
              }

              if (item.id && nextCompleted) {
                const staleSiblingIds = allDbTasks
                  .filter(
                    (t) =>
                      t.id !== existingTask?.id &&
                      t.google_task_id === item.id &&
                      !t.is_completed
                  )
                  .map((t) => {
                    t.is_completed = true;
                    return t.id;
                  });
                if (staleSiblingIds.length > 0) {
                  await sb
                    .from('tasks')
                    .update({
                      is_completed: true,
                      updated_at: new Date().toISOString(),
                    })
                    .in('id', staleSiblingIds);
                }
              }
            } else {
              const { data: inserted } = await sb
                .from('tasks')
                .insert({
                  title: taskTitle,
                  type: 'Task',
                  calendar_name: calName,
                  due_date: dateStr || todayStr,
                  due_time: '',
                  duration_mins: 0,
                  notes: item.notes || '',
                  google_task_id: item.id,
                  is_completed: resolvedDone,
                  is_scheduled: false,
                })
                .select('id, updated_at')
                .single();

              if (inserted) {
                const newRow: PreCleanedTaskRow = {
                  id: inserted.id,
                  title: taskTitle,
                  clean: cleanTask,
                  due_date: dateStr || todayStr,
                  due_time: '',
                  duration_mins: 0,
                  google_task_id: item.id || null,
                  calendar_event_id: null,
                  calendar_name: calName,
                  is_completed: resolvedDone,
                  is_scheduled: false,
                  updated_at: inserted.updated_at || null,
                };
                allDbTasks.push(newRow);
                if (item.id) tasksByGoogleId.set(item.id, newRow);
              }
            }

            // 3. Keep matching task timeblock Event rows & Google Calendar summaries in sync
            // (matches regardless of whether Google Task due_date differs from Calendar event date)
            if (resolvedDone && matchedEvents.length > 0) {
              const evsToComplete = matchedEvents.filter(
                (ev) => !ev.is_completed && !mutatedDuringSyncRowIds.has(ev.id)
              );
              const evsNeedingCheckPrefix = matchedEvents.filter(
                (ev) =>
                  ev.calendar_event_id &&
                  isTaskEventTitle(ev.title) &&
                  !isCompletedCalendarTitle(ev.title)
              );

              if (evsToComplete.length > 0) {
                const nowIso = new Date().toISOString();
                await sb
                  .from('tasks')
                  .update({ is_completed: true, updated_at: nowIso })
                  .in(
                    'id',
                    evsToComplete.map((ev) => {
                      ev.is_completed = true;
                      ev.updated_at = nowIso;
                      return ev.id;
                    })
                  );
              }

              if (calendarApi && evsNeedingCheckPrefix.length > 0) {
                for (const ev of evsNeedingCheckPrefix) {
                  if (!ev.calendar_event_id) continue;
                  const targetCalId =
                    CALENDAR_MAP[ev.calendar_name] || CALENDAR_MAP[calName] || CALENDAR_MAP['School'];
                  const nextSummary = formatCompletedCalendarSummary(ev.title, true);
                  if (targetCalId && nextSummary !== ev.title) {
                    try {
                      await calendarApi.events.patch({
                        calendarId: targetCalId,
                        eventId: ev.calendar_event_id,
                        requestBody: { summary: nextSummary },
                      });
                      ev.title = nextSummary;
                      await sb
                        .from('tasks')
                        .update({ title: nextSummary, updated_at: new Date().toISOString() })
                        .eq('id', ev.id);
                    } catch {
                      // Event may live in another calendar or have been deleted
                    }
                  }
                }
              }
            } else if (completionResolution.uncheckNewerInGoogle && matchedEvents.length > 0) {
              const evsToUndo = matchedEvents.filter(
                (ev) => ev.is_completed && !mutatedDuringSyncRowIds.has(ev.id)
              );
              if (evsToUndo.length > 0) {
                const nowIso = new Date().toISOString();
                await sb
                  .from('tasks')
                  .update({ is_completed: false, updated_at: nowIso })
                  .in(
                    'id',
                    evsToUndo.map((ev) => {
                      ev.is_completed = false;
                      ev.updated_at = nowIso;
                      return ev.id;
                    })
                  );
              }
              if (calendarApi) {
                for (const ev of matchedEvents) {
                  if (
                    ev.calendar_event_id &&
                    isTaskEventTitle(ev.title) &&
                    isCompletedCalendarTitle(ev.title)
                  ) {
                    const targetCalId =
                      CALENDAR_MAP[ev.calendar_name] || CALENDAR_MAP[calName] || CALENDAR_MAP['School'];
                    const nextSummary = formatCompletedCalendarSummary(ev.title, false);
                    if (targetCalId && nextSummary !== ev.title) {
                      try {
                        await calendarApi.events.patch({
                          calendarId: targetCalId,
                          eventId: ev.calendar_event_id,
                          requestBody: { summary: nextSummary },
                        });
                        ev.title = nextSummary;
                        await sb
                          .from('tasks')
                          .update({ title: nextSummary, updated_at: new Date().toISOString() })
                          .eq('id', ev.id);
                      } catch {
                        // Ignore
                      }
                    }
                  }
                }
              }
            }

            syncResults.tasksSynced++;
          }
        }
      }

      // 2b. Backfill any active local Supabase Tasks that are missing a google_task_id
      // (e.g. online modules scheduled while the Google Tasks token was expired)
      if (sb && prefetchedTasklists.size > 0) {
        const unsyncedLocalTasks = allDbTasks.filter(
          (t) =>
            !t.is_completed &&
            !t.google_task_id &&
            t.title.trim().length > 0 &&
            !completedCleanTitles.has(t.clean)
        );

        for (const localTask of unsyncedLocalTasks) {
          try {
            // Check if a Google Task with a matching clean title already exists in any prefetched list
            let matchedGoogleTaskId: string | null = null;
            for (const [, gItems] of prefetchedTasklists.entries()) {
              const gMatch = gItems.find(
                (g) => g.title && titlesMatchClean(cleanTaskTitle(g.title), localTask.clean)
              );
              if (gMatch?.id) {
                matchedGoogleTaskId = gMatch.id;
                break;
              }
            }

            if (!matchedGoogleTaskId) {
              const targetListId =
                TASKLIST_MAP[localTask.calendar_name] ||
                TASKLIST_MAP['School'] ||
                TASKLIST_MAP['Kevin Nguyen'];

              const dueDateStr = localTask.due_date || todayStr;
              const notesStr = localTask.due_time
                ? `⏰ Scheduled: ${localTask.due_time} (${localTask.duration_mins || 60}m)`
                : '';

              const createdRes = await tasksApi.tasks.insert({
                tasklist: targetListId,
                requestBody: {
                  title: localTask.title.trim(),
                  due: `${dueDateStr}T00:00:00.000Z`,
                  notes: notesStr,
                },
              });

              matchedGoogleTaskId = createdRes.data.id || null;
              if (matchedGoogleTaskId && createdRes.data) {
                const listItems = prefetchedTasklists.get(localTask.calendar_name || 'School') || [];
                listItems.push(createdRes.data);
              }
            }

            if (matchedGoogleTaskId) {
              localTask.google_task_id = matchedGoogleTaskId;
              tasksByGoogleId.set(matchedGoogleTaskId, localTask);

              await sb
                .from('tasks')
                .update({
                  google_task_id: matchedGoogleTaskId,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', localTask.id);

              if (localTask.calendar_event_id) {
                await sb
                  .from('tasks')
                  .update({
                    google_task_id: matchedGoogleTaskId,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('calendar_event_id', localTask.calendar_event_id)
                  .eq('type', 'Event');
              }

              syncResults.tasksSynced++;
            }
          } catch (backfillErr) {
            console.warn(`Failed to backfill Google Task for "${localTask.title}":`, backfillErr);
          }
        }
      }
    } else {
      syncResults.errors.push(
        `Google Tasks credentials missing (clientId: ${!!clientId}, clientSecret: ${!!clientSecret}, refreshToken: ${!!refreshToken})`
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    syncResults.errors.push(`Google Tasks sync: ${msg}`);
  }

  // 3 & 4. Parallel Sweep & Universal Daily Rollover in Supabase
  if (sb) {
    await Promise.all([
      // 3a. Auto-sweep past standalone events to is_completed = true (never auto-complete task timeblocks)
      (async () => {
        try {
          const { data: activeEvents } = await sb
            .from('tasks')
            .select('id, title, due_date, due_time, duration_mins')
            .eq('type', 'Event')
            .eq('is_completed', false);

          if (activeEvents && activeEvents.length > 0) {
            const pastIds = activeEvents
              .filter((e) => !isTaskEventTitle(e.title) && isEventPast(e.due_date, e.due_time, e.duration_mins))
              .map((e) => e.id);

            if (pastIds.length > 0) {
              await sb
                .from('tasks')
                .update({ is_completed: true, updated_at: new Date().toISOString() })
                .in('id', pastIds);
            }
          }
        } catch (sweepErr) {
          console.warn('Past events sweep error:', sweepErr);
        }
      })(),

      // 3b. Reset any future standalone events that were previously marked completed by mistake
      (async () => {
        try {
          const { data: futureCompletedEvents } = await sb
            .from('tasks')
            .select('id, title, due_date')
            .eq('type', 'Event')
            .eq('is_completed', true)
            .gt('due_date', todayStr);

          if (futureCompletedEvents && futureCompletedEvents.length > 0) {
            const toResetIds = futureCompletedEvents
              .filter((e) => !isTaskEventTitle(e.title))
              .map((e) => e.id);
            if (toResetIds.length > 0) {
              await sb
                .from('tasks')
                .update({ is_completed: false, updated_at: new Date().toISOString() })
                .in('id', toResetIds);
            }
          }
        } catch (resetErr) {
          console.warn('Future events reset error:', resetErr);
        }
      })(),

      // 4a. Universal Daily Rollover: Transfer any incomplete tasks (or task timeblocks) from past days to todayStr
      // (skip any title known to be completed across sibling tables or Google Tasks)
      (async () => {
        try {
          const { data: overdueRows } = await sb
            .from('tasks')
            .select('id, title, type, due_date')
            .eq('is_completed', false)
            .lt('due_date', todayStr);

          if (overdueRows && overdueRows.length > 0) {
            const rolloverIds = overdueRows
              .filter(
                (r) =>
                  (r.type === 'Task' || isTaskEventTitle(r.title)) &&
                  !completedCleanTitles.has(cleanTaskTitle(r.title))
              )
              .map((r) => r.id);

            if (rolloverIds.length > 0) {
              await sb
                .from('tasks')
                .update({
                  due_date: todayStr,
                  updated_at: new Date().toISOString(),
                })
                .in('id', rolloverIds);
            }
          }
        } catch (rolloverErr) {
          console.warn('Universal daily task rollover error:', rolloverErr);
        }
      })(),

      // 4b. Roll over any incomplete scheduled school_items with scheduled_date < todayStr
      (async () => {
        try {
          const { data: overdueSchool } = await sb
            .from('school_items')
            .select('uid, title, scheduled_date')
            .eq('is_completed', false)
            .lt('scheduled_date', todayStr);

          if (overdueSchool && overdueSchool.length > 0) {
            const validUids = overdueSchool
              .filter(
                (s) =>
                  Boolean(s.scheduled_date) &&
                  !String(s.uid).startsWith('__system_') &&
                  !completedCleanTitles.has(cleanTaskTitle(s.title))
              )
              .map((s) => s.uid);

            if (validUids.length > 0) {
              await sb
                .from('school_items')
                .update({
                  scheduled_date: todayStr,
                  updated_at: new Date().toISOString(),
                })
                .in('uid', validUids);
            }
          }
        } catch (schoolRolloverErr) {
          console.warn('Universal daily school rollover error:', schoolRolloverErr);
        }
      })(),
    ]);
  }

  const tasksAuthError =
    !hasCredentials ||
    syncResults.errors.some((e) => e.includes('invalid_grant') || e.includes('Tasklist'));

  return NextResponse.json({
    success: true,
    tasksAuthError,
    completedTitles,
    results: {
      ...syncResults,
      tasksAuthError,
      completedTitles,
    },
  });
}
