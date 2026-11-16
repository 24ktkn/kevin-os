import { NextRequest, NextResponse } from 'next/server';
import { ProposedTask, CalendarBusyBlock, AIScheduleResponse } from '@/types/ai';
import { CalendarName } from '@/types/task';
import { getTodayDateStr, format24hTo12h, parseTimeToHoursMinutes, DEFAULT_TIMEZONE } from '@/lib/date-utils';
import { hasIntervalConflict, findFirstEmptySlot } from '@/lib/ai-rollover-scheduler';

export const dynamic = 'force-dynamic';

function format24StrTo12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr || '0', 10) || 0;
  return format24hTo12h(h, m);
}

function calculateEndTime(startTime24: string, durationMins: number): string {
  const [hStr, mStr] = startTime24.split(':');
  const totalMins = (parseInt(hStr, 10) || 0) * 60 + (parseInt(mStr || '0', 10) || 0) + durationMins;
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const models = ['gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-flash-latest'];
  let lastError = '';

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.95,
          },
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return text;
      }
      if (data.error) {
        lastError = data.error.message || JSON.stringify(data.error);
      }
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError || 'All Gemini model endpoints failed');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, tasksInput, busyBlocks = [] } = body;

    if (!tasksInput || typeof tasksInput !== 'string' || tasksInput.trim() === '') {
      return NextResponse.json({ error: 'Please enter at least one task to schedule' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured in server environment' }, { status: 500 });
    }

    const targetDate = date || getTodayDateStr();

    let formattedSchedule = 'No busy events scheduled between 8:00 AM and 10:00 PM.';
    if (busyBlocks && busyBlocks.length > 0) {
      formattedSchedule = busyBlocks
        .map((b: CalendarBusyBlock) => `[${b.calendar}] ${b.startTime} - ${b.endTime}: ${b.title}`)
        .join('\n');
    }

    const systemPrompt = `
You are an expert AI executive assistant and timeblock scheduler.
The target date for scheduling is ${targetDate}.
The user's day runs from 8:00 AM to 10:00 PM.

CURRENT EXISTING EVENTS FOR ${targetDate} (DO NOT OVERLAP WITH THESE):
${formattedSchedule}

UNSTRUCTURED TASKS TO SCHEDULE:
${tasksInput}

YOUR OBJECTIVES:
1. Identify each distinct task.
2. Estimate a reasonable duration in minutes (if the user specified a duration like "30m", "45m", "1h", prioritize that).
3. Assign the best calendar category from: ["Kevin Nguyen", "Family", "School", "Volunteering"]. (Default: "Kevin Nguyen").
4. Fit the tasks into available free timeblocks between 08:00 and 22:00. DO NOT overlap with existing events or with each other. Leave 5-10 minute buffers when practical.
5. Return ONLY a valid JSON array. No markdown fences, no explanatory text.

JSON FORMAT:
[
  {
    "itemName": "Task Title",
    "calendar": "Kevin Nguyen",
    "startTime24h": "14:30",
    "durationMins": 45,
    "reasoning": "Fits in free afternoon slot between class and dinner"
  }
]
`;

    const rawResponse = await callGemini(systemPrompt, apiKey);
    const cleanedJsonStr = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsedTasks: Array<{
      itemName: string;
      calendar: CalendarName;
      startTime24h: string;
      durationMins: number;
      reasoning?: string;
    }> = [];

    try {
      parsedTasks = JSON.parse(cleanedJsonStr);
    } catch {
      const match = cleanedJsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        parsedTasks = JSON.parse(match[0]);
      } else {
        throw new Error('Failed to parse Gemini schedule output as JSON');
      }
    }

    const validCalendars = new Set(['Kevin Nguyen', 'Family', 'School', 'Volunteering']);

    // Build occupied busy intervals from context busyBlocks so we guarantee ZERO overlap even if Gemini slips up
    const occupied: Array<{ startMins: number; endMins: number }> = [];
    for (const b of busyBlocks as CalendarBusyBlock[]) {
      let sMins = -1;
      let eMins = -1;
      if (b.startIso && b.endIso) {
        const sd = new Date(b.startIso);
        const ed = new Date(b.endIso);
        if (!Number.isNaN(sd.getTime()) && !Number.isNaN(ed.getTime())) {
          const sTimeStr = sd.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: DEFAULT_TIMEZONE,
          });
          const p = parseTimeToHoursMinutes(sTimeStr);
          sMins = p.hours * 60 + p.minutes;
          eMins = sMins + Math.max(5, Math.round((ed.getTime() - sd.getTime()) / 60000));
        }
      }
      if (sMins < 0 && b.startTime && b.endTime) {
        const ps = parseTimeToHoursMinutes(b.startTime);
        const pe = parseTimeToHoursMinutes(b.endTime);
        sMins = ps.hours * 60 + ps.minutes;
        eMins = pe.hours * 60 + pe.minutes;
      }
      if (sMins >= 0 && eMins > sMins) {
        occupied.push({ startMins: sMins, endMins: eMins });
      }
    }

    const scheduledTasks: ProposedTask[] = parsedTasks.map((t) => {
      const cal = validCalendars.has(t.calendar) ? t.calendar : 'Kevin Nguyen';
      const dur = Math.max(15, parseInt(String(t.durationMins || 30), 10));
      const parsedStart = parseTimeToHoursMinutes(t.startTime24h || '09:00');
      const proposedStartMins = parsedStart.hours * 60 + parsedStart.minutes;
      const proposedEndMins = proposedStartMins + dur;

      const withinWindow = proposedStartMins >= 8 * 60 && proposedEndMins <= 22 * 60 + 30;
      const chosenStartMins =
        withinWindow && !hasIntervalConflict(proposedStartMins, proposedEndMins, occupied, 5)
          ? proposedStartMins
          : findFirstEmptySlot(dur, occupied, 8 * 60, proposedStartMins);

      occupied.push({ startMins: chosenStartMins, endMins: chosenStartMins + dur });

      const chH = Math.floor(chosenStartMins / 60) % 24;
      const chM = chosenStartMins % 60;
      const start24 = `${String(chH).padStart(2, '0')}:${String(chM).padStart(2, '0')}`;
      const end24 = calculateEndTime(start24, dur);

      return {
        itemName: t.itemName || 'Untitled Task',
        calendar: cal as CalendarName,
        startTime24h: start24,
        durationMins: dur,
        startTimeFormatted: format24StrTo12h(start24),
        endTimeFormatted: format24StrTo12h(end24),
        reasoning: t.reasoning || '',
      };
    });

    scheduledTasks.sort((a, b) => a.startTime24h.localeCompare(b.startTime24h));

    return NextResponse.json<AIScheduleResponse>({
      success: true,
      scheduledTasks,
      summary: `Successfully generated ${scheduledTasks.length} non-overlapping timeblocks for ${targetDate}.`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error generating AI schedule:', errorMsg);
    return NextResponse.json({ success: false, scheduledTasks: [], error: errorMsg }, { status: 500 });
  }
}
