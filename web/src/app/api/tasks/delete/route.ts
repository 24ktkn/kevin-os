import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { DeleteTaskRequest, DeleteTaskResponse, CalendarName } from '@/types/task';
import { cleanTitle } from '@/app/api/tasks/reschedule/route';

export const dynamic = 'force-dynamic';

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

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

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
    const cleanSearchTitle = cleanTitle(title || '');

    const candidateCalEventIds = new Set<string>();
    const candidateGoogleTaskIds = new Set<string>();
    const taskIdsToDelete = new Set<string>();

    if (calendarEventId) candidateCalEventIds.add(calendarEventId);
    if (googleTaskId) candidateGoogleTaskIds.add(googleTaskId);
    if (taskId) taskIdsToDelete.add(taskId);

    // 1. Resolve matching rows in Supabase 'tasks'
    if (sb) {
      // Find by taskId
      if (taskId) {
        const { data: dbTask } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (dbTask) {
          if (dbTask.calendar_event_id) candidateCalEventIds.add(dbTask.calendar_event_id);
          if (dbTask.google_task_id) candidateGoogleTaskIds.add(dbTask.google_task_id);
        }
      }

      // Find by calendarEventId
      if (candidateCalEventIds.size > 0) {
        const { data: byCal } = await sb
          .from('tasks')
          .select('id, calendar_event_id, google_task_id')
          .in('calendar_event_id', Array.from(candidateCalEventIds));
        (byCal || []).forEach((r) => {
          taskIdsToDelete.add(r.id);
          if (r.google_task_id) candidateGoogleTaskIds.add(r.google_task_id);
        });
      }

      // Find by googleTaskId
      if (candidateGoogleTaskIds.size > 0) {
        const { data: byGTask } = await sb
          .from('tasks')
          .select('id, calendar_event_id, google_task_id')
          .in('google_task_id', Array.from(candidateGoogleTaskIds));
        (byGTask || []).forEach((r) => {
          taskIdsToDelete.add(r.id);
          if (r.calendar_event_id) candidateCalEventIds.add(r.calendar_event_id);
        });
      }

      // Find by clean title if provided
      if (cleanSearchTitle) {
        const { data: allTasks } = await sb.from('tasks').select('id, title, calendar_event_id, google_task_id');
        (allTasks || []).forEach((r) => {
          if (r.title) {
            const ct = cleanTitle(r.title);
            if (ct === cleanSearchTitle || (ct.length > 5 && (ct.includes(cleanSearchTitle) || cleanSearchTitle.includes(ct)))) {
              taskIdsToDelete.add(r.id);
              if (r.calendar_event_id) candidateCalEventIds.add(r.calendar_event_id);
              if (r.google_task_id) candidateGoogleTaskIds.add(r.google_task_id);
            }
          }
        });
      }
    }

    // 2. Delete from Google Calendar
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = getPrivateKey();
    let deletedCalendarCount = 0;

    if (clientEmail && privateKey) {
      try {
        const auth = new google.auth.JWT({
          email: clientEmail,
          key: privateKey,
          scopes: ['https://www.googleapis.com/auth/calendar'],
        });
        const calendarApi = google.calendar({ version: 'v3', auth });

        for (const calId of candidateCalEventIds) {
          let eventDeleted = false;
          const targetCal = CALENDAR_MAP[calendarName] || CALENDAR_MAP['Kevin Nguyen'];
          const calendarsToTry = [targetCal, ...Object.values(CALENDAR_MAP).filter((c) => c !== targetCal)];

          for (const cId of calendarsToTry) {
            try {
              await calendarApi.events.delete({
                calendarId: cId,
                eventId: calId,
              });
              eventDeleted = true;
              deletedCalendarCount++;
              break;
            } catch (err: unknown) {
              const status = (err as { code?: number; status?: number })?.code || (err as { status?: number })?.status;
              if (status === 404 || status === 410) {
                // Event is already gone or does not exist on this calendar
                continue;
              }
            }
          }
        }

        // If no calId was found but title was given, search and delete matching calendar event
        if (candidateCalEventIds.size === 0 && cleanSearchTitle) {
          for (const cId of Object.values(CALENDAR_MAP)) {
            try {
              const listRes = await calendarApi.events.list({
                calendarId: cId,
                q: cleanSearchTitle.slice(0, 35),
                singleEvents: true,
                maxResults: 15,
              });
              const match = (listRes.data.items || []).find((ev) => {
                if (!ev.summary) return false;
                const cs = cleanTitle(ev.summary);
                return cs === cleanSearchTitle;
              });
              if (match && match.id) {
                await calendarApi.events.delete({
                  calendarId: cId,
                  eventId: match.id,
                });
                deletedCalendarCount++;
              }
            } catch {
              // Ignore search/delete failure on calendar
            }
          }
        }
      } catch (calAuthErr) {
        console.warn('Google Calendar auth/delete error:', calAuthErr);
      }
    }

    // 3. Delete from Google Tasks
    const cleanEnvVal = (val?: string) => (val ? val.replace(/^["']|["']$/g, '').trim() : '');
    const clientId = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_ID);
    const clientSecret = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_SECRET);
    const refreshToken = cleanEnvVal(process.env.GOOGLE_TASKS_REFRESH_TOKEN);
    let deletedTaskCount = 0;

    if (clientId && clientSecret && refreshToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

        for (const gTaskId of candidateGoogleTaskIds) {
          const targetList = TASKLIST_MAP[calendarName] || TASKLIST_MAP['Kevin Nguyen'];
          const listsToTry = [targetList, ...Object.values(TASKLIST_MAP).filter((l) => l !== targetList)];

          for (const listId of listsToTry) {
            try {
              await tasksApi.tasks.delete({
                tasklist: listId,
                task: gTaskId,
              });
              deletedTaskCount++;
              break;
            } catch (gtErr: unknown) {
              const status = (gtErr as { code?: number; status?: number })?.code || (gtErr as { status?: number })?.status;
              if (status === 404) {
                continue;
              }
            }
          }
        }

        // If no candidateGoogleTaskId but title given, search and delete
        if (candidateGoogleTaskIds.size === 0 && cleanSearchTitle) {
          for (const listId of Object.values(TASKLIST_MAP)) {
            try {
              const listRes = await tasksApi.tasks.list({
                tasklist: listId,
                showCompleted: false,
                maxResults: 50,
              });
              const match = (listRes.data.items || []).find((t) => {
                if (!t.title) return false;
                const ct = cleanTitle(t.title);
                return ct === cleanSearchTitle;
              });
              if (match && match.id) {
                await tasksApi.tasks.delete({
                  tasklist: listId,
                  task: match.id,
                });
                deletedTaskCount++;
              }
            } catch {
              // Ignore
            }
          }
        }
      } catch (gtErr) {
        console.warn('Google Tasks auth/delete error:', gtErr);
      }
    }

    // 4. Delete from Supabase 'tasks' table
    let dbDeletedCount = 0;
    if (sb && taskIdsToDelete.size > 0) {
      const { data: delResult, error: delError } = await sb
        .from('tasks')
        .delete()
        .in('id', Array.from(taskIdsToDelete))
        .select();

      if (!delError && delResult) {
        dbDeletedCount = delResult.length;
      }
    }

    // 5. Update/Unschedule matching rows in 'school_items' table
    if (sb && cleanSearchTitle) {
      try {
        const { data: schoolRows } = await sb.from('school_items').select('uid, title');
        if (schoolRows && schoolRows.length > 0) {
          const matchedUids = schoolRows
            .filter((s) => {
              const cs = cleanTitle(s.title);
              return cs === cleanSearchTitle;
            })
            .map((s) => s.uid);

          if (matchedUids.length > 0) {
            await sb
              .from('school_items')
              .update({
                is_scheduled: false,
                scheduled_date: null,
                scheduled_time: null,
                duration_mins: 0,
                updated_at: new Date().toISOString(),
              })
              .in('uid', matchedUids);
          }
        }
      } catch (schoolErr) {
        console.warn('School items unschedule warning:', schoolErr);
      }
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
