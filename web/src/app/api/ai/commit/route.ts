import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase } from '@/lib/supabase';
import { ProposedTask, ScheduledCommitItem, AICommitResponse } from '@/types/ai';

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { targetDate, tasks = [] } = body;

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ error: 'No tasks to commit' }, { status: 400 });
    }

    const scheduledItems: ScheduledCommitItem[] = [];
    let createdEventsCount = 0;
    let createdTasksCount = 0;

    // 1. Setup Google Calendar API Client
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = getPrivateKey();
    let calendarApi: ReturnType<typeof google.calendar> | null = null;

    if (clientEmail && privateKey) {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
      calendarApi = google.calendar({ version: 'v3', auth });
    }

    // 2. Setup Google Tasks API Client
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;
    let tasksApi: ReturnType<typeof google.tasks> | null = null;

    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
    }

    for (const task of tasks as ProposedTask[]) {
      const calName = task.calendar || 'Kevin Nguyen';
      const targetCalId = CALENDAR_MAP[calName] || CALENDAR_MAP['Kevin Nguyen'];
      const targetTaskListId = TASKLIST_MAP[calName] || TASKLIST_MAP['Kevin Nguyen'];

      const [hStr, mStr] = (task.startTime24h || '09:00').split(':');
      const startH = parseInt(hStr, 10);
      const startM = parseInt(mStr || '00', 10);
      const dur = task.durationMins || 30;

      // Calculate end time
      let endTotalMins = startH * 60 + startM + dur;
      const endH = Math.floor(endTotalMins / 60) % 24;
      const endM = endTotalMins % 60;

      const startIso = `${targetDate}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00-04:00`;
      const endIso = `${targetDate}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00-04:00`;

      let calEventId = '';
      let googleTaskId = '';

      // A. Insert into Google Calendar
      if (calendarApi) {
        try {
          const calRes = await calendarApi.events.insert({
            calendarId: targetCalId,
            requestBody: {
              summary: `☑️ [Task] ${task.itemName}`,
              description: `AI Scheduled Timeblock (${dur}m)\nReasoning: ${task.reasoning || 'Autonomous slot optimization'}`,
              start: { dateTime: startIso, timeZone: 'America/New_York' },
              end: { dateTime: endIso, timeZone: 'America/New_York' },
              reminders: { useDefault: true },
            },
          });
          if (calRes.data.id) {
            calEventId = calRes.data.id;
            createdEventsCount++;
            scheduledItems.push({
              type: 'event',
              id: calEventId,
              title: task.itemName,
              calendarId: targetCalId,
            });
          }
        } catch (calErr) {
          console.warn(`Failed to insert calendar event for ${task.itemName}:`, calErr);
        }
      }

      // B. Insert into Google Tasks
      if (tasksApi) {
        try {
          const taskRes = await tasksApi.tasks.insert({
            tasklist: targetTaskListId,
            requestBody: {
              title: task.itemName,
              notes: `⏰ Scheduled: ${task.startTimeFormatted || task.startTime24h} (${dur}m)\nCalendar: [${calName}]`,
              due: `${targetDate}T00:00:00.000Z`,
            },
          });
          if (taskRes.data.id) {
            googleTaskId = taskRes.data.id;
            createdTasksCount++;
            scheduledItems.push({
              type: 'task',
              id: googleTaskId,
              title: task.itemName,
              tasklistId: targetTaskListId,
            });
          }
        } catch (tErr) {
          console.warn(`Failed to insert Google Task for ${task.itemName}:`, tErr);
        }
      }

      // C. Insert into Supabase 'tasks' table
      if (supabase) {
        try {
          await supabase.from('tasks').insert({
            title: task.itemName,
            type: 'Event',
            calendar_name: calName,
            due_date: targetDate,
            due_time: task.startTimeFormatted || `${startH}:${String(startM).padStart(2, '0')}`,
            duration_mins: dur,
            location: '',
            notes: task.reasoning || 'AI Scheduled Timeblock',
            calendar_event_id: calEventId || null,
            google_task_id: googleTaskId || null,
            is_scheduled: true,
            is_completed: false,
          });
        } catch (sbErr) {
          console.warn(`Failed to insert into Supabase for ${task.itemName}:`, sbErr);
        }
      }
    }

    return NextResponse.json<AICommitResponse>({
      success: true,
      createdEventsCount,
      createdTasksCount,
      scheduledItems,
      message: `Successfully scheduled ${createdEventsCount} Google Calendar events and ${createdTasksCount} Google Tasks!`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error committing AI schedule:', errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
