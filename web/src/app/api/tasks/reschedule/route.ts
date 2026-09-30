import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { RescheduleRequest, RescheduleResponse, TaskItem, CalendarName } from '@/types/task';

export const dynamic = 'force-dynamic';

const CALENDAR_MAP: Record<string, string> = {
  'Kevin Nguyen': '24ktkn@gmail.com',
  'Family': 'family05668227215423587251@group.calendar.google.com',
  'School': '0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com',
  'Volunteering': '57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com',
};

const TASKLIST_MAP: Record<string, string> = {
  'School': 'ZGRiT21qM2ZCbVRWOVBlMQ',
  'Kevin Nguyen': '@default',
  'Family': 'Um85a3gwMVZqTXN4X0M3Wg',
  'Volunteering': 'bUtfd3ZxU0Y3RFUyM2x2dQ',
};

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

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

function parseTimeToHoursAndMinutes(timeStr?: string): { hours: number; minutes: number; formatted12h: string } {
  if (!timeStr || !timeStr.trim()) {
    return { hours: 10, minutes: 0, formatted12h: '10:00 AM' };
  }

  const raw = timeStr.trim().toLowerCase();
  const isPm = raw.includes('pm');
  const isAm = raw.includes('am');
  const numericParts = raw.replace(/[a-z\s]/gi, '').split(':');
  let h = parseInt(numericParts[0], 10) || 0;
  const m = parseInt(numericParts[1], 10) || 0;

  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;

  // Format 12h
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayM = String(m).padStart(2, '0');
  const formatted12h = `${displayH}:${displayM} ${ampm}`;

  return { hours: h, minutes: m, formatted12h };
}

