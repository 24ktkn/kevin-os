import {
  DEFAULT_TIMEZONE,
  getTodayDateStr,
  parseTimeToHoursMinutes,
  format24hTo12h,
} from '@/lib/date-utils';

export interface BusyInterval {
  id?: string;
  title: string;
  calendar: string;
  startMins: number; // Minutes from midnight (0..1439) in America/New_York
  endMins: number;   // Minutes from midnight
  startTime12h: string;
  endTime12h: string;
}

export interface RolloverTaskCandidate {
  id: string;
  title: string;
  calendar: string;
  durationMins: number;
  preferredTimeStr?: string;
}

export interface AssignedRolloverSlot {
  id: string;
  startTime24h: string;
  startTime12h: string;
  endTime12h: string;
  durationMins: number;
  reasoning: string;
}

const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
const DAY_START_MINS = 8 * 60; // 08:00 AM (480)
const DAY_END_MINS = 22 * 60;  // 10:00 PM (1320)
const BUFFER_MINS = 5;         // Minimum 5-minute buffer around busy blocks

function minsTo24h(totalMins: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(totalMins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minsTo12h(totalMins: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(totalMins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return format24hTo12h(h, m);
}

/**
 * Returns current time in minutes from midnight in America/New_York, rounded up to the next 15-min mark.
 */
export function getCurrentEasternMinsRoundedUp(timeZone = DEFAULT_TIMEZONE): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '8', 10) % 24;
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const rawMins = hour * 60 + minute;
  return Math.ceil((rawMins + 5) / 15) * 15;
}

/**
 * Checks whether [startMins, endMins] overlaps any busy interval (with a buffer).
 */
export function hasIntervalConflict(
  startMins: number,
  endMins: number,
  occupied: Array<{ startMins: number; endMins: number }>,
  bufferMins = BUFFER_MINS
): boolean {
  for (const block of occupied) {
    const busyStart = block.startMins - bufferMins;
    const busyEnd = block.endMins + bufferMins;
    if (startMins < busyEnd && endMins > busyStart) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministically finds the first non-overlapping empty time slot on the target day
 * that fits `durationMins`.
 */
export function findFirstEmptySlot(
  durationMins: number,
  occupied: Array<{ startMins: number; endMins: number }>,
  earliestStartMins = DAY_START_MINS,
  preferredStartMins?: number
): number {
  const safeDuration = Math.max(5, durationMins || 30);

  // 1. If a preferred time (e.g. yesterday's time) is at or after earliestStartMins and completely free, keep it
  if (
    typeof preferredStartMins === 'number' &&
    preferredStartMins >= earliestStartMins &&
    preferredStartMins + safeDuration <= DAY_END_MINS &&
    !hasIntervalConflict(preferredStartMins, preferredStartMins + safeDuration, occupied)
  ) {
    return preferredStartMins;
  }

  // 2. Scan in 15-minute increments from earliestStartMins to DAY_END_MINS
  const scanStart = Math.max(DAY_START_MINS, Math.ceil(earliestStartMins / 15) * 15);
  for (let cand = scanStart; cand + safeDuration <= DAY_END_MINS; cand += 15) {
    if (!hasIntervalConflict(cand, cand + safeDuration, occupied)) {
      return cand;
    }
  }

  // 3. If no slot found after earliestStartMins (e.g. sync ran late in the evening),
  // scan from DAY_START_MINS (8:00 AM) to DAY_END_MINS (10:00 PM)
  if (scanStart > DAY_START_MINS) {
    for (let cand = DAY_START_MINS; cand + safeDuration <= DAY_END_MINS; cand += 15) {
      if (!hasIntervalConflict(cand, cand + safeDuration, occupied)) {
        return cand;
      }
    }
  }

  // 4. Try with 0 buffer if day is tightly packed
  for (let cand = DAY_START_MINS; cand + safeDuration <= 23 * 60 + 45; cand += 15) {
    if (!hasIntervalConflict(cand, cand + safeDuration, occupied, 0)) {
      return cand;
    }
  }

  return DAY_START_MINS;
}

async function callGeminiForRollover(prompt: string, apiKey: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
      }
    } catch {
      // Fallback to next model
    }
  }
  return null;
}

/**
 * Uses Gemini AI (with strict conflict verification and deterministic empty-slot fallback)
 * to schedule rolled-over or rescheduled tasks into empty timeblocks on `targetDate`
 * while preserving each task's predetermined `durationMins`.
 */
