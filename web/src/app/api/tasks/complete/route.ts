import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';

const TASKLIST_MAP: Record<string, string> = {
  'School': 'ZGRiT21qM2ZCbVRWOVBlMQ',
  'Kevin Nguyen': '@default',
  'Family': 'Um85a3gwMVZqTXN4X0M3Wg',
  'Volunteering': 'bUtfd3ZxU0Y3RFUyM2x2dQ',
};

function cleanTitle(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\,/g, ',')
    .replace(/\\/g, '')
    .replace(/^[🎓📚📝⏰\s\[\]Task:]+/gi, '')
    .replace(/^\(\s*\d+\s*(?:mins?|minutes?|hours?|hrs?)\s*\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      taskId,
      googleTaskId,
      title,
      calendar_name,
      completed,
    }: {
      taskId?: string;
      googleTaskId?: string;
      title?: string;
      calendar_name?: string;
      completed: boolean;
    } = body;

    const sb = supabaseAdmin || supabase;
    let targetGoogleTaskId = googleTaskId || null;
    let targetListId = calendar_name ? (TASKLIST_MAP[calendar_name] || null) : null;
    let taskTitle = title || '';

    // 1. If no googleTaskId but taskId provided, lookup in Supabase
    if (!targetGoogleTaskId && taskId && sb) {
      const { data: dbTask } = await sb
        .from('tasks')
        .select('id, google_task_id, calendar_name, title')
        .eq('id', taskId)
        .maybeSingle();

      if (dbTask) {
        if (dbTask.google_task_id) targetGoogleTaskId = dbTask.google_task_id;
        if (!targetListId && dbTask.calendar_name) targetListId = TASKLIST_MAP[dbTask.calendar_name] || null;
        if (!taskTitle && dbTask.title) taskTitle = dbTask.title;
      }
    }

    // 2. If still no googleTaskId, lookup in Supabase by matching clean title
    const cleanedQuery = cleanTitle(taskTitle);
    if (!targetGoogleTaskId && sb && cleanedQuery) {
      const { data: matchedDbTasks } = await sb
        .from('tasks')
        .select('id, google_task_id, calendar_name, title')
        .not('google_task_id', 'is', null);

      if (matchedDbTasks && matchedDbTasks.length > 0) {
        const match = matchedDbTasks.find((t) => {
          const c = cleanTitle(t.title);
          return c === cleanedQuery || (c.length > 5 && (c.includes(cleanedQuery) || cleanedQuery.includes(c)));
        });
        if (match) {
          targetGoogleTaskId = match.google_task_id;
          if (!targetListId && match.calendar_name) targetListId = TASKLIST_MAP[match.calendar_name] || null;
        }
      }
    }

    // 3. Setup Google Tasks API client
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;

    let patched = false;
    let patchError: string | null = null;

    if (clientId && clientSecret && refreshToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

        // 3a. Direct patch by targetGoogleTaskId
        if (targetGoogleTaskId) {
          const listCandidates = targetListId
            ? [targetListId, ...Object.values(TASKLIST_MAP).filter((l) => l !== targetListId)]
            : Object.values(TASKLIST_MAP);

          for (const listId of listCandidates) {
            try {
              await tasksApi.tasks.patch({
                tasklist: listId,
                task: targetGoogleTaskId,
                requestBody: {
                  status: completed ? 'completed' : 'needsAction',
                  completed: completed ? new Date().toISOString() : null,
                },
              });
              patched = true;
              targetListId = listId;
              break;
            } catch {
              // Try next task list
            }
          }
        }

        // 3b. Search Google Tasks across tasklists if not patched yet
        if (!patched && cleanedQuery) {
          const listOrder = targetListId
            ? [targetListId, ...Object.values(TASKLIST_MAP).filter((l) => l !== targetListId)]
            : Object.values(TASKLIST_MAP);

          for (const listId of listOrder) {
            try {
              const listRes = await tasksApi.tasks.list({
                tasklist: listId,
                showCompleted: true,
                showHidden: true,
                maxResults: 100,
              });
              const items = listRes.data.items || [];
              const found = items.find((item) => {
                if (!item.title) return false;
                const c = cleanTitle(item.title);
                return c === cleanedQuery || (c.length > 5 && (c.includes(cleanedQuery) || cleanedQuery.includes(c)));
              });

              if (found && found.id) {
                targetGoogleTaskId = found.id;
                targetListId = listId;
                await tasksApi.tasks.patch({
                  tasklist: listId,
                  task: found.id,
                  requestBody: {
                    status: completed ? 'completed' : 'needsAction',
                    completed: completed ? new Date().toISOString() : null,
                  },
                });
                patched = true;
                break;
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`Error searching tasklist ${listId}:`, msg);
            }
          }
        }
      } catch (err: unknown) {
        patchError = err instanceof Error ? err.message : String(err);
        console.error('Google Tasks API error:', patchError);
      }
    } else {
      patchError = 'Missing Google Tasks OAuth2 credentials';
    }

    // 4. Update Supabase tasks & school_items records
    if (sb) {
      const nowIso = new Date().toISOString();

      if (taskId) {
        const updateData: Record<string, unknown> = {
          is_completed: completed,
          updated_at: nowIso,
        };
        if (targetGoogleTaskId) {
          updateData.google_task_id = targetGoogleTaskId;
        }
        await sb.from('tasks').update(updateData).eq('id', taskId);
      }

      if (targetGoogleTaskId) {
        await sb
          .from('tasks')
          .update({ is_completed: completed, updated_at: nowIso })
          .eq('google_task_id', targetGoogleTaskId);
      }

      if (cleanedQuery) {
        // Update any matching tasks in tasks table
        const { data: allTasks } = await sb.from('tasks').select('id, title');
        if (allTasks && allTasks.length > 0) {
          const matchingIds = allTasks
            .filter((t) => {
              const c = cleanTitle(t.title);
              return c === cleanedQuery || (c.length > 5 && (c.includes(cleanedQuery) || cleanedQuery.includes(c)));
            })
            .map((t) => t.id);

          if (matchingIds.length > 0) {
            const taskUpdates: Record<string, unknown> = {
              is_completed: completed,
              updated_at: nowIso,
            };
            if (targetGoogleTaskId) {
              taskUpdates.google_task_id = targetGoogleTaskId;
            }
            await sb.from('tasks').update(taskUpdates).in('id', matchingIds);
          }
        }

        // Update matching school items in school_items table
        const { data: allSchool } = await sb.from('school_items').select('uid, title');
        if (allSchool && allSchool.length > 0) {
          const matchingUids = allSchool
            .filter((s) => {
              const c = cleanTitle(s.title);
              return c === cleanedQuery || (c.length > 5 && (c.includes(cleanedQuery) || cleanedQuery.includes(c)));
            })
            .map((s) => s.uid);

          if (matchingUids.length > 0) {
            await sb
              .from('school_items')
              .update({ is_completed: completed, updated_at: nowIso })
              .in('uid', matchingUids);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      patched,
      googleTaskId: targetGoogleTaskId,
      tasklistId: targetListId,
      patchError,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Task complete route error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
