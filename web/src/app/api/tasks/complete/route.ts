import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  cleanTaskTitle,
  titlesMatch,
  isTaskEventTitle,
  formatCompletedCalendarSummary,
} from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClientAsync,
} from '@/lib/google-calendar';

type TasksClient = NonNullable<Awaited<ReturnType<typeof getGoogleTasksClientAsync>>['tasksApi']>;

async function listAllGoogleTasks(tasksApi: TasksClient, tasklistId: string) {
  const allItems: Array<{ id?: string | null; title?: string | null; status?: string | null }> = [];
  let pageToken: string | undefined;

  do {
    const res = await tasksApi.tasks.list({
      tasklist: tasklistId,
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

function getOrderedCalendarIds(preferredCalName?: string | null): string[] {
  const preferredId = preferredCalName ? CALENDAR_MAP[preferredCalName] : undefined;
  const allIds = Object.values(CALENDAR_MAP).filter(Boolean);
  return Array.from(new Set(preferredId ? [preferredId, ...allIds] : allIds));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      taskId,
      googleTaskId,
      calendarEventId,
      title,
      calendar_name,
      completed,
      timeblockOnly,
    }: {
      taskId?: string;
      googleTaskId?: string;
      calendarEventId?: string;
      title?: string;
      calendar_name?: string;
      completed: boolean;
      timeblockOnly?: boolean;
    } = body;

    const isCompleted = Boolean(completed);
    const isTimeblockOnly = Boolean(timeblockOnly);
    const sb = supabaseAdmin || supabase;

    let targetGoogleTaskId = googleTaskId || null;
    let targetCalEventId = calendarEventId || null;
    let targetCalName = calendar_name || null;
    let targetListId = targetCalName ? (TASKLIST_MAP[targetCalName] || null) : null;
    let taskTitle = title || '';

    // 1. Fetch tasks and school_items in 1 parallel round-trip
    let allTasks: {
      id: string;
      google_task_id: string | null;
      calendar_event_id: string | null;
      calendar_name: string | null;
      title: string;
      type: string | null;
      is_completed: boolean;
    }[] = [];
    let allSchool: { uid: string; title: string }[] = [];

    if (sb) {
      const [tasksRes, schoolRes] = await Promise.all([
        sb
          .from('tasks')
          .select('id, google_task_id, calendar_event_id, calendar_name, title, type, is_completed'),
        sb.from('school_items').select('uid, title'),
      ]);
      allTasks = (tasksRes.data || []) as typeof allTasks;
      allSchool = ((schoolRes.data || []) as typeof allSchool).filter(
        (s) => !String(s.uid).startsWith('__system_')
      );

      const dbTask =
        (taskId ? allTasks.find((t) => t.id === taskId) : undefined) ||
        (targetCalEventId ? allTasks.find((t) => t.calendar_event_id === targetCalEventId) : undefined);

      if (dbTask) {
        if (!targetGoogleTaskId && dbTask.google_task_id) targetGoogleTaskId = dbTask.google_task_id;
        if (!targetCalEventId && dbTask.calendar_event_id) targetCalEventId = dbTask.calendar_event_id;
        if (!targetCalName && dbTask.calendar_name) targetCalName = dbTask.calendar_name;
        if (!targetListId && targetCalName) targetListId = TASKLIST_MAP[targetCalName] || null;
        if (!taskTitle && dbTask.title) taskTitle = dbTask.title;
      }
    }

    const cleanedQuery = cleanTaskTitle(taskTitle);

    if (!isTimeblockOnly && !targetGoogleTaskId && cleanedQuery) {
      const match = allTasks.find((t) => t.google_task_id && titlesMatch(t.title, taskTitle));
      if (match) {
        targetGoogleTaskId = match.google_task_id;
        if (!targetListId && match.calendar_name) targetListId = TASKLIST_MAP[match.calendar_name] || null;
      }
    }

    // Collect known calendar_event_ids for matching [Task] timeblocks
    const knownCalEventMap = new Map<string, string | null>();
    if (targetCalEventId) {
      knownCalEventMap.set(targetCalEventId, targetCalName);
    }
    for (const t of allTasks) {
      if (!t.calendar_event_id) continue;
      if (isTimeblockOnly) {
        if (t.id === taskId || (targetCalEventId && t.calendar_event_id === targetCalEventId)) {
          if (!knownCalEventMap.has(t.calendar_event_id)) {
            knownCalEventMap.set(t.calendar_event_id, t.calendar_name);
          }
        }
      } else if (
        (targetGoogleTaskId && t.google_task_id === targetGoogleTaskId) ||
        (targetCalEventId && t.calendar_event_id === targetCalEventId) ||
        (cleanedQuery && titlesMatch(t.title, taskTitle))
      ) {
        if (!knownCalEventMap.has(t.calendar_event_id)) {
          knownCalEventMap.set(t.calendar_event_id, t.calendar_name);
        }
      }
    }

    // 2. Patch Google Tasks and Google Calendar [Task] events in parallel
    const { tasksApi, hasCredentials } = await getGoogleTasksClientAsync();
    const calendarApi = getGoogleCalendarClient();
    let patched = false;
    let calendarPatched = false;
    let patchError: string | null = null;
    const updatedCalEventSummaries = new Map<string, string>();
    const actionIso = new Date().toISOString();

    await Promise.all([
      // 2a. Patch Google Tasks (skipped if toggling timeblockOnly)
      (async () => {
        if (isTimeblockOnly) return;
        if (!tasksApi || !hasCredentials) {
          patchError = 'Missing Google Tasks OAuth2 credentials';
          return;
        }
        try {
          const listOrder = targetListId
            ? [targetListId, ...Object.values(TASKLIST_MAP).filter((l) => l !== targetListId)]
            : Object.values(TASKLIST_MAP);

          if (targetGoogleTaskId) {
            for (const listId of listOrder) {
              try {
                await tasksApi.tasks.patch({
                  tasklist: listId,
                  task: targetGoogleTaskId,
                  requestBody: {
                    status: isCompleted ? 'completed' : 'needsAction',
                    completed: isCompleted ? actionIso : null,
                  },
                });
                patched = true;
                targetListId = listId;
                break;
              } catch {
                // Try next task list
              }
            }
          }

          if (!patched && cleanedQuery) {
            const listResponses = await Promise.all(
              listOrder.map(async (listId) => {
                try {
                  return { listId, items: await listAllGoogleTasks(tasksApi, listId) };
                } catch {
                  return { listId, items: [] };
                }
              })
            );

            for (const { listId, items } of listResponses) {
              const found = items.find((item) => item.title && titlesMatch(item.title, taskTitle));
              if (found?.id) {
                targetGoogleTaskId = found.id;
                targetListId = listId;
                await tasksApi.tasks.patch({
                  tasklist: listId,
                  task: found.id,
                  requestBody: {
                    status: isCompleted ? 'completed' : 'needsAction',
                    completed: isCompleted ? new Date().toISOString() : null,
                  },
                });
                patched = true;
                break;
              }
            }
          }
        } catch (err: unknown) {
          patchError = err instanceof Error ? err.message : String(err);
          console.error('Google Tasks API error:', patchError);
        }
      })(),

      // 2b. Prefix/unprefix matching Google Calendar [Task] timeblock summaries with "✅ [Task]"
      (async () => {
        if (!calendarApi) return;
        try {
          if (knownCalEventMap.size > 0) {
            await Promise.all(
              Array.from(knownCalEventMap.entries()).map(async ([evId, prefCal]) => {
                for (const calId of getOrderedCalendarIds(prefCal || targetCalName)) {
                  try {
                    const evRes = await calendarApi.events.get({ calendarId: calId, eventId: evId });
                    const currentSummary = evRes.data.summary;
                    if (currentSummary && isTaskEventTitle(currentSummary)) {
                      const nextSummary = formatCompletedCalendarSummary(currentSummary, isCompleted);
                      if (currentSummary !== nextSummary) {
                        await calendarApi.events.patch({
                          calendarId: calId,
                          eventId: evId,
                          requestBody: { summary: nextSummary },
                        });
                        calendarPatched = true;
                      }
                      updatedCalEventSummaries.set(evId, nextSummary);
                    }
                    break;
                  } catch {
                    // Try next calendar ID
                  }
                }
              })
            );
          } else if (!isTimeblockOnly && cleanedQuery) {
            const nowMs = Date.now();
            const timeMin = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
            const timeMax = new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString();

            const calResults = await Promise.all(
              getOrderedCalendarIds(targetCalName).map(async (calId) => {
                try {
                  const res = await calendarApi.events.list({
                    calendarId: calId,
                    timeMin,
                    timeMax,
                    singleEvents: false,
                    showDeleted: false,
                    maxResults: 250,
                  });
                  return { calId, items: res.data.items || [] };
                } catch {
                  return { calId, items: [] };
                }
              })
            );

            for (const { calId, items } of calResults) {
              for (const ev of items) {
                if (!ev.id || !ev.summary) continue;
                if (!isTaskEventTitle(ev.summary) || !titlesMatch(ev.summary, taskTitle)) continue;
                const nextSummary = formatCompletedCalendarSummary(ev.summary, isCompleted);
                if (ev.summary !== nextSummary) {
                  await calendarApi.events.patch({
                    calendarId: calId,
                    eventId: ev.id,
                    requestBody: { summary: nextSummary },
                  });
                  calendarPatched = true;
                }
                updatedCalEventSummaries.set(ev.id, nextSummary);
              }
            }
          }
        } catch (calErr) {
          console.warn('Google Calendar [Task] completion prefix update failed:', calErr);
        }
      })(),
    ]);

    // 3. Batch-update Supabase tasks & school_items records in parallel AFTER Google patches
    if (sb) {
      const updatedAtIso = new Date().toISOString();
      const matchingTaskRows = new Map<string, (typeof allTasks)[number]>();

      if (taskId) {
        const directRow = allTasks.find((t) => t.id === taskId);
        if (directRow) matchingTaskRows.set(directRow.id, directRow);
      }

      for (const t of allTasks) {
        if (isTimeblockOnly) {
          if (t.type === 'Event' && targetCalEventId && t.calendar_event_id === targetCalEventId) {
            matchingTaskRows.set(t.id, t);
          }
          continue;
        }
        if (
          (targetGoogleTaskId && t.google_task_id === targetGoogleTaskId) ||
          (targetCalEventId && t.calendar_event_id === targetCalEventId) ||
          (cleanedQuery && titlesMatch(t.title, taskTitle))
        ) {
          matchingTaskRows.set(t.id, t);
        }
      }

      const matchingSchoolUids =
        !isTimeblockOnly && cleanedQuery
          ? allSchool.filter((s) => titlesMatch(s.title, taskTitle)).map((s) => s.uid)
          : [];

      const dbOps: PromiseLike<unknown>[] = [];

      const eventSummaryRows: { id: string; summary: string }[] = [];
      const standardTaskIds: string[] = [];

      for (const row of matchingTaskRows.values()) {
        const nextEvSummary =
          row.type === 'Event' && row.calendar_event_id
            ? updatedCalEventSummaries.get(row.calendar_event_id)
            : undefined;
        if (nextEvSummary && nextEvSummary !== row.title) {
          eventSummaryRows.push({ id: row.id, summary: nextEvSummary });
        } else {
          standardTaskIds.push(row.id);
        }
      }

      if (taskId && !matchingTaskRows.has(taskId)) {
        standardTaskIds.push(taskId);
      }

      if (standardTaskIds.length > 0) {
        const taskUpdates: Record<string, unknown> = {
          is_completed: isCompleted,
          updated_at: updatedAtIso,
        };
        if (targetGoogleTaskId && !isTimeblockOnly) {
          taskUpdates.google_task_id = targetGoogleTaskId;
        }
        dbOps.push(sb.from('tasks').update(taskUpdates).in('id', standardTaskIds));
      }

      for (const evUpdate of eventSummaryRows) {
        const evPayload: Record<string, unknown> = {
          title: evUpdate.summary,
          is_completed: isCompleted,
          updated_at: updatedAtIso,
        };
        if (targetGoogleTaskId && !isTimeblockOnly) {
          evPayload.google_task_id = targetGoogleTaskId;
        }
        dbOps.push(sb.from('tasks').update(evPayload).eq('id', evUpdate.id));
      }

      if (matchingSchoolUids.length > 0) {
        dbOps.push(
          sb
            .from('school_items')
            .update({ is_completed: isCompleted, updated_at: updatedAtIso })
            .in('uid', matchingSchoolUids)
        );
      }

      await Promise.all(dbOps);
    }

    return NextResponse.json({
      success: true,
      patched,
      calendarPatched,
      googleTaskId: targetGoogleTaskId,
      calendarEventId: targetCalEventId,
      tasklistId: targetListId,
      patchError,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Task complete route error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
