import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase } from '@/lib/supabase';

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

export async function GET() {
  const syncResults = {
    calendarEventsSynced: 0,
    tasksSynced: 0,
    errors: [] as string[],
  };

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

              // Format date YYYY-MM-DD
              dateStr = start.toLocaleDateString('en-CA'); // YYYY-MM-DD
              // Format time 12-hour AM/PM
              timeStr = start.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              });
            } else if (ev.start?.date) {
              dateStr = ev.start.date;
              durationMins = 0;
            }

            if (!dateStr) continue;

            if (supabase) {
              // Upsert event by calendar_event_id
              const { data: existing } = await supabase
                .from('tasks')
                .select('id')
                .eq('calendar_event_id', ev.id)
                .maybeSingle();

              if (existing) {
                await supabase
                  .from('tasks')
                  .update({
                    title: ev.summary,
                    type: 'Event',
                    calendar_name: calName,
                    due_date: dateStr,
                    due_time: timeStr,
                    duration_mins: durationMins,
                    location: ev.location || '',
                    notes: ev.description || '',
                    is_scheduled: true,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', existing.id);
              } else {
                await supabase.from('tasks').insert({
                  title: ev.summary,
                  type: 'Event',
                  calendar_name: calName,
                  due_date: dateStr,
                  due_time: timeStr,
                  duration_mins: durationMins,
                  location: ev.location || '',
                  notes: ev.description || '',
                  calendar_event_id: ev.id,
                  is_scheduled: true,
                  is_completed: false,
                });
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
  try {
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

      for (const [, listId] of Object.entries(TASKLIST_MAP)) {
        try {
          const res = await tasksApi.tasks.list({
            tasklist: listId,
            showCompleted: true,
            showHidden: true,
            maxResults: 100,
          });

          const items = res.data.items || [];
          for (const item of items) {
            if (item.status === 'completed' && item.title) {
              const taskTitle = item.title.trim();
              completedTitles.push(taskTitle);

              if (supabase) {
                // 1. Update school_items table
                await supabase
                  .from('school_items')
                  .update({ is_completed: true, updated_at: new Date().toISOString() })
                  .ilike('title', `%${taskTitle}%`);

                // 2. Update tasks table (matches exact, with prefixes like 🎓 [Task], ?? [Task], etc.)
                await supabase
                  .from('tasks')
                  .update({ is_completed: true, updated_at: new Date().toISOString() })
                  .ilike('title', `%${taskTitle}%`);

                if (item.id) {
                  await supabase
                    .from('tasks')
                    .update({ is_completed: true, updated_at: new Date().toISOString() })
                    .eq('google_task_id', item.id);
                }

                syncResults.tasksSynced++;
              }
            }
          }
        } catch (err) {
          console.warn(`Tasklist ${listId} sync skipped or failed:`, err);
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    syncResults.errors.push(`Google Tasks sync: ${msg}`);
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
