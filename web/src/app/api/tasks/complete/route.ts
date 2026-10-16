import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { cleanTaskTitle, titlesMatch } from '@/lib/date-utils';
import { TASKLIST_MAP, getGoogleTasksClient } from '@/lib/google-calendar';

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

    // 1. Fetch tasks and school_items in 1 parallel round-trip
    let allTasks: { id: string; google_task_id: string | null; calendar_name: string | null; title: string }[] = [];
    let allSchool: { uid: string; title: string }[] = [];

    if (sb) {
      const [tasksRes, schoolRes] = await Promise.all([
        sb.from('tasks').select('id, google_task_id, calendar_name, title'),
        sb.from('school_items').select('uid, title'),
      ]);
      allTasks = (tasksRes.data || []) as typeof allTasks;
      allSchool = (schoolRes.data || []) as typeof allSchool;

      if (taskId) {
        const dbTask = allTasks.find((t) => t.id === taskId);
        if (dbTask) {
          if (!targetGoogleTaskId && dbTask.google_task_id) targetGoogleTaskId = dbTask.google_task_id;
          if (!targetListId && dbTask.calendar_name) targetListId = TASKLIST_MAP[dbTask.calendar_name] || null;
          if (!taskTitle && dbTask.title) taskTitle = dbTask.title;
        }
      }
    }

    const cleanedQuery = cleanTaskTitle(taskTitle);

    if (!targetGoogleTaskId && cleanedQuery) {
      const match = allTasks.find((t) => t.google_task_id && titlesMatch(t.title, taskTitle));
      if (match) {
        targetGoogleTaskId = match.google_task_id;
        if (!targetListId && match.calendar_name) targetListId = TASKLIST_MAP[match.calendar_name] || null;
      }
    }

    // 2. Patch Google Tasks
    const { tasksApi, hasCredentials } = getGoogleTasksClient();
    let patched = false;
    let patchError: string | null = null;

    if (tasksApi && hasCredentials) {
      try {
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

        if (!patched && cleanedQuery) {
          const listOrder = targetListId
            ? [targetListId, ...Object.values(TASKLIST_MAP).filter((l) => l !== targetListId)]
            : Object.values(TASKLIST_MAP);

          const listResponses = await Promise.all(
            listOrder.map(async (listId) => {
              try {
                const listRes = await tasksApi.tasks.list({
                  tasklist: listId,
                  showCompleted: true,
                  showHidden: true,
                  maxResults: 100,
                });
                return { listId, items: listRes.data.items || [] };
              } catch {
                return { listId, items: [] };
              }
            })
          );

          for (const { listId, items } of listResponses) {
            const found = items.find((item) => item.title && titlesMatch(item.title, taskTitle));
            if (found?.id) {
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
          }
        }
      } catch (err: unknown) {
        patchError = err instanceof Error ? err.message : String(err);
        console.error('Google Tasks API error:', patchError);
      }
    } else {
      patchError = 'Missing Google Tasks OAuth2 credentials';
    }

    // 3. Batch-update Supabase tasks & school_items records in parallel
    if (sb) {
      const nowIso = new Date().toISOString();
      const matchingTaskIds = new Set<string>();
      if (taskId) matchingTaskIds.add(taskId);

      for (const t of allTasks) {
        if (targetGoogleTaskId && t.google_task_id === targetGoogleTaskId) {
          matchingTaskIds.add(t.id);
        } else if (cleanedQuery && titlesMatch(t.title, taskTitle)) {
          matchingTaskIds.add(t.id);
        }
      }

      const matchingSchoolUids = cleanedQuery
        ? allSchool.filter((s) => titlesMatch(s.title, taskTitle)).map((s) => s.uid)
        : [];

      await Promise.all([
        (async () => {
          if (matchingTaskIds.size === 0) return;
          const taskUpdates: Record<string, unknown> = {
            is_completed: completed,
            updated_at: nowIso,
          };
          if (targetGoogleTaskId) {
            taskUpdates.google_task_id = targetGoogleTaskId;
          }
          await sb.from('tasks').update(taskUpdates).in('id', Array.from(matchingTaskIds));
        })(),

        (async () => {
          if (matchingSchoolUids.length === 0) return;
          await sb
            .from('school_items')
            .update({ is_completed: completed, updated_at: nowIso })
            .in('uid', matchingSchoolUids);
        })(),
      ]);
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
