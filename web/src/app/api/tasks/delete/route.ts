import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { DeleteTaskRequest, DeleteTaskResponse } from '@/types/task';
import { cleanTaskTitle, titlesMatch } from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClient,
} from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

async function handleDelete(req: NextRequest) {
  try {
    let body: DeleteTaskRequest = {};
    if (req.method === 'POST' || req.method === 'DELETE') {
      try {
        body = await req.json();
      } catch {
        // empty body
      }
    }

    const {
      taskId,
      calendarEventId,
      googleTaskId,
      calendarName = 'Kevin Nguyen',
      title,
    } = body;

    const sb = supabaseAdmin || supabase;
    const cleanSearchTitle = cleanTaskTitle(title || '');

    const candidateCalEventIds = new Set<string>();
    const candidateGoogleTaskIds = new Set<string>();
    const taskIdsToDelete = new Set<string>();

    if (calendarEventId) candidateCalEventIds.add(calendarEventId);
    if (googleTaskId) candidateGoogleTaskIds.add(googleTaskId);
    if (taskId) taskIdsToDelete.add(taskId);

    // 1. Fetch all tasks and school_items in 1 parallel round-trip instead of 5 sequential SELECTs
    let allTasks: { id: string; title: string; calendar_event_id: string | null; google_task_id: string | null }[] = [];
    let schoolRows: { uid: string; title: string }[] = [];

    if (sb) {
      const [tasksRes, schoolRes] = await Promise.all([
        sb.from('tasks').select('id, title, calendar_event_id, google_task_id'),
        cleanSearchTitle ? sb.from('school_items').select('uid, title') : Promise.resolve({ data: [] }),
      ]);
      allTasks = (tasksRes.data || []) as typeof allTasks;
      schoolRows = (schoolRes.data || []) as typeof schoolRows;

      // Pass 1: Seed from taskId
      if (taskId) {
        const direct = allTasks.find((t) => t.id === taskId);
        if (direct) {
          if (direct.calendar_event_id) candidateCalEventIds.add(direct.calendar_event_id);
          if (direct.google_task_id) candidateGoogleTaskIds.add(direct.google_task_id);
        }
      }

      // Pass 2: Match by calendarEventId, googleTaskId, or title
      for (const r of allTasks) {
        const matchesCal = Boolean(r.calendar_event_id && candidateCalEventIds.has(r.calendar_event_id));
        const matchesGTask = Boolean(r.google_task_id && candidateGoogleTaskIds.has(r.google_task_id));
        const matchesTitle = Boolean(cleanSearchTitle && r.title && titlesMatch(r.title, title));

        if (matchesCal || matchesGTask || matchesTitle) {
          taskIdsToDelete.add(r.id);
          if (r.calendar_event_id) candidateCalEventIds.add(r.calendar_event_id);
          if (r.google_task_id) candidateGoogleTaskIds.add(r.google_task_id);
        }
      }
    }

    let deletedCalendarCount = 0;
    let deletedTaskCount = 0;

    const calendarApi = getGoogleCalendarClient();
    const { tasksApi, hasCredentials } = getGoogleTasksClient();

    // 2 & 3. Delete from Google Calendar and Google Tasks in parallel
    await Promise.all([
      // 2. Delete from Google Calendar
      (async () => {
        if (!calendarApi) return;
        try {
          const targetCal = CALENDAR_MAP[calendarName] || CALENDAR_MAP['Kevin Nguyen'];
          const calendarsToTry = [targetCal, ...Object.values(CALENDAR_MAP).filter((c) => c !== targetCal)];

          for (const calId of candidateCalEventIds) {
            for (const cId of calendarsToTry) {
              try {
                await calendarApi.events.delete({
                  calendarId: cId,
                  eventId: calId,
                });
                deletedCalendarCount++;
                break;
              } catch (err: unknown) {
                const status =
                  (err as { code?: number; status?: number })?.code ||
                  (err as { status?: number })?.status;
                if (status === 404 || status === 410) continue;
              }
            }
          }

          if (candidateCalEventIds.size === 0 && cleanSearchTitle) {
            await Promise.all(
              Object.values(CALENDAR_MAP).map(async (cId) => {
                try {
                  const listRes = await calendarApi.events.list({
                    calendarId: cId,
                    q: cleanSearchTitle.slice(0, 35),
                    singleEvents: true,
                    maxResults: 15,
                  });
                  const match = (listRes.data.items || []).find(
                    (ev) => ev.summary && cleanTaskTitle(ev.summary) === cleanSearchTitle
                  );
                  if (match?.id) {
                    await calendarApi.events.delete({
                      calendarId: cId,
                      eventId: match.id,
                    });
                    deletedCalendarCount++;
                  }
                } catch {
                  // Ignore search/delete failure on calendar
                }
              })
            );
          }
        } catch (calAuthErr) {
          console.warn('Google Calendar auth/delete error:', calAuthErr);
        }
      })(),

      // 3. Delete from Google Tasks
      (async () => {
        if (!tasksApi || !hasCredentials) return;
        try {
          const targetList = TASKLIST_MAP[calendarName] || TASKLIST_MAP['Kevin Nguyen'];
          const listsToTry = [targetList, ...Object.values(TASKLIST_MAP).filter((l) => l !== targetList)];

          for (const gTaskId of candidateGoogleTaskIds) {
            for (const listId of listsToTry) {
              try {
                await tasksApi.tasks.delete({
                  tasklist: listId,
                  task: gTaskId,
                });
                deletedTaskCount++;
                break;
              } catch (gtErr: unknown) {
                const status =
                  (gtErr as { code?: number; status?: number })?.code ||
                  (gtErr as { status?: number })?.status;
                if (status === 404) continue;
              }
            }
          }

          if (candidateGoogleTaskIds.size === 0 && cleanSearchTitle) {
            await Promise.all(
              Object.values(TASKLIST_MAP).map(async (listId) => {
                try {
                  const listRes = await tasksApi.tasks.list({
                    tasklist: listId,
                    showCompleted: true,
                    showHidden: true,
                    maxResults: 50,
                  });
                  const match = (listRes.data.items || []).find(
                    (t) => t.title && cleanTaskTitle(t.title) === cleanSearchTitle
                  );
                  if (match?.id) {
                    await tasksApi.tasks.delete({
                      tasklist: listId,
                      task: match.id,
                    });
                    deletedTaskCount++;
                  }
                } catch {
                  // Ignore
                }
              })
            );
          }
        } catch (gtErr) {
          console.warn('Google Tasks auth/delete error:', gtErr);
        }
      })(),
    ]);

    // 4 & 5. Delete from Supabase 'tasks' and unschedule 'school_items' in parallel
    let dbDeletedCount = 0;
    if (sb) {
      const matchedSchoolUids = cleanSearchTitle
        ? schoolRows.filter((s) => cleanTaskTitle(s.title) === cleanSearchTitle).map((s) => s.uid)
        : [];

      await Promise.all([
        (async () => {
          if (taskIdsToDelete.size === 0) return;
          const { data: delResult, error: delError } = await sb
            .from('tasks')
            .delete()
            .in('id', Array.from(taskIdsToDelete))
            .select();

          if (!delError && delResult) {
            dbDeletedCount = delResult.length;
          }
        })(),

        (async () => {
          if (matchedSchoolUids.length === 0) return;
          await sb
            .from('school_items')
            .update({
              is_scheduled: false,
              scheduled_date: null,
              scheduled_time: null,
              duration_mins: 0,
              updated_at: new Date().toISOString(),
            })
            .in('uid', matchedSchoolUids);
        })(),
      ]);
    }

    return NextResponse.json<DeleteTaskResponse>({
      success: true,
      message: `Deleted item successfully (${dbDeletedCount} records removed, ${deletedCalendarCount} calendar events, ${deletedTaskCount} Google tasks)`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown delete error';
    console.error('Error in /api/tasks/delete:', errorMsg);
    return NextResponse.json<DeleteTaskResponse>(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleDelete(req);
}

export async function DELETE(req: NextRequest) {
  return handleDelete(req);
}
