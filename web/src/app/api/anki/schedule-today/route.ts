import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  computeAnkiStudyPlan,
  isMissingAnkiTableError,
} from '@/lib/anki-utils';
import {
  CALENDAR_MAP,
  getGoogleCalendarClient,
} from '@/lib/google-calendar';
import {
  BusyInterval,
  findFirstEmptySlot,
  getCurrentEasternMinsRoundedUp,
  planRolloverTimeSlotsWithAI,
} from '@/lib/ai-rollover-scheduler';
import { getElentraBusyBlocksForDate } from '@/lib/elentra-calendar';
import {
  DEFAULT_TIMEZONE,
  format24hTo12h,
  getCalendarDateString,
  getProductivityDateStr,
  getTimezoneOffsetStr,
  getTodayDateStr,
  parseTimeToHoursMinutes,
} from '@/lib/date-utils';
import { POST as schedulePost } from '@/app/api/schedule/route';
import { CalendarName } from '@/types/task';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function fetchBusyForDate(dateStr: string): Promise<BusyInterval[]> {
  const calendarApi = getGoogleCalendarClient();
  const tzOffset = getTimezoneOffsetStr(dateStr);
  const timeMin = `${dateStr}T00:00:00${tzOffset}`;
  const timeMax = `${dateStr}T23:59:59${tzOffset}`;

  const [gcalBlocks, elentraBlocks] = await Promise.all([
    calendarApi
      ? Promise.all(
          Object.entries(CALENDAR_MAP).map(async ([calName, calId]) => {
            try {
              const res = await calendarApi.events.list({
                calendarId: calId,
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
              });
              const out: BusyInterval[] = [];
              for (const ev of res.data.items || []) {
                if (!ev.start?.dateTime) continue;
                const evDate = getCalendarDateString(new Date(ev.start.dateTime));
                if (evDate !== dateStr) continue;
                const start = new Date(ev.start.dateTime);
                const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : new Date(start.getTime() + 3600_000);
                const durMins = Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000));
                const startTime12h = start.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                  timeZone: DEFAULT_TIMEZONE,
                });
                const { hours, minutes } = parseTimeToHoursMinutes(startTime12h);
                const startMins = hours * 60 + minutes;
                const endMins = startMins + durMins;
                out.push({
                  id: ev.id || undefined,
                  title: ev.summary || '(Busy)',
                  calendar: calName,
                  startMins,
                  endMins,
                  startTime12h,
                  endTime12h: format24hTo12h(Math.floor(endMins / 60) % 24, endMins % 60),
                });
              }
              return out;
            } catch {
              return [];
            }
          })
        )
      : Promise.resolve([]),
    getElentraBusyBlocksForDate(dateStr).catch(() => []),
  ]);

  const busy: BusyInterval[] = [...gcalBlocks.flat()];
  for (const eb of elentraBlocks) {
    const dup = busy.some(
      (b) => Math.abs(b.startMins - eb.startMins) <= 5 && Math.abs(b.endMins - eb.endMins) <= 5
    );
    if (!dup) busy.push(eb);
  }
  busy.sort((a, b) => a.startMins - b.startMins);
  return busy;
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    const body = (await req.json().catch(() => ({}))) as {
      date?: string;
      includeNewCards?: boolean;
      allowSplit?: boolean;
      calendar?: CalendarName;
      overrideCardsCount?: number;
      overrideDurationMins?: number;
      commit?: boolean;
    };

    const targetDate = body.date || getTodayDateStr();
    const prodDate = getProductivityDateStr();
    const calendar: CalendarName = body.calendar || 'School';
    const commit = Boolean(body.commit);

    let reviewDue = 0;
    let learningRem = 0;
    let newRem = 0;
    let avgSecs = 8.5;

    if (sb) {
      const { data: statsRow, error: sErr } = await sb
        .from('anki_daily_stats')
        .select('*')
        .eq('date', prodDate)
        .maybeSingle();

      if (sErr && isMissingAnkiTableError(sErr)) {
        return NextResponse.json({
          success: false,
          needsMigration: true,
          error: 'Run the Supabase Anki migration first so Kevin-OS can read your remaining Anki cards.',
        });
      }

      if (statsRow) {
        reviewDue = Number(statsRow.review_due_remaining) || 0;
        learningRem = Number(statsRow.learning_remaining) || 0;
        newRem = Number(statsRow.new_remaining) || 0;
        avgSecs = Number(statsRow.avg_secs_per_card) || 8.5;
      }
    }

    const plan =
      typeof body.overrideDurationMins === 'number' && body.overrideDurationMins > 0
        ? {
            targetCards: body.overrideCardsCount || reviewDue + learningRem,
            rawEstimatedMins: body.overrideDurationMins,
            totalBlockMins: body.overrideDurationMins,
            blocks: [
              {
                label: `Anki Reviews${
                  body.overrideCardsCount || reviewDue + learningRem
                    ? ` (${body.overrideCardsCount || reviewDue + learningRem} cards)`
                    : ''
                }`,
                durationMins: body.overrideDurationMins,
                estimatedCards: body.overrideCardsCount || reviewDue + learningRem,
              },
            ],
          }
        : computeAnkiStudyPlan({
            reviewDueRemaining:
              typeof body.overrideCardsCount === 'number' ? body.overrideCardsCount : reviewDue,
            learningRemaining: typeof body.overrideCardsCount === 'number' ? 0 : learningRem,
            newRemaining: newRem,
            includeNewCards: Boolean(body.includeNewCards),
            avgSecsPerCard: avgSecs,
            allowSplit: body.allowSplit !== false,
          });

    if (plan.blocks.length === 0) {
      return NextResponse.json({
        success: true,
        nothingDue: true,
        date: targetDate,
        message: 'You have 0 Anki review + learning cards due right now! Nothing to schedule.',
        plan,
        scheduledBlocks: [],
      });
    }

    const busyBlocks = await fetchBusyForDate(targetDate);
    const todayStr = getTodayDateStr();
    const earliestStartMins =
      targetDate === todayStr ? Math.max(8 * 60, getCurrentEasternMinsRoundedUp()) : 8 * 60;

    const candidates = plan.blocks.map((b, idx) => ({
      id: `anki-block-${idx + 1}`,
      title: b.label,
      calendar,
      durationMins: b.durationMins,
    }));

    const slotMap = await planRolloverTimeSlotsWithAI(targetDate, busyBlocks, candidates, {
      earliestStartMins: Math.min(21 * 60 + 30, earliestStartMins),
    });

    const scheduledBlocks: Array<{
      id: string;
      title: string;
      date: string;
      startTime: string;
      endTime: string;
      durationMins: number;
      estimatedCards: number;
      calendar: CalendarName;
      reasoning: string;
      committed: boolean;
      calendarEventId?: string | null;
      googleTaskId?: string | null;
    }> = [];

    let taskError: string | null = null;
    const occupiedSoFar = busyBlocks.map((b) => ({ startMins: b.startMins, endMins: b.endMins }));

    for (let i = 0; i < plan.blocks.length; i += 1) {
      const blk = plan.blocks[i];
      const id = `anki-block-${i + 1}`;
      const assigned = slotMap.get(id);
      let startTime = assigned?.startTime12h;
      let endTime = assigned?.endTime12h;
      const reasoning =
        assigned?.reasoning ||
        `Open ${blk.durationMins}m slot for ~${blk.estimatedCards} Anki cards (${avgSecs}s/card pace).`;

      if (!startTime) {
        const startMins = findFirstEmptySlot(blk.durationMins, occupiedSoFar, earliestStartMins);
        const endMins = startMins + blk.durationMins;
        startTime = format24hTo12h(Math.floor(startMins / 60) % 24, startMins % 60);
        endTime = format24hTo12h(Math.floor(endMins / 60) % 24, endMins % 60);
        occupiedSoFar.push({ startMins, endMins });
      }

      let committed = false;
      let calendarEventId: string | null = null;
      let googleTaskId: string | null = null;

      if (commit) {
        const internalReq = new NextRequest('http://localhost/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: blk.label,
            description: `Auto-scheduled Anki review session (~${blk.estimatedCards} cards at ${avgSecs}s/card). ${reasoning}`,
            date: targetDate,
            time: startTime,
            duration: blk.durationMins,
            calendar,
            skipCalendar: false,
            skipTask: false,
            isStandaloneEvent: false,
          }),
        });
        const schedRes = await schedulePost(internalReq);
        const schedJson = await schedRes.json();
        committed = Boolean(schedJson?.success);
        calendarEventId = schedJson?.calendarEventId || null;
        googleTaskId = schedJson?.taskId || null;
        if (schedJson?.taskError && !taskError) {
          taskError = String(schedJson.taskError);
        }
      }

      scheduledBlocks.push({
        id,
        title: blk.label,
        date: targetDate,
        startTime,
        endTime: endTime || '',
        durationMins: blk.durationMins,
        estimatedCards: blk.estimatedCards,
        calendar,
        reasoning,
        committed,
        calendarEventId,
        googleTaskId,
      });
    }

    return NextResponse.json({
      success: true,
      committed: commit,
      date: targetDate,
      avgSecsPerCard: avgSecs,
      plan,
      scheduledBlocks,
      taskError,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to auto-schedule Anki timeblock';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
