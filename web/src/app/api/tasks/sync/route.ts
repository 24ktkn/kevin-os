import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { isEventPast, getTodayDateStr, isTaskEventTitle } from '@/lib/date-utils';

const CALENDAR_MAP: Record<string, string> = {
  'Kevin Nguyen': '24ktkn@gmail.com',
  'Family': 'family05668227215423587251@group.calendar.google.com',
  'School': '0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com',
  'Volunteering': '57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com',
};

const TASKLIST_MAP: Record<string, string> = {
  'School': 'ZGRiT21qM2ZCbVRWOVBlMQ',
  'Kevin Nguyen': '@default',
  'Family': 'Um85a3gwMVZqTXN4X0M3Wg',
  'Volunteering': 'bUtfd3ZxU0Y3RFUyM2x2dQ',
};

export const dynamic = 'force-dynamic';

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

function cleanTitle(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\,/g, ',')
    .replace(/\\/g, '')
    .replace(/^[🎓📚📝⏰\s\[\]Task:]+/gi, '')
    .replace(/^\(\s*\d+\s*(?:mins?|minutes?|hours?|hrs?)\s*\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function GET() {
  const syncResults = {
    calendarEventsSynced: 0,
    tasksSynced: 0,
    tasksRolledOver: 0,
    errors: [] as string[],
  };

  const todayStr = getTodayDateStr();
  const calendarMovedTaskIds = new Set<string>();

  // 1. Sync Google Calendars via Service Account
  try {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = getPrivateKey();

    if (clientEmail && privateKey) {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });

      const calendarApi = google.calendar({ version: 'v3', auth });

      let allSchoolForCalendar: { uid: string; title: string; is_completed?: boolean }[] = [];
      let allDbTasks: {
        id: string;
        title: string;
        due_date?: string;
        due_time?: string;
        google_task_id?: string;
        calendar_event_id?: string;
        is_completed?: boolean;
        calendar_name?: string;
        notes?: string;
      }[] = [];

      const sbInit = supabaseAdmin || supabase;
      if (sbInit) {
        const { data: dbSchool } = await sbInit.from('school_items').select('uid, title, is_completed');
        if (dbSchool) allSchoolForCalendar = dbSchool;

        const { data: dbTasks } = await sbInit
          .from('tasks')
          .select('id, title, due_date, due_time, google_task_id, calendar_event_id, is_completed, calendar_name, notes')
          .eq('type', 'Task');
        if (dbTasks) allDbTasks = dbTasks;
      }

      // Initialize Google Tasks client early to patch tasks when calendar events are moved
      const cleanEnvVal = (val?: string) => (val ? val.replace(/^["']|["']$/g, '').trim() : '');
      const clientId = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_ID);
      const clientSecret = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_SECRET);
      const refreshToken = cleanEnvVal(process.env.GOOGLE_TASKS_REFRESH_TOKEN);

      let sharedTasksApi: any = null;
      if (clientId && clientSecret && refreshToken) {
        try {
          const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
          oauth2Client.setCredentials({ refresh_token: refreshToken });
          sharedTasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
        } catch (e) {
          console.warn('Early tasksApi init notice:', e);
        }
      }

      const now = new Date();
      const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      for (const [calName, calId] of Object.entries(CALENDAR_MAP)) {
        try {
          const res = await calendarApi.events.list({
            calendarId: calId,
            timeMin,
            timeMax,
            singleEvents: true,
            showDeleted: false,
            orderBy: 'startTime',
          });

          const events = res.data.items || [];
          for (const ev of events) {
            if (!ev.id || !ev.summary) continue;

            let dateStr = '';
            let timeStr = '';
            let durationMins = 0;

            if (ev.start?.dateTime && ev.end?.dateTime) {
              const start = new Date(ev.start.dateTime);
              const end = new Date(ev.end.dateTime);
              durationMins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

              // Format date YYYY-MM-DD in America/New_York (Eastern Time)
              dateStr = start.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
              // Format time 12-hour AM/PM in America/New_York (Eastern Time)
              timeStr = start.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/New_York',
              });
            } else if (ev.start?.date) {
              dateStr = ev.start.date;
              durationMins = 0;
            }

            if (!dateStr) continue;

            const sb = supabaseAdmin || supabase;
            if (sb) {
              const cleanEv = cleanTitle(ev.summary);
              const isTaskBlock = isTaskEventTitle(ev.summary);

              // Match task: first by already-linked calendar_event_id, then by title (only for Task blocks)
              let matchedTask = allDbTasks.find((tk) => tk.calendar_event_id === ev.id);
              if (!matchedTask && isTaskBlock && cleanEv) {
                matchedTask = allDbTasks.find((tk) => {
                  const c = cleanTitle(tk.title);
                  return c === cleanEv || (c.length > 5 && (c.includes(cleanEv) || cleanEv.includes(c)));
                });
              }

              // Upsert event by calendar_event_id AND type = 'Event' (never overwrite/delete Task rows!)
              const { data: existingRows } = await sb
                .from('tasks')
                .select('id, is_completed')
                .eq('calendar_event_id', ev.id)
                .eq('type', 'Event')
                .order('created_at', { ascending: false });

              const existing = existingRows?.[0];
              const eventAlreadyPassed = isEventPast(dateStr, timeStr, durationMins);

              // Determine if this item is completed
              let isItemCompleted = false;
              if (isTaskBlock || matchedTask) {
                // Task timeblocks ONLY complete when checked off (never auto-completed by clock!)
                isItemCompleted = Boolean(matchedTask ? matchedTask.is_completed : existing?.is_completed);

                // Auto-transfer uncompleted past task timeblocks to todayStr!
                if (!isItemCompleted && dateStr < todayStr) {
                  dateStr = todayStr;
                  syncResults.tasksRolledOver++;

                  // Also roll the Google Calendar event forward to todayStr so Google Calendar stays in sync
                  if (ev.start?.dateTime && ev.end?.dateTime) {
                    try {
                      const startOrig = new Date(ev.start.dateTime);
                      const nyParts = new Intl.DateTimeFormat('en-US', {
                        timeZone: 'America/New_York',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      }).formatToParts(startOrig);
                      const h = parseInt(nyParts.find((p) => p.type === 'hour')?.value || '10', 10) % 24;
                      const m = parseInt(nyParts.find((p) => p.type === 'minute')?.value || '0', 10);
                      const endTotal = h * 60 + m + (durationMins || 60);
                      const endH = Math.floor(endTotal / 60) % 24;
                      const endM = endTotal % 60;
                      const pad = (n: number) => String(n).padStart(2, '0');
                      await calendarApi.events.patch({
                        calendarId: calId,
                        eventId: ev.id,
                        requestBody: {
                          start: { dateTime: `${todayStr}T${pad(h)}:${pad(m)}:00-04:00`, timeZone: 'America/New_York' },
                          end: { dateTime: `${todayStr}T${pad(endH)}:${pad(endM)}:00-04:00`, timeZone: 'America/New_York' },
                        },
                      });
                    } catch (calRollErr) {
                      console.warn('Calendar rollover patch notice:', calRollErr);
                    }
                  }
                }
              } else {
                // Standalone Calendar Event (e.g. Workout, Lecture, Appointment): auto-completes when time passes
                isItemCompleted = Boolean(existing?.is_completed || eventAlreadyPassed);
              }

              const updatePayload: Record<string, unknown> = {
                title: ev.summary,
                type: 'Event',
                calendar_name: calName,
                due_date: dateStr,
                due_time: timeStr,
                duration_mins: durationMins,
                location: ev.location || '',
                notes: ev.description || '',
                is_scheduled: true,
                is_completed: isItemCompleted,
                updated_at: new Date().toISOString(),
              };

              if (existing) {
                await sb
                  .from('tasks')
                  .update(updatePayload)
                  .eq('id', existing.id);

                // Clean up any extra duplicate Event rows with same calendar_event_id
                if (existingRows && existingRows.length > 1) {
                  const duplicateIds = existingRows.slice(1).map((r) => r.id);
                  await sb.from('tasks').delete().in('id', duplicateIds);
                }
              } else {
                await sb.from('tasks').insert({
                  ...updatePayload,
                  calendar_event_id: ev.id,
                });
              }

              // If this is a Task timeblock ("🎓 [Task] ...") but has no companion Task row in DB, create one!
              if (isTaskBlock && !matchedTask) {
                const cleanTaskTitle = ev.summary
                  .replace(/^🎓\s*\[Task\]\s*/i, '')
                  .replace(/^\[Task\]\s*/i, '')
                  .trim();
                const newTaskId = crypto.randomUUID();
                const newTaskRow = {
                  id: newTaskId,
                  title: cleanTaskTitle || ev.summary,
                  type: 'Task',
                  calendar_name: calName,
                  due_date: dateStr,
                  due_time: timeStr,
                  duration_mins: durationMins,
                  location: ev.location || '',
                  notes: ev.description || '',
                  calendar_event_id: ev.id,
                  is_completed: isItemCompleted,
                  is_scheduled: true,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                await sb.from('tasks').insert(newTaskRow);
                matchedTask = newTaskRow;
                allDbTasks.push(newTaskRow);
              }

              // Bidirectional cross-linking & Auto-reschedule Google Task when Calendar Event moves
              if (cleanEv && matchedTask) {
                const targetTaskDate = !matchedTask.is_completed && dateStr < todayStr ? todayStr : dateStr;
                const dateChanged = matchedTask.due_date !== targetTaskDate;
                const timeChanged = Boolean(timeStr && matchedTask.due_time !== timeStr);
                const needsLink = matchedTask.calendar_event_id !== ev.id;

                if (dateChanged || timeChanged || needsLink) {
                  await sb
                    .from('tasks')
                    .update({
                      calendar_event_id: ev.id,
                      due_date: targetTaskDate,
                      due_time: timeStr || matchedTask.due_time || '',
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', matchedTask.id);

                  // Track task so Section 2 (Google Tasks sync) does not revert the date
                  calendarMovedTaskIds.add(matchedTask.id);
                  if (matchedTask.google_task_id) {
                    calendarMovedTaskIds.add(matchedTask.google_task_id);
                  }

                  matchedTask.calendar_event_id = ev.id;
                  matchedTask.due_date = targetTaskDate;
                  if (timeStr) matchedTask.due_time = timeStr;

                  // If date or time changed on Google Calendar, push the update to Google Tasks!
                  if ((dateChanged || timeChanged) && sharedTasksApi) {
                    const targetTaskListId =
                      TASKLIST_MAP[calName] ||
                      TASKLIST_MAP[matchedTask.calendar_name || ''] ||
                      TASKLIST_MAP['Kevin Nguyen'];

                    let updatedNotes = matchedTask.notes || '';
                    if (timeStr) {
                      const schedTag = `⏰ Scheduled: ${timeStr} (${durationMins || 30}m)`;
                      if (updatedNotes.includes('⏰ Scheduled:')) {
                        updatedNotes = updatedNotes.replace(/⏰ Scheduled:[^\n]+/g, schedTag);
                      } else if (updatedNotes) {
                        updatedNotes = `${schedTag}\n\n${updatedNotes}`;
                      } else {
                        updatedNotes = schedTag;
                      }
                    }

                    if (matchedTask.google_task_id) {
                      const listCandidates = [
                        targetTaskListId,
                        ...Object.values(TASKLIST_MAP).filter((l) => l !== targetTaskListId),
                      ];

                      for (const listId of listCandidates) {
                        try {
                          await sharedTasksApi.tasks.patch({
                            tasklist: listId,
                            task: matchedTask.google_task_id,
                            requestBody: {
                              due: `${targetTaskDate}T00:00:00.000Z`,
                              notes: updatedNotes,
                            },
                          });
                          break;
                        } catch {
                          // Try next list candidate
                        }
                      }
                    } else {
                      // If google_task_id was not yet linked, search tasklists by title
                      for (const listId of Object.values(TASKLIST_MAP)) {
                        try {
                          const listRes = await sharedTasksApi.tasks.list({
                            tasklist: listId,
                            showCompleted: false,
                            maxResults: 50,
                          });
                          const gMatch = (listRes.data.items || []).find((tk: any) => {
                            if (!tk.title) return false;
                            const ct = cleanTitle(tk.title);
                            return ct === cleanEv || (ct.length > 5 && (ct.includes(cleanEv) || cleanEv.includes(ct)));
                          });
                          if (gMatch && gMatch.id) {
                            matchedTask.google_task_id = gMatch.id;
                            calendarMovedTaskIds.add(gMatch.id);
                            await sb
                              .from('tasks')
                              .update({ google_task_id: gMatch.id })
                              .eq('id', matchedTask.id);

                            await sharedTasksApi.tasks.patch({
                              tasklist: listId,
                              task: gMatch.id,
                              requestBody: {
                                due: `${targetTaskDate}T00:00:00.000Z`,
                                notes: updatedNotes,
                              },
                            });
                            break;
                          }
                        } catch {
                          // ignore
                        }
                      }
                    }
                  }
                }

                if (matchedTask.google_task_id) {
                  await sb
                    .from('tasks')
                    .update({ google_task_id: matchedTask.google_task_id })
                    .eq('calendar_event_id', ev.id)
                    .eq('type', 'Event');
                }

                // If matching Task is completed, ensure Event is also marked completed
                if (matchedTask.is_completed) {
                  await sb
                    .from('tasks')
                    .update({ is_completed: true })
                    .eq('calendar_event_id', ev.id)
                    .eq('type', 'Event');
                }
              }

              // Cross-sync to school_items: update scheduled date and time from Google Calendar
              if (allSchoolForCalendar.length > 0 && cleanEv) {
                const matchedSchool = allSchoolForCalendar.filter((row) => {
                  const cleanRow = cleanTitle(row.title);
                  return (
                    cleanRow === cleanEv ||
                    (cleanRow.length > 5 &&
                      cleanEv.length > 5 &&
                      (cleanRow.includes(cleanEv) || cleanEv.includes(cleanRow)))
                  );
                });

                for (const match of matchedSchool) {
                  const effectiveSchoolDate = !match.is_completed && dateStr < todayStr ? todayStr : dateStr;
                  await sb
                    .from('school_items')
                    .update({
                      is_scheduled: true,
                      scheduled_date: effectiveSchoolDate,
                      scheduled_time: timeStr || '10:00 AM',
                      duration_mins: durationMins || 60,
                      target_calendar: calName,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('uid', match.uid);
                }
              }

              syncResults.calendarEventsSynced++;
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          syncResults.errors.push(`Calendar ${calName}: ${msg}`);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    syncResults.errors.push(`Calendar Service Account: ${msg}`);
  }

  const completedTitles: string[] = [];

  // 2. Sync Google Tasks (if refresh token is valid)
  const sb = supabaseAdmin || supabase;
  try {
    const cleanEnvVal = (val?: string) => (val ? val.replace(/^["']|["']$/g, '').trim() : '');
    const clientId = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_ID);
    const clientSecret = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_SECRET);
    const refreshToken = cleanEnvVal(process.env.GOOGLE_TASKS_REFRESH_TOKEN);

    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

      let allSchoolRows: { uid: string; title: string; is_completed: boolean }[] = [];
      if (sb) {
        const { data: dbSchool } = await sb.from('school_items').select('uid, title, is_completed');
        if (dbSchool) allSchoolRows = dbSchool;
      }

      for (const [calName, listId] of Object.entries(TASKLIST_MAP)) {
        try {
          const res = await tasksApi.tasks.list({
            tasklist: listId,
            showCompleted: true,
            showHidden: true,
            maxResults: 100,
          });

          const items = res.data.items || [];
          for (const item of items) {
            if (!item.title) continue;
            const taskTitle = item.title.trim();
            if (!taskTitle) continue;

            const isDone = item.status === 'completed';
            if (isDone) {
              completedTitles.push(taskTitle);
            }

            let dateStr = '';
            if (item.due) {
              dateStr = item.due.split('T')[0];
            }

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
              // 1. If completed, update school_items table with smart title matching
              if (isDone && allSchoolRows.length > 0) {
                const cleanTask = cleanTitle(taskTitle);
                if (cleanTask) {
                  const matchedItems = allSchoolRows.filter((row) => {
                    const cleanRow = cleanTitle(row.title);
                    return (
                      cleanRow === cleanTask ||
                      (cleanRow.length > 5 &&
                        cleanTask.length > 5 &&
                        (cleanRow.includes(cleanTask) || cleanTask.includes(cleanRow)))
                    );
                  });

                  for (const match of matchedItems) {
                    if (!match.is_completed) {
                      match.is_completed = true;
                      await sb
                        .from('school_items')
                        .update({ is_completed: true, updated_at: new Date().toISOString() })
                        .eq('uid', match.uid);
                    }
                  }
                }
              }

              // 2. Check if this task exists in tasks table by google_task_id or title (avoid maybeSingle duplicate error)
              let existingId: string | null = null;
              if (item.id) {
                const { data: byId } = await sb
                  .from('tasks')
                  .select('id')
                  .eq('google_task_id', item.id)
                  .eq('type', 'Task')
                  .limit(1);
                if (byId && byId.length > 0) existingId = byId[0].id;
              }

              if (!existingId) {
                const { data: byTitle } = await sb
                  .from('tasks')
                  .select('id')
                  .eq('title', taskTitle)
                  .eq('type', 'Task')
                  .limit(1);
                if (byTitle && byTitle.length > 0) existingId = byTitle[0].id;
              }

              if (existingId) {
                const isMovedByCalendar =
                  calendarMovedTaskIds.has(existingId) ||
                  (item.id ? calendarMovedTaskIds.has(item.id) : false);

                const taskUpdatePayload: Record<string, unknown> = {
                  title: taskTitle,
                  type: 'Task',
                  calendar_name: calName,
                  is_completed: isDone,
                  google_task_id: item.id,
                  duration_mins: 0,
                  updated_at: new Date().toISOString(),
                };

                // Only overwrite due_date if it wasn't just updated by Google Calendar event sync
                if (!isMovedByCalendar && dateStr) {
                  taskUpdatePayload.due_date = dateStr;
                }

                // Update this task row
                await sb
                  .from('tasks')
                  .update(taskUpdatePayload)
                  .eq('id', existingId);

                // If completed, update ALL matching tasks with this google_task_id (including duplicate rows)
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
                await sb.from('tasks').insert({
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
                });
              }

              // 3. Also update any matching calendar event timeblock in tasks table
              const cleanTask = cleanTitle(taskTitle);
              if (cleanTask) {
                const { data: siblingEvents } = await sb
                  .from('tasks')
                  .select('id, title, due_date')
                  .eq('type', 'Event');

                if (siblingEvents) {
                  const evsToUpdate = siblingEvents.filter((ev) => {
                    if (!isTaskEventTitle(ev.title)) return false;
                    const c = cleanTitle(ev.title);
                    const titleMatches =
                      c === cleanTask ||
                      (c.length > 5 && cleanTask.length > 5 && (c.includes(cleanTask) || cleanTask.includes(c)));
                    const dateMatches = !dateStr || !ev.due_date || ev.due_date === dateStr;
                    return titleMatches && dateMatches;
                  });

                  if (evsToUpdate.length > 0 && isDone) {
                    await sb
                      .from('tasks')
                      .update({ is_completed: true, updated_at: new Date().toISOString() })
                      .in('id', evsToUpdate.map((e) => e.id));
                  }
                }
              }

              syncResults.tasksSynced++;
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          syncResults.errors.push(`Tasklist ${calName} (${listId}): ${msg}`);
          console.warn(`Tasklist ${listId} sync skipped or failed:`, err);
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

  // 3. Auto-sweep all past standalone events in database to is_completed = true (never auto-complete task timeblocks)
  if (sb) {
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

      // Reset any future standalone events that were previously marked completed by mistake
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
    } catch (sweepErr) {
      console.warn('Past events sweep error:', sweepErr);
    }

    // 4. Universal Daily Rollover: Transfer any incomplete tasks (or task timeblocks) from past days to todayStr
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

      // Also roll over any incomplete scheduled school_items with scheduled_date < todayStr
      const { data: overdueSchool } = await sb
        .from('school_items')
        .select('uid, scheduled_date')
        .eq('is_completed', false)
        .lt('scheduled_date', todayStr);

      if (overdueSchool && overdueSchool.length > 0) {
        const validUids = overdueSchool
          .filter((s) => Boolean(s.scheduled_date))
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
    } catch (rolloverErr) {
      console.warn('Universal daily rollover error:', rolloverErr);
    }
  }

  return NextResponse.json({
    success: true,
    completedTitles,
    results: {
      ...syncResults,
      completedTitles,
    },
  });
}