export async function planRolloverTimeSlotsWithAI(
  targetDate: string,
  busyBlocks: BusyInterval[],
  candidates: RolloverTaskCandidate[]
): Promise<Map<string, AssignedRolloverSlot>> {
  const result = new Map<string, AssignedRolloverSlot>();
  if (candidates.length === 0) return result;

  const todayStr = getTodayDateStr();
  const isToday = targetDate === todayStr;
  const nowMins = isToday ? getCurrentEasternMinsRoundedUp() : DAY_START_MINS;

  // If rolling over onto today during the daytime (between 8:00 AM and 8:30 PM),
  // prefer empty slots starting from current time onwards so rolled-over tasks are actionable today.
  const earliestStartMins =
    isToday && nowMins > DAY_START_MINS && nowMins <= 20 * 60 + 30 ? nowMins : DAY_START_MINS;

  const sortedBusy = [...busyBlocks].sort((a, b) => a.startMins - b.startMins);
  const occupied: Array<{ startMins: number; endMins: number }> = sortedBusy.map((b) => ({
    startMins: b.startMins,
    endMins: b.endMins,
  }));

  // Attempt AI slot selection via Gemini
  const aiProposals = new Map<string, { startMins: number; reasoning: string }>();
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const busyText =
        sortedBusy.length > 0
          ? sortedBusy
              .map(
                (b) =>
                  `- [${b.calendar}] ${minsTo24h(b.startMins)} to ${minsTo24h(b.endMins)} (${b.startTime12h} - ${b.endTime12h}): ${b.title}`
              )
              .join('\n')
          : 'No existing events on this date (8:00 AM to 10:00 PM is completely open).';

      const tasksText = candidates
        .map(
          (c, i) =>
            `${i + 1}. id="${c.id}" | Title="${c.title}" | Calendar="${c.calendar}" | Predetermined Duration=${c.durationMins} mins${
              c.preferredTimeStr ? ` | Previous Time=${c.preferredTimeStr}` : ''
            }`
        )
        .join('\n');

      const prompt = `You are the AI Calendar Scheduler for Kevin-OS, an academic and productivity operating system for a medical student.

TARGET DATE: ${targetDate}
ACTIVE SCHEDULING WINDOW: ${minsTo24h(earliestStartMins)} (${minsTo12h(earliestStartMins)}) to 22:00 (10:00 PM)

EXISTING BUSY CALENDAR EVENTS ON ${targetDate} (DO NOT OVERLAP):
${busyText}

UNCOMPLETED ONLINE MODULES / TASKS TO RESCHEDULE INTO EMPTY TIMEBLOCKS:
${tasksText}

SCHEDULING RULES:
1. Every task MUST keep its exact predetermined Duration (in minutes) from initial scheduling.
2. Place each task into an EMPTY time slot on ${targetDate} between ${minsTo24h(earliestStartMins)} and 22:00 that does NOT overlap with any Existing Busy Calendar Event or with any other task you are scheduling.
3. Leave at least a 5 to 10 minute buffer between consecutive events/tasks whenever possible.
4. Use clean 15-minute or 5-minute boundaries (e.g. 09:00, 10:15, 13:30, 15:00).
5. Return ONLY a raw JSON array matching this exact schema:
[
  {
    "id": "exact task id string from input",
    "startTime24h": "HH:MM",
    "reasoning": "Brief 1-sentence explanation of why this open slot was chosen"
  }
]`;

      const rawResponse = await callGeminiForRollover(prompt, apiKey);
      if (rawResponse) {
        const cleaned = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item.id === 'string' && typeof item.startTime24h === 'string') {
              const { hours, minutes } = parseTimeToHoursMinutes(item.startTime24h);
              const startMins = hours * 60 + minutes;
              aiProposals.set(item.id, {
                startMins,
                reasoning:
                  typeof item.reasoning === 'string' && item.reasoning
                    ? item.reasoning
                    : 'Scheduled by AI into an open calendar slot.',
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn('AI rollover scheduler fallback to deterministic slot finder:', err);
    }
  }

  // Assign and validate slots for every candidate
  for (const cand of candidates) {
    const safeDuration = Math.max(5, cand.durationMins || 30);
    const aiPick = aiProposals.get(cand.id);
    let chosenStartMins: number | null = null;
    let reasoning = 'Automatically placed into the next open timeblock on your calendar.';

    if (aiPick) {
      const proposedStart = aiPick.startMins;
      const proposedEnd = proposedStart + safeDuration;
      const withinWindow = proposedStart >= DAY_START_MINS && proposedEnd <= 23 * 60 + 30;
      if (withinWindow && !hasIntervalConflict(proposedStart, proposedEnd, occupied)) {
        chosenStartMins = proposedStart;
        reasoning = aiPick.reasoning;
      }
    }

    if (chosenStartMins === null) {
      const prefMins = cand.preferredTimeStr
        ? (() => {
            const { hours, minutes } = parseTimeToHoursMinutes(cand.preferredTimeStr);
            return hours * 60 + minutes;
          })()
        : undefined;
      chosenStartMins = findFirstEmptySlot(safeDuration, occupied, earliestStartMins, prefMins);
    }

    const chosenEndMins = chosenStartMins + safeDuration;
    occupied.push({ startMins: chosenStartMins, endMins: chosenEndMins });

    result.set(cand.id, {
      id: cand.id,
      startTime24h: minsTo24h(chosenStartMins),
      startTime12h: minsTo12h(chosenStartMins),
      endTime12h: minsTo12h(chosenEndMins),
      durationMins: safeDuration,
      reasoning,
    });
  }

  return result;
}
