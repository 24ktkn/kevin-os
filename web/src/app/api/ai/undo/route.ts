import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase } from '@/lib/supabase';
import { ScheduledCommitItem } from '@/types/ai';

export const dynamic = 'force-dynamic';

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items = [] } = body;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No items to undo' }, { status: 400 });
    }

    let deletedCount = 0;

    // 1. Google Calendar API
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

    // 2. Google Tasks API
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;
    let tasksApi: ReturnType<typeof google.tasks> | null = null;

    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
    }

    for (const item of items as ScheduledCommitItem[]) {
      if (item.type === 'event' && calendarApi && item.calendarId && item.id) {
        try {
          await calendarApi.events.delete({
            calendarId: item.calendarId,
            eventId: item.id,
          });
          deletedCount++;
        } catch (e) {
          console.warn(`Failed to delete calendar event ${item.id}:`, e);
        }

        if (supabase) {
          try {
            await supabase.from('tasks').delete().eq('calendar_event_id', item.id);
          } catch {
            // ignore
          }
        }
      } else if (item.type === 'task' && tasksApi && item.tasklistId && item.id) {
        try {
          await tasksApi.tasks.delete({
            tasklist: item.tasklistId,
            task: item.id,
          });
          deletedCount++;
        } catch (e) {
          console.warn(`Failed to delete Google task ${item.id}:`, e);
        }

        if (supabase) {
          try {
            await supabase.from('tasks').delete().eq('google_task_id', item.id);
          } catch {
            // ignore
          }
        }
      }
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
