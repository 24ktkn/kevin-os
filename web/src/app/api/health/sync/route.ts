import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID, mirrorHabitToSheets } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getCalendarDateString, parseSleepDuration } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

interface BiometricInput {
  date?: string;
  steps?: number | string;
  rhr?: number | string;
  hrv?: number | string;
  weight?: number | string;
  bodyweight?: number | string;
  body_weight?: number | string;
  sleep?: number | string;
  sleepDuration?: number | string;
  sleep_duration?: number | string;
  sleepHours?: number | string;
  sleep_hours?: number | string;
  workoutCalories?: number | string;
  workout_calories?: number | string;
  workoutDuration?: number | string;
  workout_duration?: number | string;
  wakeTime?: string;
  wake_time?: string;
  sleepTime?: string;
  sleep_time?: string;
  timezone?: string;
  [key: string]: unknown;
}

function formatTimeString(isoString?: string): string {
  if (!isoString) return '';
  try {
    const cleaned = String(isoString).replace(/\u202f/g, ' ').replace(/\s+at\s+/i, ' ').trim();
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York',
      });
    }
    const timeMatch = cleaned.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i);
    if (timeMatch) return timeMatch[1].trim();
    return isoString || '';
  } catch {
    return isoString || '';
  }
}

async function mirrorBiometricsToSheets(updatedRow: string[], targetDate: string) {
  try {
    const sheets = getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'health_metrics!A1:J1000',
    });

    const rows = res.data.values || [];
    let headers: string[] = [];
    if (rows.length > 0) {
      headers = rows[0].map((h: string) => String(h).trim());
    } else {
      headers = [
        'Date',
        'Steps',
        'HRV',
        'Sleep Duration',
        'RHR',
        'Bodyweight',
        'Wake Time',
        'Sleep Time',
        'Workout Calories',
        'Workout Duration',
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'health_metrics!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      });
      rows.push(headers);
    }

    const dateIdx = headers.indexOf('Date');
    let rowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][dateIdx] || '').trim() === targetDate) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex !== -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `health_metrics!A${rowIndex}:J${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedRow] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'health_metrics!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedRow] },
      });
    }
  } catch (err) {
    console.warn('mirrorBiometricsToSheets notice (non-fatal):', err);
  }
}

async function processBiometricRecord(
  body: BiometricInput,
  sb: ReturnType<typeof createSupabaseTypeHelper>,
  skipSheetsMirror = false
) {
  const targetDate = getCalendarDateString(body.date, body.timezone);

  // 1. Fetch existing biometrics row, latest valid bodyweight, and existing habits row in 1 parallel round-trip
  let existingRecord: Record<string, any> | null = null;
  let existingHabit: Record<string, any> | null = null;
  let latestDbWeight = 175.2;

  if (sb) {
    const [bioRes, weightRes, habitRes] = await Promise.all([
      sb.from('biometrics').select('*').eq('date', targetDate).maybeSingle(),
      sb
        .from('biometrics')
        .select('bodyweight')
        .gt('bodyweight', 50)
        .lt('bodyweight', 400)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from('habits').select('*').eq('date', targetDate).maybeSingle(),
    ]);
    existingRecord = bioRes.data;
    existingHabit = habitRes.data;
    if (weightRes.data?.bodyweight) {
      latestDbWeight = parseFloat(String(weightRes.data.bodyweight)) || 175.2;
    }
  }

  // Incoming steps (cumulative within a day)
  const incomingSteps = parseInt(String(body.steps ?? body.Steps ?? 0), 10) || 0;
  const finalSteps = Math.max(existingRecord?.steps || 0, incomingSteps);

  // Incoming HRV
  const incomingHrv = parseFloat(String(body.hrv ?? body.HRV ?? 0)) || 0;
  const finalHrv = incomingHrv > 0 ? incomingHrv : (existingRecord?.hrv || 0);

  // Incoming Sleep (support aliases: sleep, sleepDuration, sleep_duration, sleepHours, sleep_hours)
  const rawSleep =
    body.sleep ??
    body.sleepDuration ??
    body.sleep_duration ??
    body.sleepHours ??
    body.sleep_hours;

  let incomingSleep = parseSleepDuration(rawSleep).hours;

  const rawWakeTime = (body.wakeTime ?? body.wake_time) as string | undefined;
  const rawSleepTime = (body.sleepTime ?? body.sleep_time) as string | undefined;

  // Sleep fallback calculation from wakeTime & sleepTime if incoming sleep was 0
  if (incomingSleep <= 0 && rawWakeTime && rawSleepTime) {
    try {
      const cleanWake = String(rawWakeTime).replace(/\u202f/g, ' ').replace(/\s+at\s+/i, ' ').trim();
      const cleanSleep = String(rawSleepTime).replace(/\u202f/g, ' ').replace(/\s+at\s+/i, ' ').trim();
      const dWake = new Date(cleanWake);
      const dSleep = new Date(cleanSleep);

      if (isNaN(dWake.getTime()) || isNaN(dSleep.getTime())) {
        const matchTime = (t: string) => t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        const mWake = matchTime(cleanWake);
        const mSleep = matchTime(cleanSleep);
        if (mWake && mSleep) {
          let hW = parseInt(mWake[1], 10);
          if (mWake[3]?.toUpperCase() === 'PM' && hW < 12) hW += 12;
          if (mWake[3]?.toUpperCase() === 'AM' && hW === 12) hW = 0;
          const minW = hW * 60 + parseInt(mWake[2], 10);

          let hS = parseInt(mSleep[1], 10);
          if (mSleep[3]?.toUpperCase() === 'PM' && hS < 12) hS += 12;
          if (mSleep[3]?.toUpperCase() === 'AM' && hS === 12) hS = 0;
          const minS = hS * 60 + parseInt(mSleep[2], 10);

          let diffMinutes = minW - minS;
          if (diffMinutes < 0) diffMinutes += 24 * 60;
          if (diffMinutes > 0 && diffMinutes < 24 * 60) {
            incomingSleep = Math.round((diffMinutes / 60) * 10) / 10;
          }
        }
      } else {
        let diffMs = dWake.getTime() - dSleep.getTime();
        if (diffMs < 0) diffMs += 24 * 3600 * 1000;
        if (diffMs > 0 && diffMs < 24 * 3600 * 1000) {
          incomingSleep = Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;
        }
      }
    } catch {
      // ignore
    }
  }

  let finalSleepHours = existingRecord?.sleep_hours || 0;
  let finalSleepDuration = existingRecord?.sleep_duration || '0.0h';
  if (incomingSleep > 0) {
    finalSleepHours = Math.round(incomingSleep * 10) / 10;
    finalSleepDuration = `${finalSleepHours.toFixed(1)}h`;
  }

  // Incoming RHR
  const incomingRhr = parseFloat(String(body.rhr ?? body.RHR ?? 0)) || 0;
  const finalRhr = incomingRhr > 0 ? incomingRhr : (existingRecord?.rhr || 0);

  // Incoming Bodyweight
  const rawWeightInput = body.weight ?? body.bodyweight ?? body.body_weight;
  const incomingWeight =
    rawWeightInput !== undefined && rawWeightInput !== null ? parseFloat(String(rawWeightInput)) || 0 : 0;
  let finalWeight =
    existingRecord?.bodyweight && existingRecord.bodyweight > 50
      ? Number(existingRecord.bodyweight)
      : latestDbWeight;
  if (incomingWeight > 50 && incomingWeight < 400) {
    finalWeight = Math.round(incomingWeight * 10) / 10;
  }

  // Incoming Times
  const wakeVal = formatTimeString(rawWakeTime);
  let sleepTimeVal = formatTimeString(rawSleepTime);

  // Micro-interval bedtime anomaly check (reconstruct bedtime = wakeTime - sleepDuration if < 45m apart)
  const effectiveSleep = incomingSleep > 0 ? incomingSleep : (existingRecord?.sleep_hours || 0);
  if (effectiveSleep >= 2.0 && wakeVal && sleepTimeVal) {
    try {
      const matchTime = (t: string) => t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      const mW = matchTime(wakeVal);
      const mS = matchTime(sleepTimeVal);
      if (mW && mS) {
        let hW = parseInt(mW[1], 10);
        if (mW[3]?.toUpperCase() === 'PM' && hW < 12) hW += 12;
        if (mW[3]?.toUpperCase() === 'AM' && hW === 12) hW = 0;
        const minW = hW * 60 + parseInt(mW[2], 10);

        let hS = parseInt(mS[1], 10);
        if (mS[3]?.toUpperCase() === 'PM' && hS < 12) hS += 12;
        if (mS[3]?.toUpperCase() === 'AM' && hS === 12) hS = 0;
        const minS = hS * 60 + parseInt(mS[2], 10);

        let diff = minW - minS;
        if (diff < 0) diff += 24 * 60;

        if (diff < 45) {
          let bedtimeMinutes = minW - Math.round(effectiveSleep * 60);
          while (bedtimeMinutes < 0) bedtimeMinutes += 24 * 60;
          const bH = Math.floor(bedtimeMinutes / 60) % 24;
          const bM = bedtimeMinutes % 60;
          const ampm = bH >= 12 ? 'PM' : 'AM';
          const displayH = bH % 12 === 0 ? 12 : bH % 12;
          sleepTimeVal = `${displayH}:${String(bM).padStart(2, '0')} ${ampm}`;
        }
      }
    } catch {
      // ignore
    }
  }

  // Reconstruct bedtime if missing when wakeVal and effectiveSleep exist
  if (effectiveSleep >= 2.0 && wakeVal && (!sleepTimeVal || sleepTimeVal === 'No data')) {
    try {
      const matchTime = (t: string) => t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      const mW = matchTime(wakeVal);
      if (mW) {
        let hW = parseInt(mW[1], 10);
        if (mW[3]?.toUpperCase() === 'PM' && hW < 12) hW += 12;
        if (mW[3]?.toUpperCase() === 'AM' && hW === 12) hW = 0;
        const minW = hW * 60 + parseInt(mW[2], 10);

        let bedtimeMinutes = minW - Math.round(effectiveSleep * 60);
        while (bedtimeMinutes < 0) bedtimeMinutes += 24 * 60;
        const bH = Math.floor(bedtimeMinutes / 60) % 24;
        const bM = bedtimeMinutes % 60;
        const ampm = bH >= 12 ? 'PM' : 'AM';
        const displayH = bH % 12 === 0 ? 12 : bH % 12;
        sleepTimeVal = `${displayH}:${String(bM).padStart(2, '0')} ${ampm}`;
      }
    } catch {
      // ignore
    }
  }

  const finalWake = wakeVal && wakeVal !== 'No data' ? wakeVal : (existingRecord?.wake_time || '');
  const finalSleepTime = sleepTimeVal && sleepTimeVal !== 'No data' ? sleepTimeVal : (existingRecord?.sleep_time || '');

  // Workouts (strictly cumulative)
  const incomingCal = parseFloat(String(body.workoutCalories ?? body.workout_calories ?? 0)) || 0;
  const incomingDur = parseFloat(String(body.workoutDuration ?? body.workout_duration ?? 0)) || 0;
  const finalCal = Math.max(existingRecord?.workout_calories || 0, incomingCal);
  const finalDur = Math.max(existingRecord?.workout_duration || 0, incomingDur);

  const nowIso = new Date().toISOString();
  const mergedRecord = {
    date: targetDate,
    steps: finalSteps,
    hrv: finalHrv,
    sleep_duration: finalSleepDuration,
    sleep_hours: finalSleepHours,
    rhr: finalRhr,
    bodyweight: finalWeight,
    wake_time: finalWake,
    sleep_time: finalSleepTime,
    workout_calories: finalCal,
    workout_duration: finalDur,
    updated_at: nowIso,
  };

  if (sb) {
    // Evaluate both habit automations together so we perform at most 1 habits upsert in parallel with biometrics upsert
    const autoGym = finalDur >= 20 || finalCal >= 150;
    let autoWake = false;

    if (finalWake && finalWake !== 'No data') {
      const timeMatch = finalWake.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        const minute = parseInt(timeMatch[2], 10);
        const explicitAmPm = timeMatch[3]?.toUpperCase();
        if (explicitAmPm === 'PM' && hour < 12) hour += 12;
        if (explicitAmPm === 'AM' && hour === 12) hour = 0;
        const wakeMins = hour * 60 + minute;
        if (wakeMins <= 8 * 60) {
          autoWake = true;
        }
      }
    }

    const needsGymUpdate = autoGym && (!existingHabit || !existingHabit.gym_workout);
    const needsWakeUpdate = autoWake && (!existingHabit || !existingHabit.wake_up_on_time);

    await Promise.all([
      sb.from('biometrics').upsert(mergedRecord, { onConflict: 'date' }),

      (async () => {
        if (!needsGymUpdate && !needsWakeUpdate) return;
        const habitPayload: Record<string, unknown> = {
          date: targetDate,
          wake_up_on_time: needsWakeUpdate ? true : Boolean(existingHabit?.wake_up_on_time),
          gym_workout: needsGymUpdate ? true : Boolean(existingHabit?.gym_workout),
          journaling: Boolean(existingHabit?.journaling),
          anki: Boolean(existingHabit?.anki),
          updated_at: nowIso,
        };

        const { error: hErr } = await sb.from('habits').upsert(habitPayload, { onConflict: 'date' });
        if (hErr && hErr.code === '42703') {
          const { anki: _omit, ...fallbackPayload } = habitPayload;
          await sb.from('habits').upsert(fallbackPayload, { onConflict: 'date' });
        }

        if (needsGymUpdate) mirrorHabitToSheets(targetDate, 'Gym Workout', true).catch(() => {});
        if (needsWakeUpdate) mirrorHabitToSheets(targetDate, 'Wake Up On Time', true).catch(() => {});
      })(),
    ]);
  }

  const sheetsRow = [
    targetDate,
    String(finalSteps),
    String(Math.round(finalHrv)),
    String(finalSleepHours.toFixed(1)),
    String(Math.round(finalRhr)),
    String(finalWeight.toFixed(1)),
    finalWake,
    finalSleepTime,
    String(Math.round(finalCal)),
    String(Math.round(finalDur)),
  ];

  if (!skipSheetsMirror) {
    mirrorBiometricsToSheets(sheetsRow, targetDate).catch(() => {});
  }

  return { mergedRecord, sheetsRow, targetDate };
}

function createSupabaseTypeHelper() {
  return supabaseAdmin || supabase;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sb = supabaseAdmin || supabase;

    const recordsList: BiometricInput[] = Array.isArray(body)
      ? body
      : Array.isArray(body.records)
        ? body.records
        : [body];

    const isBatch = recordsList.length > 1;
    const results = [];
    let lastProcessed: { sheetsRow: string[]; targetDate: string } | null = null;

    for (const record of recordsList) {
      const { mergedRecord, sheetsRow, targetDate } = await processBiometricRecord(record, sb, isBatch);
      results.push(mergedRecord);
      lastProcessed = { sheetsRow, targetDate };
    }

    if (isBatch && lastProcessed) {
      mirrorBiometricsToSheets(lastProcessed.sheetsRow, lastProcessed.targetDate).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      action: 'biometrics_synced',
      syncedCount: results.length,
      metrics: results.length === 1 ? results[0] : results,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in health sync webhook:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
