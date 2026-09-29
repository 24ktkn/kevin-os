import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Productivity date cutoff: if hour is before 2 AM EDT, treat as previous day
function getProductivityDateString(tz = 'America/New_York'): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const findPart = (t: string) => parts.find((p) => p.type === t)?.value || '';

  let year = parseInt(findPart('year'), 10);
  let month = parseInt(findPart('month'), 10);
  let day = parseInt(findPart('day'), 10);
  const hour = parseInt(findPart('hour'), 10);

  if (hour < 2) {
    const prev = new Date(year, month - 1, day - 1);
    year = prev.getFullYear();
    month = prev.getMonth() + 1;
    day = prev.getDate();
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatTimeString(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York',
    });
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
    console.warn('mirrorBiometricsToSheets warning (non-fatal):', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      steps,
      rhr,
      hrv,
      weight,
      sleep,
      workoutCalories,
      workoutDuration,
      wakeTime,
      sleepTime,
      timezone,
    } = body;

    const targetDate = getProductivityDateString(timezone);

    const stepsVal = parseInt(String(steps ?? 0), 10) || 0;
    const hrvVal = parseFloat(String(hrv || 0)) || 0;
    const sleepHours = sleep !== undefined && sleep !== null ? parseFloat(String(sleep)) || 0 : 0;
    const sleepDurationStr = `${sleepHours.toFixed(1)}h`;
    const rhrVal = parseFloat(String(rhr || 0)) || 0;
    const weightVal = weight !== undefined && weight !== null ? parseFloat(String(weight)) || 170.0 : 170.0;
    const wakeVal = formatTimeString(wakeTime);
    const sleepTimeVal = formatTimeString(sleepTime);
    const wCalVal = parseFloat(String(workoutCalories || 0)) || 0;
    const wDurVal = parseFloat(String(workoutDuration || 0)) || 0;

    // 1. Primary: Save to Supabase (immediate sub-20ms response)
    const sb = supabaseAdmin || supabase;
    if (sb) {
      await sb.from('biometrics').upsert({
        date: targetDate,
        steps: stepsVal,
        hrv: hrvVal,
        sleep_duration: sleepDurationStr,
        sleep_hours: sleepHours,
        rhr: rhrVal,
        bodyweight: weightVal,
        wake_time: wakeVal,
        sleep_time: sleepTimeVal,
        workout_calories: wCalVal,
        workout_duration: wDurVal,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'date' });
    }

    // 2. Background mirror to Google Sheets (non-blocking)
    const sheetsRow = [
      targetDate,
      String(stepsVal),
      String(Math.round(hrvVal)),
      String(sleepHours.toFixed(1)),
      String(Math.round(rhrVal)),
      String(weightVal.toFixed(1)),
      wakeVal,
      sleepTimeVal,
      String(Math.round(wCalVal)),
      String(Math.round(wDurVal)),
    ];

    mirrorBiometricsToSheets(sheetsRow, targetDate).catch((e) => {
      console.warn('Background Sheets sync failed:', e);
    });

    return NextResponse.json({
      success: true,
      action: 'biometrics_synced',
      date: targetDate,
      metrics: {
        steps: stepsVal,
        hrv: Math.round(hrvVal),
        sleep: sleepHours,
        rhr: Math.round(rhrVal),
        weight: weightVal,
        wakeTime: wakeVal,
        sleepTime: sleepTimeVal,
        workoutCalories: Math.round(wCalVal),
        workoutDuration: Math.round(wDurVal),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in health webhook:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
