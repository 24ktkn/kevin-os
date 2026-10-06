import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface BiometricInput {
  date?: string;
  steps?: number | string;
  rhr?: number | string;
  hrv?: number | string;
  weight?: number | string;
  sleep?: number | string;
  workoutCalories?: number | string;
  workoutDuration?: number | string;
  wakeTime?: string;
  sleepTime?: string;
  timezone?: string;
}

// Correct calendar date string for the user's timezone without shifting at midnight
function getCalendarDateString(customDate?: string, tz = 'America/New_York'): string {
  if (customDate && /^\d{4}-\d{2}-\d{2}$/.test(String(customDate).trim())) {
    return String(customDate).trim();
  }
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const findPart = (t: string) => parts.find((p) => p.type === t)?.value || '';

  const year = findPart('year');
  const month = findPart('month');
  const day = findPart('day');

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
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

async function processBiometricRecord(body: BiometricInput, sb: any) {
  const targetDate = getCalendarDateString(body.date, body.timezone);

  // 1. Fetch existing record for targetDate to guard against data loss
  let existingRecord: any = null;
  if (sb) {
    try {
      const { data: ex } = await sb
        .from('biometrics')
        .select('*')
        .eq('date', targetDate)
        .maybeSingle();
      existingRecord = ex;
    } catch (e) {
      console.warn('Existing biometrics check notice:', e);
    }
  }

  // Incoming steps (steps within a day are strictly cumulative; never downgrade)
  const incomingSteps = parseInt(String(body.steps ?? 0), 10) || 0;
  const finalSteps = Math.max(existingRecord?.steps || 0, incomingSteps);

  // Incoming HRV
  const incomingHrv = parseFloat(String(body.hrv || 0)) || 0;
  const finalHrv = incomingHrv > 0 ? incomingHrv : (existingRecord?.hrv || 0);

  // Incoming Sleep
  let incomingSleep = body.sleep !== undefined && body.sleep !== null ? parseFloat(String(body.sleep)) || 0 : 0;
  if (incomingSleep > 1440) {
    incomingSleep = incomingSleep / 3600.0; // Converted from seconds
  } else if (incomingSleep > 24) {
    incomingSleep = incomingSleep / 60.0; // Converted from minutes
  }

  // Sleep fallback calculation from wakeTime & sleepTime if incoming sleep was 0
  if (incomingSleep <= 0 && body.wakeTime && body.sleepTime) {
    try {
      const cleanWake = String(body.wakeTime).replace(/\u202f/g, ' ').replace(/\s+at\s+/i, ' ').trim();
      const cleanSleep = String(body.sleepTime).replace(/\u202f/g, ' ').replace(/\s+at\s+/i, ' ').trim();
      let dWake = new Date(cleanWake);
      let dSleep = new Date(cleanSleep);

      if (isNaN(dWake.getTime()) || isNaN(dSleep.getTime())) {
        const matchTime = (t: string) => t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        const mWake = matchTime(cleanWake);
        const mSleep = matchTime(cleanSleep);
        if (mWake && mSleep) {
          let hW = parseInt(mWake[1], 10);
          if (mWake[3]?.toUpperCase() === 'PM' && hW < 12) hW += 12;
          if (mWake[3]?.toUpperCase() === 'AM' && hW === 12) hW = 0;
          const mW = parseInt(mWake[2], 10);

          let hS = parseInt(mSleep[1], 10);
          if (mSleep[3]?.toUpperCase() === 'PM' && hS < 12) hS += 12;
          if (mSleep[3]?.toUpperCase() === 'AM' && hS === 12) hS = 0;
          const mS = parseInt(mSleep[2], 10);

          let diffMinutes = (hW * 60 + mW) - (hS * 60 + mS);
          if (diffMinutes < 0) diffMinutes += 24 * 60; // Spans midnight
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

  // Preserve existing sleep if incoming is 0
  let finalSleepHours = existingRecord?.sleep_hours || 0;
  let finalSleepDuration = existingRecord?.sleep_duration || '0.0h';
  if (incomingSleep > 0) {
    finalSleepHours = Math.round(incomingSleep * 10) / 10;
    finalSleepDuration = `${finalSleepHours.toFixed(1)}h`;
  }

  // Incoming RHR
  const incomingRhr = parseFloat(String(body.rhr || 0)) || 0;
  const finalRhr = incomingRhr > 0 ? incomingRhr : (existingRecord?.rhr || 0);

  // Incoming Bodyweight
  let incomingWeight = body.weight !== undefined && body.weight !== null ? parseFloat(String(body.weight)) || 0 : 0;
  let finalWeight = existingRecord?.bodyweight || 175.2;
  if (incomingWeight > 50 && incomingWeight < 400) {
    finalWeight = Math.round(incomingWeight * 10) / 10;
  } else if (!existingRecord?.bodyweight && sb) {
    const { data: latestWeight } = await sb
      .from('biometrics')
      .select('bodyweight')
      .gt('bodyweight', 50)
      .lt('bodyweight', 400)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestWeight?.bodyweight) {
      finalWeight = parseFloat(String(latestWeight.bodyweight));
    }
  }

  // Incoming Times
  const wakeVal = formatTimeString(body.wakeTime);
  const sleepTimeVal = formatTimeString(body.sleepTime);
  const finalWake = wakeVal && wakeVal !== 'No data' ? wakeVal : (existingRecord?.wake_time || '');
  const finalSleepTime = sleepTimeVal && sleepTimeVal !== 'No data' ? sleepTimeVal : (existingRecord?.sleep_time || '');

  // Workouts (strictly cumulative)
  const incomingCal = parseFloat(String(body.workoutCalories || 0)) || 0;
  const incomingDur = parseFloat(String(body.workoutDuration || 0)) || 0;
  const finalCal = Math.max(existingRecord?.workout_calories || 0, incomingCal);
  const finalDur = Math.max(existingRecord?.workout_duration || 0, incomingDur);

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
    updated_at: new Date().toISOString(),
  };

  if (sb) {
    const { error: upsertErr } = await sb
      .from('biometrics')
      .upsert(mergedRecord, { onConflict: 'date' });
    if (upsertErr) {
      console.error(`Error saving biometrics for ${targetDate}:`, upsertErr);
    }

    // Cross-system habit automation: If workout is recorded (>= 20 mins or >= 150 cals), auto-check Gym Workout
    if (finalDur >= 20 || finalCal >= 150) {
      try {
        const { data: existingHabit } = await sb
          .from('habits')
          .select('*')
          .eq('date', targetDate)
          .maybeSingle();

        if (!existingHabit || !existingHabit.gym_workout) {
          await sb.from('habits').upsert({
            date: targetDate,
            wake_up_on_time: existingHabit?.wake_up_on_time ?? false,
            gym_workout: true,
            journaling: existingHabit?.journaling ?? false,
            anki: existingHabit?.anki ?? false,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'date' });
        }
      } catch (hErr) {
        console.warn('Auto-sync gym habit warning:', hErr);
      }
    }

    // Cross-system habit automation: If wake time is recorded and <= 8:00 AM, auto-check Wake Up On Time
    if (finalWake && finalWake !== 'No data') {
      try {
        const timeMatch = finalWake.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1], 10);
          const minute = parseInt(timeMatch[2], 10);
          const ampm = (timeMatch[3] || 'AM').toUpperCase();
          if (ampm === 'PM' && hour < 12) hour += 12;
          if (ampm === 'AM' && hour === 12) hour = 0;
          const wakeMins = hour * 60 + minute;
          const targetMins = 8 * 60; // 8:00 AM target
          if (wakeMins <= targetMins) {
            const { data: existingHabit } = await sb
              .from('habits')
              .select('*')
              .eq('date', targetDate)
              .maybeSingle();

            if (!existingHabit || !existingHabit.wake_up_on_time) {
              await sb.from('habits').upsert({
                date: targetDate,
                wake_up_on_time: true,
                gym_workout: existingHabit?.gym_workout ?? false,
                journaling: existingHabit?.journaling ?? false,
                anki: existingHabit?.anki ?? false,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'date' });
            }
          }
        }
      } catch (wErr) {
        console.warn('Auto-sync wake habit warning:', wErr);
      }
    }
  }

  // Mirror merged record to Google Sheets if available
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

  mirrorBiometricsToSheets(sheetsRow, targetDate).catch(() => {});

  return mergedRecord;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sb = supabaseAdmin || supabase;

    // Check if batch sync (array in `records` or body itself is array)
    const recordsList: BiometricInput[] = Array.isArray(body)
      ? body
      : Array.isArray(body.records)
      ? body.records
      : [body];

    const results = [];
    for (const record of recordsList) {
      const res = await processBiometricRecord(record, sb);
      results.push(res);
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
