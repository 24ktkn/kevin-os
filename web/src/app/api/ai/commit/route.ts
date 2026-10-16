import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { ProposedTask, ScheduledCommitItem, AICommitResponse } from '@/types/ai';
import { computeStartEndIso, format24hTo12h, parseTimeToHoursMinutes, getTodayDateStr } from '@/lib/date-utils';
import {
  CALENDAR_MAP,
  TASKLIST_MAP,
  getGoogleCalendarClient,
  getGoogleTasksClient,
} from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { targetDate: rawDate, tasks = [] } = body;
    const targetDate = rawDate || getTodayDateStr();

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ error: 'No tasks to commit' }, { status: 400 });
    }

    const scheduledItems: ScheduledCommitItem[] = [];
    let createdEventsCount = 0;
    let createdTasksCount = 0;

    const calendarApi = getGoogleCalendarClient();
    const { tasksApi, hasCredentials } = getGoogleTasksClient();
    const sb = supabaseAdmin || supabase;
    const supabaseRowsToInsert: Record<string, unknown>[] = [];
    const nowIso = new Date().toISOString();

    await Promise.all(
      (tasks as ProposedTask[]).map(async (task) => {
        const calName = task.calendar || 'Kevin Nguyen';
        const targetCalId = CALENDAR_MAP[calName] || CALENDAR_MAP['Kevin Nguyen'];
        const targetTaskListId = TASKLIST_MAP[calName] || TASKLIST_MAP['Kevin Nguyen'];

        const { hours, minutes } = parseTimeToHoursMinutes(task.startTime24h || '09:00');
        const startTime12h = task.startTimeFormatted || format24hTo12h(hours, minutes);
        const dur = task.durationMins || 30;
        const { startDateTime, endDateTime } = computeStartEndIso(targetDate, startTime12h, dur);

        let calEventId = '';
        let googleTaskId = '';
        const eventSummary = `🎓 [Task] ${task.itemName}`;

        await Promise.all([
          // A. Insert into Google Calendar
          (async () => {
            if (!calendarApi) return;
            try {
              const calRes = await calendarApi.events.insert({
                calendarId: targetCalId,
                requestBody: {
                  summary: eventSummary,
                  description: `AI Scheduled Timeblock (${dur}m)\nReasoning: ${task.reasoning || 'Autonomous slot optimization'}`,
                  start: { dateTime: startDateTime, timeZone: 'America/New_York' },
                  end: { dateTime: endDateTime, timeZone: 'America/New_York' },
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
          })(),

          // B. Insert into Google Tasks
          (async () => {
            if (!tasksApi || !hasCredentials) return;
            try {
              const taskRes = await tasksApi.tasks.insert({
                tasklist: targetTaskListId,
                requestBody: {
                  title: task.itemName,
                  notes: `⏰ Scheduled: ${startTime12h} (${dur}m)\nCalendar: [${calName}]`,
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
          })(),
        ]);

        // C. Queue both 'Event' and 'Task' rows for batched Supabase insert
        supabaseRowsToInsert.push(
          {
            id: crypto.randomUUID(),
            title: eventSummary,
            type: 'Event',
            calendar_name: calName,
            due_date: targetDate,
            due_time: startTime12h,
            duration_mins: dur,
            location: '',
            notes: task.reasoning || 'AI Scheduled Timeblock',
            calendar_event_id: calEventId || null,
            google_task_id: googleTaskId || null,
            is_scheduled: true,
            is_completed: false,
            created_at: nowIso,
            updated_at: nowIso,
          },
          {
            id: crypto.randomUUID(),
            title: task.itemName,
            type: 'Task',
            calendar_name: calName,
            due_date: targetDate,
            due_time: startTime12h,
            duration_mins: dur,
            location: '',
            notes: task.reasoning || 'AI Scheduled Timeblock',
            calendar_event_id: calEventId || null,
            google_task_id: googleTaskId || null,
            is_scheduled: true,
            is_completed: false,
            created_at: nowIso,
            updated_at: nowIso,
          }
        );
      })
    );

    if (sb && supabaseRowsToInsert.length > 0) {
      try {
        await sb.from('tasks').insert(supabaseRowsToInsert);
      } catch (sbErr) {
        console.warn('Failed to batch-insert AI scheduled tasks into Supabase:', sbErr);
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
    return NextResponse.json(
      {
        success: false,
        createdEventsCount: 0,
        createdTasksCount: 0,
        scheduledItems: [],
        message: '',
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
