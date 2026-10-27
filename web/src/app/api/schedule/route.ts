import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { computeStartEndIso } from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClientAsync,
} from '@/lib/google-calendar';

const RRULE_MAP: Record<string, string> = {
  'Daily': 'RRULE:FREQ=DAILY',
  'Weekly': 'RRULE:FREQ=WEEKLY',
  'Monthly': 'RRULE:FREQ=MONTHLY',
  'Every Weekday (Mon-Fri)': 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      title,
      description,
      location,
      date,
      time,
      duration,
      calendar: calCat,
      skipCalendar,
      skipTask,
      isStandaloneEvent,
      repeat,
      recurrenceRule,
    } = body;

    if (!title || !date) {
      return NextResponse.json({ error: 'Missing required title or date' }, { status: 400 });
    }

    const durationMins = parseInt(duration, 10) || 60;
    const targetCalId = CALENDAR_MAP[calCat] || CALENDAR_MAP['Kevin Nguyen'] || CALENDAR_MAP['School'];
    const targetTaskListId = TASKLIST_MAP[calCat] || TASKLIST_MAP['Kevin Nguyen'] || TASKLIST_MAP['School'];

    const eventTime = time ? time.trim() : '10:00 AM';
    const rrule = recurrenceRule || (repeat && RRULE_MAP[repeat] ? RRULE_MAP[repeat] : null);

    const { startDateTime, endDateTime } = computeStartEndIso(date, eventTime, durationMins);

    let calendarEventId: string | null = null;
    let calendarError: string | null = null;
    let taskId: string | null = null;
    let taskError: string | null = null;

    const eventSummary = isStandaloneEvent ? title.trim() : `🎓 [Task] ${title.trim()}`;
    const shouldCreateTask = !isStandaloneEvent && !skipTask;

    const calendarApi = getGoogleCalendarClient();
    const { tasksApi, hasCredentials } = await getGoogleTasksClientAsync();

    // 1 & 2. Run Google Calendar insert and Google Tasks insert in parallel
    await Promise.all([
      (async () => {
        if (skipCalendar || !calendarApi) return;
        try {
          const calReqBody: Record<string, unknown> = {
            summary: eventSummary,
            description: description || '',
            location: location || '',
            start: { dateTime: startDateTime, timeZone: 'America/New_York' },
            end: { dateTime: endDateTime, timeZone: 'America/New_York' },
          };
          if (rrule) {
            calReqBody.recurrence = [rrule];
          }

          const calRes = await calendarApi.events.insert({
            calendarId: targetCalId,
            requestBody: calReqBody,
          });

          calendarEventId = calRes.data.id || null;
        } catch (calErr: unknown) {
          calendarError = calErr instanceof Error ? calErr.message : 'Calendar insertion error';
          console.error('Calendar error:', calendarError);
        }
      })(),

      (async () => {
        if (!shouldCreateTask || !tasksApi || !hasCredentials) return;
        try {
          const taskRes = await tasksApi.tasks.insert({
            tasklist: targetTaskListId,
            requestBody: {
              title: title.trim(),
              notes: `⏰ Scheduled: ${eventTime} (${durationMins}m)\n\n${description || ''}`,
              due: `${date}T00:00:00.000Z`,
            },
          });

          taskId = taskRes.data.id || null;
        } catch (tErr: unknown) {
          taskError = tErr instanceof Error ? tErr.message : 'Tasks insertion error';
          console.error('Google Tasks error:', taskError);
        }
      })(),
    ]);

    const sb = supabaseAdmin || supabase;
    let createdItem = null;

    if (sb) {
      const nowIso = new Date().toISOString();
      const rowsToInsert: Record<string, unknown>[] = [];

      if (isStandaloneEvent || calendarEventId) {
        rowsToInsert.push({
          id: crypto.randomUUID(),
          title: eventSummary,
          type: 'Event',
          calendar_name: calCat || 'Kevin Nguyen',
          due_date: date,
          due_time: eventTime,
          duration_mins: durationMins,
          location: location || '',
          notes: description || '',
          calendar_event_id: calendarEventId,
          google_task_id: taskId,
          recurrence_rule: rrule || null,
          is_scheduled: true,
          is_completed: false,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      if (shouldCreateTask) {
        rowsToInsert.push({
          id: crypto.randomUUID(),
          title: title.trim(),
          type: 'Task',
          calendar_name: calCat || 'School',
          due_date: date,
          due_time: skipCalendar ? '' : eventTime,
          duration_mins: skipCalendar ? 0 : durationMins,
          location: location || '',
          notes: description || '',
          google_task_id: taskId,
          calendar_event_id: calendarEventId,
          recurrence_rule: rrule || null,
          is_scheduled: Boolean(calendarEventId),
          is_completed: false,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      if (rowsToInsert.length > 0) {
        const { data: insertedRows } = await sb.from('tasks').insert(rowsToInsert).select();
        createdItem = (insertedRows && insertedRows[0]) || rowsToInsert[0];
      }
    }

    return NextResponse.json({
      success: true,
      calendarEventId,
      calendarError,
      taskId,
      taskError,
      item: createdItem,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Schedule route error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
