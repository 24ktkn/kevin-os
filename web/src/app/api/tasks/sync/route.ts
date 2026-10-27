import { NextResponse } from 'next/server';
import { tasks_v1 } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  isEventPast,
  getTodayDateStr,
  isTaskEventTitle,
  cleanTaskTitle,
  computeStartEndIso,
} from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClientAsync,
  buildScheduledNotesTag,
} from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

interface PreCleanedSchoolRow {
  uid: string;
  title: string;
  clean: string;
  is_completed: boolean;
  scheduled_date?: string | null;
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
}

interface PreCleanedEventRow {
  id: string;
  title: string;
  clean: string;
  due_date: string;
  due_time: string;
  duration_mins: number;
  calendar_event_id: string | null;
  google_task_id: string | null;
  is_completed: boolean;
}

function titlesMatchClean(cleanA: string, cleanB: string): boolean {
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  return cleanA.length > 5 && cleanB.length > 5 && (cleanA.includes(cleanB) || cleanB.includes(cleanA));
}

export async function GET() {
  const completedTitles: string[] = [];
  const syncResults = {
    calendarEventsSynced: 0,
    tasksSynced: 0,
    errors: [] as string[],
  };
  const sb = supabaseAdmin || supabase;
  const todayStr = getTodayDateStr();

  // Track which tasks had their due_date updated via Google Calendar event move or rollover
  const calendarMovedTaskIds = new Set<string>();
  const claimedTaskIdsInCalendarPass = new Set<string>();

  const calendarApi = getGoogleCalendarClient();
  const { tasksApi, hasCredentials, clientId, clientSecret, refreshToken } = await getGoogleTasksClientAsync();

  // Upfront parallel prefetch from Supabase and Google Tasks
  let allSchoolRows: PreCleanedSchoolRow[] = [];
  let allDbTasks: PreCleanedTaskRow[] = [];
  let allDbEvents: PreCleanedEventRow[] = [];
  const eventsByCalEventId = new Map<string, PreCleanedEventRow[]>();
  const tasksByGoogleId = new Map<string, PreCleanedTaskRow>();
  const tasksByCalEventId = new Map<string, PreCleanedTaskRow>();

  const prefetchedTasklists = new Map<string, tasks_v1.Schema$Task[]>();

  await Promise.all([
    // 1. Prefetch Supabase tables in parallel
    (async () => {
      if (!sb) return;
      const [schoolRes, tasksRes, eventsRes] = await Promise.all([
        sb.from('school_items').select('uid, title, is_completed, scheduled_date'),
        sb
          .from('tasks')
          .select('id, title, due_date, due_time, duration_mins, google_task_id, calendar_event_id, calendar_name, is_completed, is_scheduled')
          .eq('type', 'Task'),
        sb
          .from('tasks')
          .select('id, title, due_date, due_time, duration_mins, calendar_event_id, google_task_id, is_completed')
          .eq('type', 'Event')
          .order('created_at', { ascending: false }),
      ]);

      if (schoolRes.data) {
        allSchoolRows = schoolRes.data
          .filter((r) => r.uid && !String(r.uid).startsWith('__system_'))
          .map((r) => ({
            uid: r.uid,
            title: r.title || '',
            clean: cleanTaskTitle(r.title),
            is_completed: Boolean(r.is_completed),
            scheduled_date: r.scheduled_date,
          }));
      }

      if (tasksRes.data) {
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
          };
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
        allDbEvents = eventsRes.data.map((e) => {
          const row: PreCleanedEventRow = {
            id: e.id,
            title: e.title || '',
            clean: cleanTaskTitle(e.title),
            due_date: e.due_date || '',
            due_time: e.due_time || '',
            duration_mins: e.duration_mins || 30,
            calendar_event_id: e.calendar_event_id || null,
            google_task_id: e.google_task_id || null,
            is_completed: Boolean(e.is_completed),
          };
          if (row.calendar_event_id) {
            const list = eventsByCalEventId.get(row.calendar_event_id) || [];
            list.push(row);
            eventsByCalEventId.set(row.calendar_event_id, list);
          }
          return row;
        });
      }
    })(),

    // 2. Prefetch all 4 Google Tasklists in parallel once
    (async () => {
      if (!tasksApi || !hasCredentials) return;
      await Promise.all(
        Object.entries(TASKLIST_MAP).map(async ([calName, listId]) => {
          try {
            const res = await tasksApi.tasks.list({
              tasklist: listId,
              showCompleted: true,
              showHidden: true,
              maxResults: 100,
            });
            prefetchedTasklists.set(calName, res.data.items || []);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            syncResults.errors.push(`Tasklist ${calName} (${listId}): ${msg}`);
          }
        })
      );
    })(),
  ]);

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

            const isMarkedDoneInDb =
              Boolean(existing?.is_completed) || Boolean(matchedTask?.is_completed);

            // Standalone events auto-complete when their time window passes; task timeblocks NEVER auto-complete
            const isItemCompleted = isTaskBlock
              ? isMarkedDoneInDb
              : isEventPast(dateStr, timeStr === 'All Day' ? '' : timeStr, durationMins) || isMarkedDoneInDb;

            // Auto-rollover incomplete task timeblocks from past dates to todayStr
            if (isTaskBlock && !isItemCompleted && dateStr < todayStr) {
              dateStr = todayStr;
              if (ev.start?.dateTime && timeStr !== 'All Day') {
                try {
                  const { startDateTime, endDateTime } = computeStartEndIso(todayStr, timeStr, durationMins);
                  await calendarApi.events.patch({
                    calendarId: calId,
                    eventId: ev.id,
                    requestBody: {
                      start: { dateTime: startDateTime, timeZone: 'America/New_York' },
                      end: { dateTime: endDateTime, timeZone: 'America/New_York' },
                    },
                  });
                } catch (rollCalErr) {
                  console.warn('Failed to roll over Google Calendar task block to today:', rollCalErr);
                }
              }
            }

            // Ensure a companion Task row exists for every Task timeblock
            if (isTaskBlock && !matchedTask) {
              const cleanTaskSummary = ev.summary.replace(/^(?:[🎓☑️📚📝⏰]\s*)*\[Task\]\s*/i, '').trim();
              const { data: insertedTask } = await sb
                .from('tasks')
                .insert({
                  title: cleanTaskSummary || ev.summary,
                  type: 'Task',
                  calendar_name: calName,
                  due_date: dateStr,
                  due_time: timeStr === 'All Day' ? '' : timeStr,
                  duration_mins: durationMins,
                  location: ev.location || '',
                  notes: ev.description || '',
                  calendar_event_id: ev.id,
                  is_completed: isItemCompleted,
                  is_scheduled: true,
                })
                .select('id, title, due_date, due_time, duration_mins, google_task_id, calendar_event_id, calendar_name, is_completed')
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
                };
                matchedTask = newTaskRow;
                allDbTasks.push(newTaskRow);
                tasksByCalEventId.set(ev.id, newTaskRow);
                claimedTaskIdsInCalendarPass.add(newTaskRow.id);
              }
            }

            // If matchedTask is missing google_task_id, check prefetched Google Tasklists in memory
            if (matchedTask && !matchedTask.google_task_id) {
              for (const [, gItems] of prefetchedTasklists.entries()) {
                const gMatch = gItems.find((item) => {
                  if (!item.title) return false;
                  return titlesMatchClean(cleanTaskTitle(item.title), cleanEvTitle);
                });
                if (gMatch?.id) {
                  matchedTask.google_task_id = gMatch.id;
                  tasksByGoogleId.set(gMatch.id, matchedTask);
                  if (gMatch.status === 'completed') {
                    matchedTask.is_completed = true;
                  }
                  break;
                }
              }
            }

            const finalCompleted = isItemCompleted || Boolean(matchedTask?.is_completed);

            const updatePayload = {
              title: ev.summary,
              type: 'Event',
              calendar_name: calName,
              due_date: dateStr,
              due_time: timeStr === 'All Day' ? '' : timeStr,
              duration_mins: durationMins,
              location: ev.location || '',
              notes: ev.description || '',
              calendar_event_id: ev.id,
              google_task_id: matchedTask?.google_task_id || existing?.google_task_id || null,
              is_completed: finalCompleted,
              is_scheduled: true,
              updated_at: new Date().toISOString(),
            };

            if (existing) {
              await sb.from('tasks').update(updatePayload).eq('id', existing.id);
              existing.due_date = dateStr;
              existing.due_time = updatePayload.due_time;
              existing.is_completed = finalCompleted;
            } else {
              const { data: insertedEv } = await sb
                .from('tasks')
                .insert(updatePayload)
                .select('id')
                .single();
              if (insertedEv) {
                const newEvRow: PreCleanedEventRow = {
                  id: insertedEv.id,
                  title: ev.summary,
                  clean: cleanEvTitle,
                  due_date: dateStr,
                  due_time: updatePayload.due_time,
                  duration_mins: durationMins,
                  calendar_event_id: ev.id,
                  google_task_id: updatePayload.google_task_id,
                  is_completed: finalCompleted,
                };
                allDbEvents.push(newEvRow);
                eventsByCalEventId.set(ev.id, [newEvRow]);
              }
            }

            // Two-Way Calendar -> Task Sync
            if (matchedTask) {
              const effectiveTime = timeStr === 'All Day' ? '' : timeStr;
              const dateOrTimeChanged =
                matchedTask.due_date !== dateStr ||
                (effectiveTime && matchedTask.due_time !== effectiveTime);

              await sb
                .from('tasks')
                .update({
                  due_date: dateStr,
                  due_time: effectiveTime || matchedTask.due_time || '',
                  duration_mins: durationMins,
                  calendar_event_id: ev.id,
                  google_task_id: matchedTask.google_task_id,
                  calendar_name: calName,
                  is_completed: finalCompleted,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', matchedTask.id);

              calendarMovedTaskIds.add(matchedTask.id);
              if (matchedTask.google_task_id) {
                calendarMovedTaskIds.add(matchedTask.google_task_id);
              }

              // Patch Google Task due date & scheduled tag if calendar timeblock moved
              if (dateOrTimeChanged && tasksApi && matchedTask.google_task_id) {
                const targetTaskLists = Array.from(
                  new Set([
                    TASKLIST_MAP[calName] || '@default',
                    TASKLIST_MAP[matchedTask.calendar_name || 'School'] || '@default',
                    ...Object.values(TASKLIST_MAP),
                  ])
                );

                for (const tListId of targetTaskLists) {
                  try {
                    const existingGTask = await tasksApi.tasks.get({
                      tasklist: tListId,
                      task: matchedTask.google_task_id,
                    });
                    if (existingGTask.data) {
                      const updatedNotes = buildScheduledNotesTag(
                        existingGTask.data.notes,
                        dateStr,
                        effectiveTime,
                        durationMins
                      );
                      await tasksApi.tasks.patch({
                        tasklist: tListId,
                        task: matchedTask.google_task_id,
                        requestBody: {
                          due: `${dateStr}T00:00:00.000Z`,
                          notes: updatedNotes,
                        },
                      });
                      break;
                    }
                  } catch {
                    // Try next tasklist
                  }
                }
              }

              matchedTask.due_date = dateStr;
              matchedTask.due_time = effectiveTime || matchedTask.due_time;
              matchedTask.duration_mins = durationMins;
            }

            // Sync matching school_items in memory
            if (isTaskBlock && cleanEvTitle && allSchoolRows.length > 0) {
              const matchedSchoolUids = allSchoolRows
                .filter((row) => titlesMatchClean(row.clean, cleanEvTitle))
                .map((row) => row.uid);

              if (matchedSchoolUids.length > 0) {
                await sb
                  .from('school_items')
                  .update({
                    is_scheduled: true,
                    scheduled_date: dateStr,
                    scheduled_time: timeStr === 'All Day' ? '10:00 AM' : timeStr,
                    duration_mins: durationMins,
                    target_calendar: calName,
                    updated_at: new Date().toISOString(),
                  })
                  .in('uid', matchedSchoolUids);
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

          const isDone = item.status === 'completed';
          if (isDone) {
            completedTitles.push(taskTitle);
          }

          let dateStr = item.due ? item.due.split('T')[0] : '';

          // Auto-rollover incomplete tasks from past dates to todayStr
          if (!isDone && (!dateStr || dateStr < todayStr)) {
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
            const cleanTask = cleanTaskTitle(taskTitle);

            // 1. If completed, batch-update matching school_items
            if (isDone && cleanTask && allSchoolRows.length > 0) {
              const matchedUids: string[] = [];
              for (const row of allSchoolRows) {
                if (!row.is_completed && titlesMatchClean(row.clean, cleanTask)) {
                  row.is_completed = true;
                  matchedUids.push(row.uid);
                }
              }
              if (matchedUids.length > 0) {
                await sb
                  .from('school_items')
                  .update({ is_completed: true, updated_at: new Date().toISOString() })
                  .in('uid', matchedUids);
              }
            }

            // 2. Resolve existing Task row in memory (O(1) by google_task_id, fallback to title)
            let existingTask = item.id ? tasksByGoogleId.get(item.id) : undefined;
            if (!existingTask && cleanTask) {
              existingTask = allDbTasks.find(
                (t) => t.title === taskTitle || titlesMatchClean(t.clean, cleanTask)
              );
            }

            if (existingTask) {
              const isMovedByCalendar =
                calendarMovedTaskIds.has(existingTask.id) ||
                (item.id ? calendarMovedTaskIds.has(item.id) : false);

              const taskUpdatePayload: Record<string, unknown> = {
                title: taskTitle,
                type: 'Task',
                calendar_name: calName,
                is_completed: isDone,
                google_task_id: item.id,
                updated_at: new Date().toISOString(),
              };

              if (!isMovedByCalendar && dateStr) {
                taskUpdatePayload.due_date = dateStr;
                existingTask.due_date = dateStr;
              }

              await sb.from('tasks').update(taskUpdatePayload).eq('id', existingTask.id);
              existingTask.is_completed = isDone;
              if (item.id) {
                existingTask.google_task_id = item.id;
                tasksByGoogleId.set(item.id, existingTask);
              }

              if (item.id && isDone) {
                await sb
                  .from('tasks')
                  .update({
                    is_completed: true,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('google_task_id', item.id);
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
                  is_completed: isDone,
                  is_scheduled: false,
                })
                .select('id')
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
                  is_completed: isDone,
                  is_scheduled: false,
                };
                allDbTasks.push(newRow);
                if (item.id) tasksByGoogleId.set(item.id, newRow);
              }
            }

            // 3. If completed, mark matching task timeblock Event rows completed using in-memory allDbEvents
            if (isDone && cleanTask && allDbEvents.length > 0) {
              const evIdsToComplete = allDbEvents
                .filter((ev) => {
                  if (ev.is_completed || !isTaskEventTitle(ev.title)) return false;
                  const titleMatches = titlesMatchClean(ev.clean, cleanTask);
                  const dateMatches = !dateStr || !ev.due_date || ev.due_date === dateStr;
                  return titleMatches && dateMatches;
                })
                .map((ev) => {
                  ev.is_completed = true;
                  return ev.id;
                });

              if (evIdsToComplete.length > 0) {
                await sb
                  .from('tasks')
                  .update({ is_completed: true, updated_at: new Date().toISOString() })
                  .in('id', evIdsToComplete);
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
          (t) => !t.is_completed && !t.google_task_id && t.title.trim().length > 0
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
      (async () => {
        try {
          const { data: overdueRows } = await sb
            .from('tasks')
            .select('id, title, type, due_date')
            .eq('is_completed', false)
            .lt('due_date', todayStr);

          if (overdueRows && overdueRows.length > 0) {
            const rolloverIds = overdueRows
              .filter((r) => r.type === 'Task' || isTaskEventTitle(r.title))
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
            .select('uid, scheduled_date')
            .eq('is_completed', false)
            .lt('scheduled_date', todayStr);

          if (overdueSchool && overdueSchool.length > 0) {
            const validUids = overdueSchool
              .filter((s) => Boolean(s.scheduled_date) && !String(s.uid).startsWith('__system_'))
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
