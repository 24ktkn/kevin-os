import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

const CALENDAR_MAP: Record<string, string> = {
  'Kevin Nguyen': '24ktkn@gmail.com',
  'Family': 'family05668227215423587251@group.calendar.google.com',
  'School': '0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com',
  'Volunteering': '57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com',
};

const TASKLIST_MAP: Record<string, string> = {
  'Kevin Nguyen': '@default',
  'Family': 'Um85a3gwMVZqTXN4X0M3Wg',
  'School': 'ZGRiT21qM2ZCbVRWOVBlMQ',
  'Volunteering': 'bUtfd3ZxU0Y3RFUyM2x2dQ',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, description, date, time, duration, calendar: calCat, skipCalendar } = body;

    if (!title || !date || !time) {
      return NextResponse.json({ error: 'Missing required schedule fields' }, { status: 400 });
    }

    const durationMins = parseInt(duration, 10) || 60;
    const targetCalId = CALENDAR_MAP[calCat] || CALENDAR_MAP['School'];
    const targetTaskListId = TASKLIST_MAP[calCat] || TASKLIST_MAP['School'];

    // Parse time supporting both "10:00 AM" / "02:30 PM" and 24h formats
    const cleaned = time.trim().toLowerCase();
    const isPm = cleaned.includes('pm');
    const isAm = cleaned.includes('am');
    const parts = cleaned.replace(/am|pm/g, '').trim().split(':');
    let hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    if (isPm && hours < 12) hours += 12;
    if (isAm && hours === 12) hours = 0;

    const [y, m, d] = date.split('-').map((v: string) => parseInt(v, 10));
    const startDt = new Date(y, m - 1, d, hours, minutes, 0);
    const endDt = new Date(startDt.getTime() + durationMins * 60 * 1000);

    const pad = (n: number) => n.toString().padStart(2, '0');
    const formatLocalIso = (dt: Date) =>
      `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;

    const startIso = formatLocalIso(startDt);
    const endIso = formatLocalIso(endDt);

    let calendarEventId: string | null = null;
    let calendarError: string | null = null;
    let taskId: string | null = null;
    let taskError: string | null = null;

    // 1. Insert Google Calendar Timeblock (Service Account) unless skipCalendar is true
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!skipCalendar && clientEmail && rawPrivateKey) {
      try {
        const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
        const jwtClient = new google.auth.JWT({
          email: clientEmail,
          key: privateKey,
          scopes: ['https://www.googleapis.com/auth/calendar'],
        });

        const calendarApi = google.calendar({ version: 'v3', auth: jwtClient });

        const calRes = await calendarApi.events.insert({
          calendarId: targetCalId,
          requestBody: {
            summary: `🎓 [Task] ${title}`,
            description: description || '',
            start: { dateTime: `${startIso}-04:00` },
            end: { dateTime: `${endIso}-04:00` },
          },
        });

        calendarEventId = calRes.data.id || null;
      } catch (calErr: unknown) {
        calendarError = calErr instanceof Error ? calErr.message : 'Calendar insertion error';
        console.error('Calendar error:', calendarError);
      }
    }

    // 2. Insert Google Task (OAuth)
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

        const taskRes = await tasksApi.tasks.insert({
          tasklist: targetTaskListId,
          requestBody: {
            title,
            notes: `⏰ Scheduled: ${time}\n\n${description || ''}`,
            due: `${date}T00:00:00.000Z`,
          },
        });

        taskId = taskRes.data.id || null;
      } catch (tErr: unknown) {
        taskError = tErr instanceof Error ? tErr.message : 'Tasks insertion error';
        console.error('Google Tasks error:', taskError);
      }
    }

    // Overall success if either calendar or task succeeded
    const overallSuccess = Boolean(calendarEventId || taskId);

    return NextResponse.json({
      success: overallSuccess,
      calendarEventId,
      calendarError,
      taskId,
      taskError,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Schedule route error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
