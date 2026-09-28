import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase } from '@/lib/supabase';

const TASKLIST_MAP: Record<string, string> = {
  'School': 'ZGRiT21qM2ZCbVRWOVBlMQ',
  'Kevin Nguyen': '@default',
  'Family': 'Um85a3gwMVZqTXN4X0M3Wg',
  'Volunteering': 'bUtfd3ZxU0Y3RFUyM2x2dQ',
};

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json({ error: 'Google Tasks credentials not configured' }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

    const completedTitles: string[] = [];

    // Query School task list
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
            completedTitles.push(item.title);
          }
        }
      } catch (err) {
        console.error(`Error querying tasklist ${listId}:`, err);
      }
    }

    // Sync completions to Supabase
    if (supabase && completedTitles.length > 0) {
      for (const title of completedTitles) {
        await supabase
          .from('school_items')
          .update({ is_completed: true, updated_at: new Date().toISOString() })
          .eq('title', title)
          .eq('is_completed', false);
      }
    }

    return NextResponse.json({
      success: true,
      completedTitles,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
