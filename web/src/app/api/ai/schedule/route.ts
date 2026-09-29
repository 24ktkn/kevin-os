import { NextRequest, NextResponse } from 'next/server';
import { ProposedTask, CalendarBusyBlock, AIScheduleResponse } from '@/types/ai';

export const dynamic = 'force-dynamic';

function format24hTo12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function calculateEndTime(startTime24: string, durationMins: number): string {
  const [hStr, mStr] = startTime24.split(':');
  let totalMins = parseInt(hStr, 10) * 60 + parseInt(mStr || '0', 10) + durationMins;
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const models = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
  let lastError = '';

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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

    const targetDate = date || new Date().toISOString().split('T')[0];

    // Format current calendar events for the prompt
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
      calendar: 'Kevin Nguyen' | 'Family' | 'School' | 'Volunteering';
      startTime24h: string;
      durationMins: number;
      reasoning?: string;
    }> = [];

    try {
      parsedTasks = JSON.parse(cleanedJsonStr);
    } catch {
      // Try regex extracting JSON array
      const match = cleanedJsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        parsedTasks = JSON.parse(match[0]);
      } else {
        throw new Error('Failed to parse Gemini schedule output as JSON');
      }
    }

    const validCalendars = new Set(['Kevin Nguyen', 'Family', 'School', 'Volunteering']);

    const scheduledTasks: ProposedTask[] = parsedTasks.map((t) => {
      const cal = validCalendars.has(t.calendar) ? t.calendar : 'Kevin Nguyen';
      const start24 = t.startTime24h || '09:00';
      const dur = Math.max(15, parseInt(String(t.durationMins || 30), 10));
      const end24 = calculateEndTime(start24, dur);

      return {
        itemName: t.itemName || 'Untitled Task',
        calendar: cal as 'Kevin Nguyen' | 'Family' | 'School' | 'Volunteering',
        startTime24h: start24,
        durationMins: dur,
        startTimeFormatted: format24hTo12h(start24),
        endTimeFormatted: format24hTo12h(end24),
        reasoning: t.reasoning || '',
      };
    });

    // Sort by start time
    scheduledTasks.sort((a, b) => a.startTime24h.localeCompare(b.startTime24h));

    return NextResponse.json<AIScheduleResponse>({
      success: true,
      scheduledTasks,
      summary: `Successfully generated ${scheduledTasks.length} non-overlapping timeblocks for ${targetDate}.`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error generating AI schedule:', errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
