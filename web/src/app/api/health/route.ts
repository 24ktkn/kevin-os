import { NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';

export const dynamic = 'force-dynamic';

function parseSleepDuration(val: string | undefined): { text: string; hours: number } {
  if (!val || val === '' || val === '0') return { text: 'No data', hours: 0 };
  const str = String(val).trim().toLowerCase();

  let hours = 0;
  let minutes = 0;

  if (str.includes('h') || str.includes('m')) {
    if (str.includes('h')) {
      const parts = str.split('h');
      hours = parseFloat(parts[0].trim()) || 0;
      if (parts[1]?.includes('m')) {
        minutes = parseFloat(parts[1].replace('m', '').trim()) || 0;
      }
    } else if (str.includes('m')) {
      minutes = parseFloat(str.replace('m', '').trim()) || 0;
    }
    const totalHours = hours + minutes / 60;
    return { text: `${Math.floor(hours)}h ${Math.round(minutes)}m`, hours: totalHours };
  }

  const num = parseFloat(str);
  if (!isNaN(num) && num > 0) {
    const h = Math.floor(num);
    const m = Math.round((num - h) * 60);
    return { text: `${h}h ${m}m`, hours: num };
  }

  return { text: 'No data', hours: 0 };
}

export async function GET() {
  try {
    const sheets = getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'health_metrics!A1:J1000',
    });

    const rows = res.data.values;
    if (!rows || rows.length < 2) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No health metrics found',
      });
    }

    const headers = rows[0].map((h: string) => String(h).trim().toLowerCase());
    const dateIdx = headers.indexOf('date');
    const stepsIdx = headers.indexOf('steps');
    const hrvIdx = headers.indexOf('hrv');
    const sleepIdx = headers.indexOf('sleep duration');
    const rhrIdx = headers.indexOf('rhr');
    const weightIdx = headers.indexOf('bodyweight');
    const wakeIdx = headers.indexOf('wake time');
    const sleepTimeIdx = headers.indexOf('sleep time');
    const wCalIdx = headers.indexOf('workout calories');
    const wDurIdx = headers.indexOf('workout duration');

    // Find the latest valid row with date
    const dataRows = rows.slice(1).filter((r) => r[dateIdx] && String(r[dateIdx]).trim() !== '');
    if (dataRows.length === 0) {
      return NextResponse.json({ success: true, data: null });
    }

    // Latest row
    const latestRow = dataRows[dataRows.length - 1];

    // Find latest valid bodyweight backwards
    let bodyweight = 170.0; // fallback
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const val = parseFloat(String(dataRows[i][weightIdx]));
      if (!isNaN(val) && val > 50 && val < 400) {
        bodyweight = val;
        break;
      }
    }

    const rawSteps = parseInt(String(latestRow[stepsIdx] || '0').replace(/,/g, ''), 10) || 0;
    const rawHrv = parseFloat(String(latestRow[hrvIdx] || '0')) || 0;
    const sleepParsed = parseSleepDuration(latestRow[sleepIdx]);
    const rawRhr = parseFloat(String(latestRow[rhrIdx] || '0')) || 0;
    const wakeTime = String(latestRow[wakeIdx] || '').trim();
    const sleepTime = String(latestRow[sleepTimeIdx] || '').trim();
    const workoutCal = parseFloat(String(latestRow[wCalIdx] || '0')) || 0;
    const workoutDur = parseFloat(String(latestRow[wDurIdx] || '0')) || 0;

    const rawDateStr = String(latestRow[dateIdx]).trim();
    let formattedDate = rawDateStr;
    try {
      const d = new Date(rawDateStr + 'T12:00:00');
      formattedDate = d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      // keep raw string
    }

    return NextResponse.json({
      success: true,
      data: {
        date: formattedDate,
        raw_date: rawDateStr,
        steps: rawSteps,
        steps_goal: 10000,
        steps_percentage: Math.min(100, Math.round((rawSteps / 10000) * 100)),
        hrv: Math.round(rawHrv),
        sleep_duration: sleepParsed.text,
        sleep_hours: sleepParsed.hours,
        sleep_time: sleepTime && sleepTime !== '0' && sleepTime !== 'nan' ? sleepTime : 'No data',
        wake_time: wakeTime && wakeTime !== '0' && wakeTime !== 'nan' ? wakeTime : 'No data',
        rhr: Math.round(rawRhr),
        bodyweight,
        workout_calories: Math.round(workoutCal),
        workout_duration: Math.round(workoutDur),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error fetching health metrics:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
