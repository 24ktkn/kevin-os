import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';

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
    const sheets = getGoogleSheetsClient();

    // Read existing health_metrics
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
    let rowIndex = -1; // 1-indexed for Google Sheets API

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][dateIdx] || '').trim() === targetDate) {
        rowIndex = i + 1;
        break;
      }
    }

    // Format fields
    const stepsVal = String(steps ?? 0);
    const hrvVal = String(Math.round(Number(hrv) || 0));
    const sleepVal = sleep !== undefined && sleep !== null ? String(Number(sleep).toFixed(1)) : '0';
    const rhrVal = String(Math.round(Number(rhr) || 0));
    const weightVal = weight !== undefined && weight !== null ? String(Number(weight).toFixed(1)) : '0';
    const wakeVal = formatTimeString(wakeTime);
    const sleepTimeVal = formatTimeString(sleepTime);
    const wCalVal = String(Math.round(Number(workoutCalories) || 0));
    const wDurVal = String(Math.round(Number(workoutDuration) || 0));

    const updatedRow = [
      targetDate,
      stepsVal,
      hrvVal,
      sleepVal,
      rhrVal,
      weightVal,
      wakeVal,
      sleepTimeVal,
      wCalVal,
      wDurVal,
    ];

    if (rowIndex !== -1) {
      // Update today's existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `health_metrics!A${rowIndex}:J${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedRow] },
      });
    } else {
      // Append new row for today
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'health_metrics!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedRow] },
      });
    }

    return NextResponse.json({
      success: true,
      action: 'biometrics_synced',
      date: targetDate,
      metrics: {
        steps: stepsVal,
        hrv: hrvVal,
        sleep: sleepVal,
        rhr: rhrVal,
        weight: weightVal,
        wakeTime: wakeVal,
        sleepTime: sleepTimeVal,
        workoutCalories: wCalVal,
        workoutDuration: wDurVal,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in health webhook:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
