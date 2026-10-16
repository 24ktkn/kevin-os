import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { ScheduledCommitItem } from '@/types/ai';
import { getGoogleCalendarClient, getGoogleTasksClient } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items = [] } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No items to undo' }, { status: 400 });
    }

    let deletedCount = 0;
    const calendarApi = getGoogleCalendarClient();
    const { tasksApi, hasCredentials } = getGoogleTasksClient();
    const sb = supabaseAdmin || supabase;

    const eventIdsToDelete: string[] = [];
    const taskIdsToDelete: string[] = [];

    await Promise.all(
      (items as ScheduledCommitItem[]).map(async (item) => {
        if (item.type === 'event' && item.id) {
          eventIdsToDelete.push(item.id);
          if (calendarApi && item.calendarId) {
            try {
              await calendarApi.events.delete({
                calendarId: item.calendarId,
                eventId: item.id,
              });
              deletedCount++;
            } catch (e) {
              console.warn(`Failed to delete calendar event ${item.id}:`, e);
            }
          }
        } else if (item.type === 'task' && item.id) {
          taskIdsToDelete.push(item.id);
          if (tasksApi && hasCredentials && item.tasklistId) {
            try {
              await tasksApi.tasks.delete({
                tasklist: item.tasklistId,
                task: item.id,
              });
              deletedCount++;
            } catch (e) {
              console.warn(`Failed to delete Google task ${item.id}:`, e);
            }
          }
        }
      })
    );

    if (sb) {
      await Promise.all([
        (async () => {
          if (eventIdsToDelete.length === 0) return;
          try {
            await sb.from('tasks').delete().in('calendar_event_id', eventIdsToDelete);
          } catch {
            // ignore
          }
        })(),
        (async () => {
          if (taskIdsToDelete.length === 0) return;
          try {
            await sb.from('tasks').delete().in('google_task_id', taskIdsToDelete);
          } catch {
            // ignore
          }
        })(),
      ]);
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Successfully undone and removed ${deletedCount} scheduled items from Google Cloud & Supabase!`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error undoing schedule:', errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
