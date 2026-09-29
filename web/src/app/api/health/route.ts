import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export function parseSleepDuration(val: string | number | undefined): { text: string; hours: number } {
  if (val === undefined || val === null || val === '' || val === '0' || val === 0) {
    return { text: 'No data', hours: 0 };
  }
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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const requestedDate = url.searchParams.get('date')?.trim();

    const sb = supabaseAdmin || supabase;

    // 1. Primary: Load from Supabase biometrics (sub-20ms)
    if (sb) {
      try {
        let query = sb.from('biometrics').select('*');
        if (requestedDate) {
          query = query.eq('date', requestedDate);
        } else {
          query = query.order('date', { ascending: false }).limit(1);
        }

        const { data: records, error } = await query;
        if (!error && records && records.length > 0) {
          const target = records[0];

          // Fetch latest valid bodyweight
          let bodyweight = parseFloat(String(target.bodyweight || '170')) || 170.0;
          if (bodyweight <= 50 || bodyweight >= 400) {
            const { data: latestWeight } = await sb
              .from('biometrics')
              .select('bodyweight')
              .gt('bodyweight', 50)
              .lt('bodyweight', 400)
              .order('date', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latestWeight?.bodyweight) {
              bodyweight = parseFloat(String(latestWeight.bodyweight));
            }
          }

          const rawDateStr = String(target.date).trim();
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

          const sleepParsed = parseSleepDuration(target.sleep_duration || target.sleep_hours);
          const rawSteps = parseInt(String(target.steps || '0'), 10) || 0;
          const rawHrv = parseFloat(String(target.hrv || '0')) || 0;
          const rawRhr = parseFloat(String(target.rhr || '0')) || 0;
          const wakeTime = String(target.wake_time || '').trim();
          const sleepTime = String(target.sleep_time || '').trim();
          const workoutCal = parseFloat(String(target.workout_calories || '0')) || 0;
          const workoutDur = parseFloat(String(target.workout_duration || '0')) || 0;

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
              sleep_hours: target.sleep_hours || sleepParsed.hours,
              sleep_time: sleepTime && sleepTime !== '0' && sleepTime !== 'nan' ? sleepTime : 'No data',
              wake_time: wakeTime && wakeTime !== '0' && wakeTime !== 'nan' ? wakeTime : 'No data',
              rhr: Math.round(rawRhr),
              bodyweight,
              workout_calories: Math.round(workoutCal),
              workout_duration: Math.round(workoutDur),
            },
          });
        }
      } catch (sbErr) {
        console.warn('Supabase biometrics fetch warning:', sbErr);
      }
    }

    // 2. Fallback to Google Sheets
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

    const dataRows = rows.slice(1).filter((r) => r[dateIdx] && String(r[dateIdx]).trim() !== '');
    if (dataRows.length === 0) {
      return NextResponse.json({ success: true, data: null });
    }

    let targetRow = dataRows[dataRows.length - 1];
    if (requestedDate) {
      const match = dataRows.find((r) => String(r[dateIdx]).trim() === requestedDate);
      if (match) targetRow = match;
    }

    let bodyweight = 170.0;
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const val = parseFloat(String(dataRows[i][weightIdx]));
      if (!isNaN(val) && val > 50 && val < 400) {
        bodyweight = val;
        break;
      }
    }

    const rawSteps = parseInt(String(targetRow[stepsIdx] || '0').replace(/,/g, ''), 10) || 0;
    const rawHrv = parseFloat(String(targetRow[hrvIdx] || '0')) || 0;
    const sleepParsed = parseSleepDuration(targetRow[sleepIdx]);
    const rawRhr = parseFloat(String(targetRow[rhrIdx] || '0')) || 0;
    const wakeTime = String(targetRow[wakeIdx] || '').trim();
    const sleepTime = String(targetRow[sleepTimeIdx] || '').trim();
    const workoutCal = parseFloat(String(targetRow[wCalIdx] || '0')) || 0;
    const workoutDur = parseFloat(String(targetRow[wDurIdx] || '0')) || 0;

    const rawDateStr = String(targetRow[dateIdx]).trim();
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

export { POST } from './sync/route';
