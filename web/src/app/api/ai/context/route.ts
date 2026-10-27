import { NextRequest, NextResponse } from 'next/server';
import {
  CalendarBusyBlock,
  BacklogTask,
  AISchedulerContextResponse,
} from '@/types/ai';
import { getTodayDateStr, getTimezoneOffsetStr } from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClientAsync,
} from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');

    const targetDate = dateParam || getTodayDateStr();
    const tzOffset = getTimezoneOffsetStr(targetDate);

    // Day bounds: 8:00 AM to 10:00 PM in America/New_York
    const timeMin = `${targetDate}T08:00:00${tzOffset}`;
    const timeMax = `${targetDate}T22:00:00${tzOffset}`;

    const busyBlocks: CalendarBusyBlock[] = [];
    const backlogTasks: BacklogTask[] = [];

    const calendarApi = getGoogleCalendarClient();
    const { tasksApi, hasCredentials } = await getGoogleTasksClientAsync();

    // Fetch all 4 Google Calendars and all 4 Google Tasklists concurrently
    await Promise.all([
      (async () => {
        if (!calendarApi) return;
        const calResults = await Promise.all(
          Object.entries(CALENDAR_MAP).map(async ([calName, calId]) => {
            try {
              const res = await calendarApi.events.list({
                calendarId: calId,
                timeMin,
                timeMax,
                singleEvents: true,
                showDeleted: false,
                orderBy: 'startTime',
              });
              return { calName, items: res.data.items || [] };
            } catch (calErr) {
              console.warn(`Calendar error for ${calName}:`, calErr);
              return { calName, items: [] };
            }
          })
        );

        for (const { calName, items } of calResults) {
          for (const event of items) {
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
              id: event.id || undefined,
              calendar: calName,
              title: event.summary || 'Busy',
              startIso: startDateTime,
              endIso: endDateTime,
              startTime: startFmt,
              endTime: endFmt,
            });
          }
        }
      })(),

      (async () => {
        if (!tasksApi || !hasCredentials) return;
        const taskResults = await Promise.all(
          Object.entries(TASKLIST_MAP).map(async ([listName, listId]) => {
            try {
              const res = await tasksApi.tasks.list({
                tasklist: listId,
                showCompleted: false,
                maxResults: 20,
              });
              return { listName, listId, items: res.data.items || [] };
            } catch (tErr) {
              console.warn(`Tasklist error for ${listName}:`, tErr);
              return { listName, listId, items: [] };
            }
          })
        );

        for (const { listName, listId, items } of taskResults) {
          for (const task of items) {
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
        }
      })(),
    ]);

    busyBlocks.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());

    return NextResponse.json<AISchedulerContextResponse>({
      success: true,
      date: targetDate,
      busyBlocks,
      backlogTasks,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in AI Scheduler context endpoint:', errorMsg);
    return NextResponse.json({ success: false, date: '', busyBlocks: [], backlogTasks: [], error: errorMsg }, { status: 500 });
  }
}
