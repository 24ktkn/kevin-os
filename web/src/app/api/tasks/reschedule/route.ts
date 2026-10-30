import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { RescheduleRequest, RescheduleResponse, TaskItem, CalendarName } from '@/types/task';
import {
  cleanTaskTitle,
  titlesMatch,
  isTaskEventTitle,
  parseTimeToHoursMinutes,
  format24hTo12h,
  computeStartEndIso,
} from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClientAsync,
} from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export function cleanTitle(str?: string): string {
  return cleanTaskTitle(str);
}

export async function POST(req: NextRequest) {
  try {
    const body: RescheduleRequest = await req.json();
    const {
      taskId,
      calendarEventId,
      googleTaskId,
      schoolUid,
      title,
      calendarName = 'Kevin Nguyen',
      newDate,
      newTime,
      durationMins = 30,
      scope = 'instance',
      createTimeblock,
    } = body;

    if (!newDate) {
      return NextResponse.json<RescheduleResponse>(
        { success: false, error: 'newDate (YYYY-MM-DD) is required to reschedule' },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin || supabase;
    let resolvedTask: TaskItem | null = null;
    let targetCalEventId = calendarEventId || null;
    let targetGoogleTaskId = googleTaskId || null;
    let itemTitle = title || '';
    let targetCalendarName: CalendarName = calendarName;
    let currentNotes = '';

    // 1. Fetch all tasks and school_items in a single parallel round-trip
    let allDbTasks: TaskItem[] = [];
    let allSchoolRows: { uid: string; title: string }[] = [];

    if (sb) {
      const [tasksRes, schoolRes] = await Promise.all([
        sb.from('tasks').select('*'),
        sb.from('school_items').select('uid, title'),
      ]);
      allDbTasks = (tasksRes.data || []) as TaskItem[];
      allSchoolRows = ((schoolRes.data || []) as { uid: string; title: string }[]).filter(
        (s) => !String(s.uid).startsWith('__system_')
      );
    }

    // Resolve task from in-memory allDbTasks
    if (taskId) {
      const byId = allDbTasks.find((t) => t.id === taskId);
      if (byId) resolvedTask = byId;
    }
    if (!resolvedTask && targetCalEventId) {
      const byCal = allDbTasks.find((t) => t.calendar_event_id === targetCalEventId);
      if (byCal) resolvedTask = byCal;
    }
    if (!resolvedTask && targetGoogleTaskId) {
      const byGTask = allDbTasks.find((t) => t.google_task_id === targetGoogleTaskId);
      if (byGTask) resolvedTask = byGTask;
    }

    if (resolvedTask) {
      if (!targetCalEventId && resolvedTask.calendar_event_id) {
        targetCalEventId = resolvedTask.calendar_event_id;
      }
      if (!targetGoogleTaskId && resolvedTask.google_task_id) {
        targetGoogleTaskId = resolvedTask.google_task_id;
      }
      if (!itemTitle && resolvedTask.title) itemTitle = resolvedTask.title;
      if (resolvedTask.calendar_name) targetCalendarName = resolvedTask.calendar_name;
      currentNotes = resolvedTask.notes || '';
    }

    const cleanSearchTitle = cleanTaskTitle(itemTitle);

    // Resolve sibling Event / Task IDs in memory if missing
    if (!targetCalEventId && cleanSearchTitle) {
      const evMatch = allDbTasks.find(
        (r) => r.type === 'Event' && r.calendar_event_id && titlesMatch(r.title, itemTitle)
      );
      if (evMatch?.calendar_event_id) {
        targetCalEventId = evMatch.calendar_event_id;
        if (evMatch.calendar_name) targetCalendarName = evMatch.calendar_name;
        if (!targetGoogleTaskId && evMatch.google_task_id) targetGoogleTaskId = evMatch.google_task_id;
      }
    }

    if (!targetGoogleTaskId && cleanSearchTitle) {
      const tkMatch = allDbTasks.find(
        (r) => r.type === 'Task' && r.google_task_id && titlesMatch(r.title, itemTitle)
      );
      if (tkMatch?.google_task_id) {
        targetGoogleTaskId = tkMatch.google_task_id;
        if (tkMatch.calendar_name) targetCalendarName = tkMatch.calendar_name;
        if (!targetCalEventId && tkMatch.calendar_event_id) targetCalEventId = tkMatch.calendar_event_id;
      }
    }

    const { hours, minutes } = parseTimeToHoursMinutes(newTime);
    const formatted12h = format24hTo12h(hours, minutes);
    const finalDuration = Math.max(0, parseInt(String(durationMins), 10) || 30);
    const { startDateTime, endDateTime } = computeStartEndIso(newDate, formatted12h, finalDuration || 30);

    let patchedCalendar = false;
    let patchedTask = false;
    let patchedSchool = false;

    const calendarApi = getGoogleCalendarClient();
    const { tasksApi, hasCredentials } = await getGoogleTasksClientAsync();
    let activeCalId = CALENDAR_MAP[targetCalendarName] || CALENDAR_MAP['School'] || CALENDAR_MAP['Kevin Nguyen'];

    // 2 & 3. Run Google Calendar and Google Tasks updates in parallel
    await Promise.all([
      // 2. Google Calendar Patch or Create
      (async () => {
        if (!calendarApi) return;
        try {
          // Always search Google Calendar by title when targetCalEventId is not yet known
          // (e.g. when rescheduling from School Sync or when the Task row had no calendar_event_id linked yet)
          if (!targetCalEventId && cleanSearchTitle) {
            const calCandidates = [
              activeCalId,
              ...Object.values(CALENDAR_MAP).filter((c) => c !== activeCalId),
            ];

            for (const cId of calCandidates) {
              try {
                const listRes = await calendarApi.events.list({
                  calendarId: cId,
                  q: cleanSearchTitle.slice(0, 35),
                  singleEvents: true,
                  maxResults: 25,
                });

                const matches = (listRes.data.items || []).filter(
                  (ev) => ev.summary && titlesMatch(ev.summary, itemTitle)
                );

                if (matches.length > 0 && matches[0].id) {
                  targetCalEventId = matches[0].id;
                  activeCalId = cId;
                  for (const [cName, mappedId] of Object.entries(CALENDAR_MAP)) {
                    if (mappedId === cId) {
                      targetCalendarName = cName as CalendarName;
                      break;
                    }
                  }

                  // Clean up any extra duplicate [Task] timeblocks for the same item on this calendar
                  for (let i = 1; i < matches.length; i++) {
                    const dup = matches[i];
                    if (dup.id && isTaskEventTitle(dup.summary || '')) {
                      calendarApi.events.delete({ calendarId: cId, eventId: dup.id }).catch(() => {});
                    }
                  }
                  break;
                }
              } catch {
                // continue
              }
            }
          }

          if (targetCalEventId) {
            try {
              let eventToPatch = targetCalEventId;
              if (scope === 'series') {
                try {
                  const getRes = await calendarApi.events.get({
                    calendarId: activeCalId,
                    eventId: targetCalEventId,
                  });
                  if (getRes.data.recurringEventId) {
                    eventToPatch = getRes.data.recurringEventId;
                  }
                } catch {
                  // stick with targetCalEventId
                }
              }

              await calendarApi.events.patch({
                calendarId: activeCalId,
                eventId: eventToPatch,
                requestBody: {
                  start: { dateTime: startDateTime, timeZone: 'America/New_York' },
                  end: { dateTime: endDateTime, timeZone: 'America/New_York' },
                },
              });
              patchedCalendar = true;
            } catch {
              for (const [cName, cId] of Object.entries(CALENDAR_MAP)) {
                if (cId === activeCalId) continue;
                try {
                  await calendarApi.events.patch({
                    calendarId: cId,
                    eventId: targetCalEventId,
                    requestBody: {
                      start: { dateTime: startDateTime, timeZone: 'America/New_York' },
                      end: { dateTime: endDateTime, timeZone: 'America/New_York' },
                    },
                  });
                  patchedCalendar = true;
                  targetCalendarName = cName as CalendarName;
                  activeCalId = cId;
                  break;
                } catch {
                  // Ignore and continue
                }
              }
            }

            // Also remove any secondary duplicate [Task] events on activeCalId that match this task title
            if (cleanSearchTitle && scope !== 'series') {
              try {
                const listRes = await calendarApi.events.list({
                  calendarId: activeCalId,
                  q: cleanSearchTitle.slice(0, 35),
                  singleEvents: true,
                  maxResults: 20,
                });
                for (const ev of listRes.data.items || []) {
                  if (
                    ev.id &&
                    ev.id !== targetCalEventId &&
                    ev.summary &&
                    isTaskEventTitle(ev.summary) &&
                    titlesMatch(ev.summary, itemTitle)
                  ) {
                    await calendarApi.events.delete({
                      calendarId: activeCalId,
                      eventId: ev.id,
                    });
                  }
                }
              } catch {
                // Ignore duplicate cleanup errors
              }
            }
          } else if (createTimeblock === true) {
            // Create brand new Google Calendar timeblock when requested
            try {
              const cleanDisplay = itemTitle.replace(/^(?:[🎓☑️📚📝⏰]\s*)*\[Task\]\s*/i, '').trim();
              const calSummary =
                targetCalendarName === 'School'
                  ? `🎓 [Task] ${cleanDisplay}`
                  : `🎓 [Task] ${cleanDisplay}`;

              const insertRes = await calendarApi.events.insert({
                calendarId: activeCalId,
                requestBody: {
                  summary: calSummary,
                  description: currentNotes || '',
                  start: { dateTime: startDateTime, timeZone: 'America/New_York' },
                  end: { dateTime: endDateTime, timeZone: 'America/New_York' },
                },
              });

              if (insertRes.data.id) {
                targetCalEventId = insertRes.data.id;
                patchedCalendar = true;

                if (sb) {
                  await sb.from('tasks').insert({
                    id: crypto.randomUUID(),
                    title: calSummary,
                    type: 'Event',
                    calendar_name: targetCalendarName,
                    due_date: newDate,
                    due_time: formatted12h,
                    duration_mins: finalDuration,
                    is_completed: false,
                    is_scheduled: true,
                    calendar_event_id: targetCalEventId,
                    google_task_id: targetGoogleTaskId,
                    notes: currentNotes || '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  });
                }
              }
            } catch (calInsertErr) {
              console.error('Failed to create new calendar timeblock in reschedule:', calInsertErr);
            }
          }
        } catch (authErr) {
          console.warn('Calendar service account error:', authErr);
        }
      })(),

      // 3. Google Tasks Patch
      (async () => {
        if (!tasksApi || !hasCredentials) return;
        try {
          const targetTaskListId = TASKLIST_MAP[targetCalendarName] || TASKLIST_MAP['Kevin Nguyen'];
          let updatedNotes = currentNotes;
          const schedTag = `⏰ Scheduled: ${formatted12h} (${finalDuration}m)`;
          if (updatedNotes.includes('⏰ Scheduled:')) {
            updatedNotes = updatedNotes.replace(/⏰ Scheduled:[^\n]+/g, schedTag);
          } else if (updatedNotes) {
            updatedNotes = `${schedTag}\n\n${updatedNotes}`;
          } else {
            updatedNotes = schedTag;
          }

          if (targetGoogleTaskId) {
            const listCandidates = [
              targetTaskListId,
              ...Object.values(TASKLIST_MAP).filter((l) => l !== targetTaskListId),
            ];

            for (const listId of listCandidates) {
              try {
                await tasksApi.tasks.patch({
                  tasklist: listId,
                  task: targetGoogleTaskId,
                  requestBody: {
                    due: `${newDate}T00:00:00.000Z`,
                    notes: updatedNotes,
                  },
                });
                patchedTask = true;
                break;
              } catch {
                // Try next list candidate
              }
            }
          } else if (cleanSearchTitle) {
            const listResponses = await Promise.all(
              Object.values(TASKLIST_MAP).map(async (listId) => {
                try {
                  const res = await tasksApi.tasks.list({
                    tasklist: listId,
                    showCompleted: true,
                    showHidden: true,
                    maxResults: 100,
                  });
                  return { listId, items: res.data.items || [] };
                } catch {
                  return { listId, items: [] };
                }
              })
            );

            for (const { listId, items } of listResponses) {
              const match = items.find((t) => t.title && titlesMatch(t.title, itemTitle));
              if (match?.id) {
                targetGoogleTaskId = match.id;
                await tasksApi.tasks.patch({
                  tasklist: listId,
                  task: match.id,
                  requestBody: {
                    due: `${newDate}T00:00:00.000Z`,
                    notes: updatedNotes,
                  },
                });
                patchedTask = true;
                break;
              }
            }
          }
        } catch (gtErr) {
          console.warn('Google Tasks patch warning:', gtErr);
        }
      })(),
    ]);

    // 4 & 5. Update Supabase 'tasks' and 'school_items' in parallel using in-memory IDs
    let updatedTaskRecord: TaskItem | null = null;
    if (sb) {
      const nowIso = new Date().toISOString();
      const idsToUpdate = new Set<string>();

      if (resolvedTask?.id) idsToUpdate.add(resolvedTask.id);
      if (taskId) idsToUpdate.add(taskId);

      for (const t of allDbTasks) {
        if (targetCalEventId && t.calendar_event_id === targetCalEventId) {
          idsToUpdate.add(t.id);
        }
        if (targetGoogleTaskId && t.google_task_id === targetGoogleTaskId) {
          idsToUpdate.add(t.id);
        }
        if (cleanSearchTitle && t.title && titlesMatch(t.title, itemTitle)) {
          idsToUpdate.add(t.id);
        }
      }

      const matchedSchoolUids = schoolUid
        ? [schoolUid]
        : cleanSearchTitle
          ? allSchoolRows.filter((s) => titlesMatch(s.title, itemTitle)).map((s) => s.uid)
          : [];

      await Promise.all([
        (async () => {
          const updatePayload: Record<string, unknown> = {
            due_date: newDate,
            due_time: formatted12h,
            duration_mins: finalDuration,
            is_completed: false,
            updated_at: nowIso,
          };

          if (targetCalEventId) {
            updatePayload.calendar_event_id = targetCalEventId;
            updatePayload.is_scheduled = true;
          }
          if (targetGoogleTaskId) {
            updatePayload.google_task_id = targetGoogleTaskId;
          }

          if (idsToUpdate.size > 0) {
            const { data: updatedList } = await sb
              .from('tasks')
              .update(updatePayload)
              .in('id', Array.from(idsToUpdate))
              .select();

            if (updatedList && updatedList.length > 0) {
              updatedTaskRecord = (updatedList.find((u) => u.type === 'Task') || updatedList[0]) as TaskItem;
            }
          } else if (itemTitle) {
            // If neither Event nor Task row existed in Supabase tasks yet, insert them so future operations stay linked
            const cleanDisplay = itemTitle.replace(/^(?:[🎓☑️📚📝⏰]\s*)*\[Task\]\s*/i, '').trim();
            const rowsToInsert: Record<string, unknown>[] = [];
            if (targetCalEventId) {
              rowsToInsert.push({
                id: crypto.randomUUID(),
                title: `🎓 [Task] ${cleanDisplay}`,
                type: 'Event',
                calendar_name: targetCalendarName,
                due_date: newDate,
                due_time: formatted12h,
                duration_mins: finalDuration,
                is_completed: false,
                is_scheduled: true,
                calendar_event_id: targetCalEventId,
                google_task_id: targetGoogleTaskId,
                notes: currentNotes || '',
                created_at: nowIso,
                updated_at: nowIso,
              });
            }
            if (targetGoogleTaskId) {
              rowsToInsert.push({
                id: crypto.randomUUID(),
                title: cleanDisplay,
                type: 'Task',
                calendar_name: targetCalendarName,
                due_date: newDate,
                due_time: formatted12h,
                duration_mins: finalDuration,
                is_completed: false,
                is_scheduled: Boolean(targetCalEventId),
                calendar_event_id: targetCalEventId,
                google_task_id: targetGoogleTaskId,
                notes: currentNotes || '',
                created_at: nowIso,
                updated_at: nowIso,
              });
            }
            if (rowsToInsert.length > 0) {
              const { data: insertedList } = await sb.from('tasks').insert(rowsToInsert).select();
              if (insertedList && insertedList.length > 0) {
                updatedTaskRecord = (insertedList.find((u) => u.type === 'Task') || insertedList[0]) as TaskItem;
              }
            }
          }
        })(),

        (async () => {
          if (matchedSchoolUids.length === 0) return;
          await sb
            .from('school_items')
            .update({
              is_scheduled: true,
              scheduled_date: newDate,
              scheduled_time: formatted12h,
              duration_mins: finalDuration,
              target_calendar: targetCalendarName,
              is_completed: false,
              updated_at: nowIso,
            })
            .in('uid', matchedSchoolUids);
          patchedSchool = true;
        })(),
      ]);
    }

    return NextResponse.json<RescheduleResponse>({
      success: true,
      message: `Rescheduled to ${newDate} at ${formatted12h} (${finalDuration}m)`,
      updatedTask: updatedTaskRecord || undefined,
      patchedCalendar,
      patchedTask,
      patchedSchool,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in /api/tasks/reschedule:', errorMsg);
    return NextResponse.json<RescheduleResponse>(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
