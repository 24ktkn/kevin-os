import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import {
  CalendarBusyBlock,
  BacklogTask,
  AISchedulerContextResponse,
} from '@/types/ai';

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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');

    const targetDate = dateParam || new Date().toISOString().split('T')[0];
    const [year, month, day] = targetDate.split('-').map(Number);

    // Day bounds: 8:00 AM to 10:00 PM EDT (America/New_York is -04:00 or -05:00)
    const timeMin = `${targetDate}T08:00:00-04:00`;
    const timeMax = `${targetDate}T22:00:00-04:00`;

    const busyBlocks: CalendarBusyBlock[] = [];

    // 1. Fetch Calendar Events via Service Account
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

            for (const event of res.data.items || []) {
              const startDateTime = event.start?.dateTime;
              const endDateTime = event.end?.dateTime;
              if (!startDateTime || !endDateTime) continue;

              const dStart = new Date(startDateTime);
              const dEnd = new Date(endDateTime);

              const startFmt = dStart.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/New_York',
              });

              const endFmt = dEnd.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/New_York',
              });

              busyBlocks.push({
                calendar: calName,
                title: event.summary || 'Busy',
                startIso: startDateTime,
                endIso: endDateTime,
                startTime: startFmt,
                endTime: endFmt,
              });
            }
          } catch (calErr) {
            console.warn(`Calendar error for ${calName}:`, calErr);
          }
        }
      }
    } catch (authErr) {
      console.warn('Google Calendar auth warning:', authErr);
    }

    // Sort busy blocks by start time
    busyBlocks.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());

    // 2. Fetch Active Google Tasks Backlog
    const backlogTasks: BacklogTask[] = [];

    try {
      const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
      const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;

      if (clientId && clientSecret && refreshToken) {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

        for (const [listName, listId] of Object.entries(TASKLIST_MAP)) {
          try {
            const res = await tasksApi.tasks.list({
              tasklist: listId,
              showCompleted: false,
              maxResults: 20,
            });

            for (const task of res.data.items || []) {
              if (task.status === 'completed' || !task.title) continue;
              backlogTasks.push({
                id: task.id || String(Math.random()),
                title: task.title,
                listName,
                tasklistId: listId,
                due: task.due || undefined,
                notes: task.notes || undefined,
              });
            }
          } catch (tErr) {
            console.warn(`Tasklist error for ${listName}:`, tErr);
          }
        }
      }
    } catch (tasksErr) {
      console.warn('Google Tasks backlog fetch warning:', tasksErr);
    }

    return NextResponse.json<AISchedulerContextResponse>({
      success: true,
      date: targetDate,
      busyBlocks,
      backlogTasks,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in AI Scheduler context endpoint:', errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
