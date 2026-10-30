import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { computeStartEndIso, cleanTaskTitle, titlesMatch } from '@/lib/date-utils';
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
    const sb = supabaseAdmin || supabase;

    // Check if an active task/timeblock with the same title already exists in Supabase (prevents duplicate timeblocks)
    let existingEventRow: { id: string; calendar_event_id: string | null; google_task_id: string | null } | null = null;
    let existingTaskRow: { id: string; calendar_event_id: string | null; google_task_id: string | null } | null = null;

    if (sb && !isStandaloneEvent && cleanTaskTitle(title)) {
      const { data: activeRows } = await sb
        .from('tasks')
        .select('id, title, type, calendar_event_id, google_task_id')
        .eq('is_completed', false);

      if (activeRows) {
        for (const r of activeRows) {
          if (!r.title || !titlesMatch(r.title, title)) continue;
          if (r.type === 'Event' && !existingEventRow) {
            existingEventRow = r;
            if (r.calendar_event_id) calendarEventId = r.calendar_event_id;
            if (r.google_task_id && !taskId) taskId = r.google_task_id;
          } else if (r.type === 'Task' && !existingTaskRow) {
            existingTaskRow = r;
            if (r.google_task_id) taskId = r.google_task_id;
            if (r.calendar_event_id && !calendarEventId) calendarEventId = r.calendar_event_id;
          }
        }
      }
    }

    // 1 & 2. Run Google Calendar insert/patch and Google Tasks insert/patch in parallel
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

          if (calendarEventId && !isStandaloneEvent) {
            try {
              await calendarApi.events.patch({
                calendarId: targetCalId,
                eventId: calendarEventId,
                requestBody: calReqBody,
              });
              return;
            } catch {
              // If old event ID was deleted on Google Calendar, fall through to insert
              calendarEventId = null;
            }
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
          const taskBody = {
            title: title.trim(),
            notes: `⏰ Scheduled: ${eventTime} (${durationMins}m)\n\n${description || ''}`,
            due: `${date}T00:00:00.000Z`,
          };

          if (taskId) {
            try {
              await tasksApi.tasks.patch({
                tasklist: targetTaskListId,
                task: taskId,
                requestBody: taskBody,
              });
              return;
            } catch {
              taskId = null;
            }
          }

          const taskRes = await tasksApi.tasks.insert({
            tasklist: targetTaskListId,
            requestBody: taskBody,
          });

          taskId = taskRes.data.id || null;
        } catch (tErr: unknown) {
          taskError = tErr instanceof Error ? tErr.message : 'Tasks insertion error';
          console.error('Google Tasks error:', taskError);
        }
      })(),
    ]);

    let createdItem = null;

    if (sb) {
      const nowIso = new Date().toISOString();
      const rowsToInsert: Record<string, unknown>[] = [];

      if (isStandaloneEvent || calendarEventId) {
        const eventPayload = {
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
          is_scheduled: true,
          is_completed: false,
          updated_at: nowIso,
        };

        if (existingEventRow && !isStandaloneEvent) {
          const { data: updatedEv } = await sb
            .from('tasks')
            .update(eventPayload)
            .eq('id', existingEventRow.id)
            .select()
            .single();
          createdItem = updatedEv || { id: existingEventRow.id, ...eventPayload };
        } else {
          rowsToInsert.push({
            id: crypto.randomUUID(),
            ...eventPayload,
            created_at: nowIso,
          });
        }
      }

      if (shouldCreateTask) {
        const taskPayload = {
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
          is_scheduled: Boolean(calendarEventId),
          is_completed: false,
          updated_at: nowIso,
        };

        if (existingTaskRow) {
          const { data: updatedTk } = await sb
            .from('tasks')
            .update(taskPayload)
            .eq('id', existingTaskRow.id)
            .select()
            .single();
          if (!createdItem) createdItem = updatedTk || { id: existingTaskRow.id, ...taskPayload };
        } else {
          rowsToInsert.push({
            id: crypto.randomUUID(),
            ...taskPayload,
            created_at: nowIso,
          });
        }
      }

      if (rowsToInsert.length > 0) {
        const { data: insertedRows, error: insertErr } = await sb
          .from('tasks')
          .insert(rowsToInsert)
          .select();
        if (insertErr) {
          console.error('Supabase tasks insert error in /api/schedule:', insertErr.message);
        }
        if (!createdItem) {
          createdItem = (insertedRows && insertedRows[0]) || rowsToInsert[0];
        }
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