export async function POST(req: NextRequest) {
  try {
    const body: RescheduleRequest = await req.json();
    const {
      taskId,
      calendarEventId,
      googleTaskId,
      schoolUid,
      title,
      calendarName = 'Kevin Nguyen',
      newDate,
      newTime,
      durationMins = 30,
      scope = 'instance',
    } = body;

    if (!newDate) {
      return NextResponse.json<RescheduleResponse>(
        { success: false, error: 'newDate (YYYY-MM-DD) is required to reschedule' },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin || supabase;
    let resolvedTask: TaskItem | null = null;
    let targetCalEventId = calendarEventId || null;
    let targetGoogleTaskId = googleTaskId || null;
    let itemTitle = title || '';
    let targetCalendarName: CalendarName = calendarName;
    let currentNotes = '';

    // 1. Resolve task in Supabase
    if (sb && taskId) {
      const { data: dbTask } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (dbTask) {
        resolvedTask = dbTask as TaskItem;
        if (!targetCalEventId && dbTask.calendar_event_id) targetCalEventId = dbTask.calendar_event_id;
        if (!targetGoogleTaskId && dbTask.google_task_id) targetGoogleTaskId = dbTask.google_task_id;
        if (!itemTitle && dbTask.title) itemTitle = dbTask.title;
        if (dbTask.calendar_name) targetCalendarName = dbTask.calendar_name as CalendarName;
        currentNotes = dbTask.notes || '';
      }
    }

    // Fallback: lookup by targetCalEventId if taskId didn't resolve
    if (!resolvedTask && sb && targetCalEventId) {
      const { data: dbByCal } = await sb.from('tasks').select('*').eq('calendar_event_id', targetCalEventId).maybeSingle();
      if (dbByCal) {
        resolvedTask = dbByCal as TaskItem;
        if (!targetGoogleTaskId && dbByCal.google_task_id) targetGoogleTaskId = dbByCal.google_task_id;
        if (!itemTitle && dbByCal.title) itemTitle = dbByCal.title;
        if (dbByCal.calendar_name) targetCalendarName = dbByCal.calendar_name as CalendarName;
        currentNotes = dbByCal.notes || '';
      }
    }

    // Fallback: lookup by targetGoogleTaskId
    if (!resolvedTask && sb && targetGoogleTaskId) {
      const { data: dbByGTask } = await sb.from('tasks').select('*').eq('google_task_id', targetGoogleTaskId).maybeSingle();
      if (dbByGTask) {
        resolvedTask = dbByGTask as TaskItem;
        if (!targetCalEventId && dbByGTask.calendar_event_id) targetCalEventId = dbByGTask.calendar_event_id;
        if (!itemTitle && dbByGTask.title) itemTitle = dbByGTask.title;
        if (dbByGTask.calendar_name) targetCalendarName = dbByGTask.calendar_name as CalendarName;
        currentNotes = dbByGTask.notes || '';
      }
    }

    const { hours, minutes, formatted12h } = parseTimeToHoursAndMinutes(newTime);
    const finalDuration = Math.max(0, parseInt(String(durationMins), 10) || 30);

    // Calculate end time
    let endTotalMins = hours * 60 + minutes + finalDuration;
    const endH = Math.floor(endTotalMins / 60) % 24;
    const endM = endTotalMins % 60;

    const pad = (n: number) => String(n).padStart(2, '0');
    const startIso = `${newDate}T${pad(hours)}:${pad(minutes)}:00`;
    const endIso = `${newDate}T${pad(endH)}:${pad(endM)}:00`;

    let patchedCalendar = false;
    let patchedTask = false;
    let patchedSchool = false;

    // 2. Google Calendar Patch
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = getPrivateKey();
    const targetCalId = CALENDAR_MAP[targetCalendarName] || CALENDAR_MAP['Kevin Nguyen'];

    if (clientEmail && privateKey) {
      try {
        const auth = new google.auth.JWT({
          email: clientEmail,
          key: privateKey,
          scopes: ['https://www.googleapis.com/auth/calendar'],
        });
        const calendarApi = google.calendar({ version: 'v3', auth });

        if (targetCalEventId) {
          try {
            // Check if this event has a recurring parent if scope is 'series'
            let eventToPatch = targetCalEventId;
            if (scope === 'series') {
              try {
                const getRes = await calendarApi.events.get({
                  calendarId: targetCalId,
                  eventId: targetCalEventId,
                });
                if (getRes.data.recurringEventId) {
                  eventToPatch = getRes.data.recurringEventId;
                }
              } catch {
                // If get fails, stick with targetCalEventId
              }
            }

            await calendarApi.events.patch({
              calendarId: targetCalId,
              eventId: eventToPatch,
              requestBody: {
                start: { dateTime: `${startIso}-04:00`, timeZone: 'America/New_York' },
                end: { dateTime: `${endIso}-04:00`, timeZone: 'America/New_York' },
              },
            });
            patchedCalendar = true;
          } catch (calPatchErr) {
            console.warn(`Direct calendar patch error for event ${targetCalEventId}:`, calPatchErr);

            // Attempt cross-calendar search if ID was mapped to different calendar
            for (const [cName, cId] of Object.entries(CALENDAR_MAP)) {
              if (cId === targetCalId) continue;
              try {
                await calendarApi.events.patch({
                  calendarId: cId,
                  eventId: targetCalEventId,
                  requestBody: {
                    start: { dateTime: `${startIso}-04:00`, timeZone: 'America/New_York' },
                    end: { dateTime: `${endIso}-04:00`, timeZone: 'America/New_York' },
                  },
                });
                patchedCalendar = true;
                targetCalendarName = cName as CalendarName;
                break;
              } catch {
                // Ignore and continue
              }
            }
          }
        }
      } catch (authErr) {
        console.warn('Calendar service account error:', authErr);
      }
    }

    // 3. Google Tasks Patch
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_TASKS_REFRESH_TOKEN;
    const targetTaskListId = TASKLIST_MAP[targetCalendarName] || TASKLIST_MAP['Kevin Nguyen'];

    if (clientId && clientSecret && refreshToken) {
      try {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

        // Build updated notes with ⏰ Scheduled
        let updatedNotes = currentNotes;
        const schedTag = `⏰ Scheduled: ${formatted12h} (${finalDuration}m)`;
        if (updatedNotes.includes('⏰ Scheduled:')) {
          updatedNotes = updatedNotes.replace(/⏰ Scheduled:[^\n]+/g, schedTag);
        } else if (updatedNotes) {
          updatedNotes = `${schedTag}\n\n${updatedNotes}`;
        } else {
          updatedNotes = schedTag;
        }

        if (targetGoogleTaskId) {
          const listCandidates = [
            targetTaskListId,
            ...Object.values(TASKLIST_MAP).filter((l) => l !== targetTaskListId),
          ];

          for (const listId of listCandidates) {
            try {
              await tasksApi.tasks.patch({
                tasklist: listId,
                task: targetGoogleTaskId,
                requestBody: {
                  due: `${newDate}T00:00:00.000Z`,
                  notes: updatedNotes,
                },
              });
              patchedTask = true;
              break;
            } catch {
              // Try next list candidate
            }
          }
        } else if (itemTitle) {
          // If no targetGoogleTaskId, search tasklists by clean title
          const cleanQ = cleanTitle(itemTitle);
          for (const listId of Object.values(TASKLIST_MAP)) {
            try {
              const listRes = await tasksApi.tasks.list({
                tasklist: listId,
                showCompleted: false,
                maxResults: 50,
              });
              const match = (listRes.data.items || []).find((t) => {
                if (!t.title) return false;
                const ct = cleanTitle(t.title);
                return ct === cleanQ || (ct.length > 5 && (ct.includes(cleanQ) || cleanQ.includes(ct)));
              });

              if (match && match.id) {
                targetGoogleTaskId = match.id;
                await tasksApi.tasks.patch({
                  tasklist: listId,
                  task: match.id,
                  requestBody: {
                    due: `${newDate}T00:00:00.000Z`,
                    notes: updatedNotes,
                  },
                });
                patchedTask = true;
                break;
              }
            } catch {
              // Ignore
            }
          }
        }
      } catch (gtErr) {
        console.warn('Google Tasks patch warning:', gtErr);
      }
    }

    // 4. Update Supabase 'tasks' table
    let updatedTaskRecord: TaskItem | null = null;
    if (sb) {
      const nowIso = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        due_date: newDate,
        due_time: formatted12h,
        duration_mins: finalDuration,
        is_completed: false, // moving/rescheduling resets completed status if it was completed
        updated_at: nowIso,
      };

      if (targetCalEventId) updatePayload.calendar_event_id = targetCalEventId;
      if (targetGoogleTaskId) updatePayload.google_task_id = targetGoogleTaskId;

      if (resolvedTask?.id) {
        const { data: updated } = await sb
          .from('tasks')
          .update(updatePayload)
          .eq('id', resolvedTask.id)
          .select()
          .single();
        if (updated) updatedTaskRecord = updated as TaskItem;
      } else if (targetCalEventId) {
        const { data: updated } = await sb
          .from('tasks')
          .update(updatePayload)
          .eq('calendar_event_id', targetCalEventId)
          .select()
          .maybeSingle();
        if (updated) updatedTaskRecord = updated as TaskItem;
      } else if (targetGoogleTaskId) {
        const { data: updated } = await sb
          .from('tasks')
          .update(updatePayload)
          .eq('google_task_id', targetGoogleTaskId)
          .select()
          .maybeSingle();
        if (updated) updatedTaskRecord = updated as TaskItem;
      }

      // 5. Update Supabase 'school_items' table if applicable
      const cleanSearch = cleanTitle(itemTitle);
      if (schoolUid) {
        await sb
          .from('school_items')
          .update({
            is_scheduled: true,
            scheduled_date: newDate,
            scheduled_time: formatted12h,
            duration_mins: finalDuration,
            target_calendar: targetCalendarName,
            is_completed: false,
            updated_at: nowIso,
          })
          .eq('uid', schoolUid);
        patchedSchool = true;
      } else if (cleanSearch) {
        const { data: schoolRows } = await sb.from('school_items').select('uid, title');
        if (schoolRows && schoolRows.length > 0) {
          const matchedUids = schoolRows
            .filter((s) => {
              const cs = cleanTitle(s.title);
              return cs === cleanSearch || (cs.length > 5 && (cs.includes(cleanSearch) || cleanSearch.includes(cs)));
            })
            .map((s) => s.uid);

          if (matchedUids.length > 0) {
            await sb
              .from('school_items')
              .update({
                is_scheduled: true,
                scheduled_date: newDate,
                scheduled_time: formatted12h,
                duration_mins: finalDuration,
                target_calendar: targetCalendarName,
                is_completed: false,
                updated_at: nowIso,
              })
              .in('uid', matchedUids);
            patchedSchool = true;
          }
        }
      }
    }

    return NextResponse.json<RescheduleResponse>({
      success: true,
      message: `Rescheduled to ${newDate} at ${formatted12h} (${finalDuration}m)`,
      updatedTask: updatedTaskRecord || undefined,
      patchedCalendar,
      patchedTask,
      patchedSchool,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in /api/tasks/reschedule:', errorMsg);
    return NextResponse.json<RescheduleResponse>(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
