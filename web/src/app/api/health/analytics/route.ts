import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { parseSleepDuration, formatDisplayTime } from '../route';

export const dynamic = 'force-dynamic';

export interface DayMetricPoint {
  date: string;
  dayLabel: string;
  weekday: string;
  steps: number;
  stepsGoal: number;
  stepsPercentage: number;
  hrv: number;
  rhr: number;
  sleepHours: number;
  sleepDuration: string;
  sleepTime: string;
  wakeTime: string;
  bodyweight: number;
  workoutCalories: number;
  workoutDuration: number;
}

export interface MonthRollup {
  monthKey: string;
  monthLabel: string;
  year: number;
  daysTracked: number;
  avgSleep: number;
  avgRhr: number;
  avgHrv: number;
  totalSteps: number;
  avgSteps: number;
  totalWorkoutCalories: number;
  totalWorkoutMinutes: number;
  avgWeight: number;
}

export interface AnalyticsSummary {
  periodLabel: string;
  totalDays: number;
  trackedDays: number;
  
  // Sleep
  avgSleepHours: number;
  avgSleepText: string;
  sleepTrackedDays: number;
  targetSleepHours: number;
  sleepDebtHours: number;

  // Cardiovascular
  avgRhr: number;
  minRhr: number;
  maxRhr: number;
  rhrTrackedDays: number;
  avgHrv: number;
  maxHrv: number;
  hrvTrackedDays: number;

  // Activity & Movement
  avgSteps: number;
  totalSteps: number;
  stepGoalHitRate: number; // percentage of days >= 10k steps
  daysOver10k: number;

  // Workout & Training
  totalWorkoutCalories: number;
  totalWorkoutMinutes: number;
  totalWorkoutHours: number;
  activeWorkoutDays: number;
  avgWorkoutDurationOnActiveDays: number;

  // Body Composition
  currentWeight: number;
  startWeight: number;
  weightDelta: number;
  minWeight: number;
  maxWeight: number;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const timeframe = (url.searchParams.get('timeframe') || 'month').toLowerCase(); // 'week' | 'month' | 'year' | 'all'

    const sb = supabaseAdmin || supabase;
    let rawRecords: any[] = [];

    // 1. Primary: Load all biometrics from Supabase
    if (sb) {
      const { data, error } = await sb
        .from('biometrics')
        .select('*')
        .order('date', { ascending: true });

      if (!error && data && data.length > 0) {
        rawRecords = data;
      }
    }

    // 2. Fallback to Google Sheets
    if (rawRecords.length === 0) {
      try {
        const sheets = getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'health_metrics!A1:J1000',
        });
        const rows = res.data.values || [];
        if (rows.length > 1) {
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

          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const d = String(r[dateIdx] || '').trim();
            if (!d || d.length < 8) continue;
            rawRecords.push({
              date: d,
              steps: parseInt(String(r[stepsIdx] || '0').replace(/,/g, ''), 10) || 0,
              hrv: parseFloat(String(r[hrvIdx] || '0')) || 0,
              sleep_duration: String(r[sleepIdx] || ''),
              sleep_hours: parseFloat(String(r[sleepIdx] || '0')) || 0,
              rhr: parseFloat(String(r[rhrIdx] || '0')) || 0,
              bodyweight: parseFloat(String(r[weightIdx] || '170')) || 170,
              wake_time: String(r[wakeIdx] || ''),
              sleep_time: String(r[sleepTimeIdx] || ''),
              workout_calories: parseFloat(String(r[wCalIdx] || '0')) || 0,
              workout_duration: parseFloat(String(r[wDurIdx] || '0')) || 0,
            });
          }
        }
      } catch (sheetsErr) {
        console.warn('Sheets fallback failed in health analytics:', sheetsErr);
      }
    }

    if (rawRecords.length === 0) {
      return NextResponse.json({
        success: true,
        summary: null,
        days: [],
        months: [],
        message: 'No biometrics data available',
      });
    }

    // Sort ascending by date
    rawRecords.sort((a, b) => (a.date > b.date ? 1 : -1));

    // Determine cutoff date based on timeframe
    const latestDateStr = rawRecords[rawRecords.length - 1].date;
    const latestDate = new Date(latestDateStr + 'T12:00:00');
    let startDate = new Date(latestDate);

    if (timeframe === 'week') {
      startDate.setDate(latestDate.getDate() - 6); // 7 days total
    } else if (timeframe === 'month') {
      startDate.setDate(latestDate.getDate() - 29); // 30 days total
    } else if (timeframe === 'year') {
      startDate.setFullYear(latestDate.getFullYear() - 1);
    } else {
      // 'all'
      startDate = new Date('2020-01-01');
    }

    const startCutoffStr = startDate.toISOString().split('T')[0];
    const filtered = rawRecords.filter((r) => r.date >= startCutoffStr);

    // Map into sanitized DayMetricPoints
    let lastValidWeight = 175.0;
    const days: DayMetricPoint[] = filtered.map((rec) => {
      const d = new Date(rec.date + 'T12:00:00');
      const dayLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });

      const parsedSleep = parseSleepDuration(rec.sleep_duration || rec.sleep_hours);
      const sleepHours = rec.sleep_hours && rec.sleep_hours > 0 ? Number(rec.sleep_hours) : parsedSleep.hours;

      const steps = parseInt(String(rec.steps || '0'), 10) || 0;
      const hrv = Math.round(parseFloat(String(rec.hrv || '0')) * 10) / 10;
      const rhr = Math.round(parseFloat(String(rec.rhr || '0')) * 10) / 10;

      let weight = parseFloat(String(rec.bodyweight || '0'));
      if (weight > 50 && weight < 400) {
        lastValidWeight = Math.round(weight * 10) / 10;
      }

      return {
        date: rec.date,
        dayLabel,
        weekday,
        steps,
        stepsGoal: 10000,
        stepsPercentage: Math.min(100, Math.round((steps / 10000) * 100)),
        hrv,
        rhr,
        sleepHours: Math.round(sleepHours * 10) / 10,
        sleepDuration: parsedSleep.text !== 'No data' ? parsedSleep.text : sleepHours > 0 ? `${sleepHours}h` : '0h',
        sleepTime: formatDisplayTime(rec.sleep_time),
        wakeTime: formatDisplayTime(rec.wake_time),
        bodyweight: lastValidWeight,
        workoutCalories: Math.round(parseFloat(String(rec.workout_calories || '0')) * 10) / 10,
        workoutDuration: Math.round(parseFloat(String(rec.workout_duration || '0'))),
      };
    });

    // Compute Summary Statistics
    const validSleep = days.filter((d) => d.sleepHours > 0);
    const avgSleepHours =
      validSleep.length > 0
        ? Math.round((validSleep.reduce((acc, d) => acc + d.sleepHours, 0) / validSleep.length) * 10) / 10
        : 0;

    const avgH = Math.floor(avgSleepHours);
    const avgM = Math.round((avgSleepHours - avgH) * 60);
    const avgSleepText = avgSleepHours > 0 ? `${avgH}h ${avgM}m` : '0h';

    const validRhr = days.filter((d) => d.rhr > 30);
    const avgRhr =
      validRhr.length > 0
        ? Math.round(validRhr.reduce((acc, d) => acc + d.rhr, 0) / validRhr.length)
        : 0;
    const minRhr = validRhr.length > 0 ? Math.min(...validRhr.map((d) => d.rhr)) : 0;
    const maxRhr = validRhr.length > 0 ? Math.max(...validRhr.map((d) => d.rhr)) : 0;

    const validHrv = days.filter((d) => d.hrv > 0);
    const avgHrv =
      validHrv.length > 0
        ? Math.round(validHrv.reduce((acc, d) => acc + d.hrv, 0) / validHrv.length)
        : 0;
    const maxHrv = validHrv.length > 0 ? Math.max(...validHrv.map((d) => d.hrv)) : 0;

    const totalSteps = days.reduce((acc, d) => acc + d.steps, 0);
    const avgSteps = days.length > 0 ? Math.round(totalSteps / days.length) : 0;
    const daysOver10k = days.filter((d) => d.steps >= 10000).length;
    const stepGoalHitRate = days.length > 0 ? Math.round((daysOver10k / days.length) * 100) : 0;

    const totalWorkoutCalories = Math.round(days.reduce((acc, d) => acc + d.workoutCalories, 0));
    const totalWorkoutMinutes = Math.round(days.reduce((acc, d) => acc + d.workoutDuration, 0));
    const totalWorkoutHours = Math.round((totalWorkoutMinutes / 60) * 10) / 10;
    const activeWorkoutDays = days.filter((d) => d.workoutDuration > 0 || d.workoutCalories >= 50).length;
    const avgWorkoutDurationOnActiveDays =
      activeWorkoutDays > 0 ? Math.round(totalWorkoutMinutes / activeWorkoutDays) : 0;

    const weights = days.map((d) => d.bodyweight).filter((w) => w > 50);
    const currentWeight = weights.length > 0 ? weights[weights.length - 1] : 175.0;
    const startWeight = weights.length > 0 ? weights[0] : 175.0;
    const weightDelta = Math.round((currentWeight - startWeight) * 10) / 10;
    const minWeight = weights.length > 0 ? Math.min(...weights) : currentWeight;
    const maxWeight = weights.length > 0 ? Math.max(...weights) : currentWeight;

    const sleepDebtHours = Math.round((8.0 - avgSleepHours) * validSleep.length * 10) / 10;

    const summary: AnalyticsSummary = {
      periodLabel:
        timeframe === 'week'
          ? 'Last 7 Days'
          : timeframe === 'month'
          ? 'Last 30 Days'
          : timeframe === 'year'
          ? 'Last 12 Months'
          : 'All-Time Longitudinal',
      totalDays: days.length,
      trackedDays: days.filter((d) => d.steps > 0 || d.sleepHours > 0 || d.hrv > 0).length,
      avgSleepHours,
      avgSleepText,
      sleepTrackedDays: validSleep.length,
      targetSleepHours: 8.0,
      sleepDebtHours,
      avgRhr,
      minRhr,
      maxRhr,
      rhrTrackedDays: validRhr.length,
      avgHrv,
      maxHrv,
      hrvTrackedDays: validHrv.length,
      avgSteps,
      totalSteps,
      stepGoalHitRate,
      daysOver10k,
      totalWorkoutCalories,
      totalWorkoutMinutes,
      totalWorkoutHours,
      activeWorkoutDays,
      avgWorkoutDurationOnActiveDays,
      currentWeight,
      startWeight,
      weightDelta,
      minWeight,
      maxWeight,
    };

    // Monthly Rollups across all available data for macro view
    const monthMap = new Map<string, DayMetricPoint[]>();
    for (const d of rawRecords) {
      const monthKey = d.date.slice(0, 7); // 'YYYY-MM'
      const arr = monthMap.get(monthKey) || [];
      const parsedSleep = parseSleepDuration(d.sleep_duration || d.sleep_hours);
      arr.push({
        date: d.date,
        dayLabel: '',
        weekday: '',
        steps: parseInt(String(d.steps || '0'), 10) || 0,
        stepsGoal: 10000,
        stepsPercentage: 0,
        hrv: parseFloat(String(d.hrv || '0')) || 0,
        rhr: parseFloat(String(d.rhr || '0')) || 0,
        sleepHours: d.sleep_hours && d.sleep_hours > 0 ? Number(d.sleep_hours) : parsedSleep.hours,
        sleepDuration: '',
        sleepTime: '',
        wakeTime: '',
        bodyweight: parseFloat(String(d.bodyweight || '175')) || 175,
        workoutCalories: parseFloat(String(d.workout_calories || '0')) || 0,
        workoutDuration: parseFloat(String(d.workout_duration || '0')) || 0,
      });
      monthMap.set(monthKey, arr);
    }

    const months: MonthRollup[] = [];
    const sortedMonthKeys = Array.from(monthMap.keys()).sort();

    for (const mKey of sortedMonthKeys) {
      const mDays = monthMap.get(mKey)!;
      const [yStr, mStr] = mKey.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const monthDate = new Date(y, m - 1, 1);
      const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      const mSleep = mDays.filter((x) => x.sleepHours > 0);
      const avgSleep =
        mSleep.length > 0
          ? Math.round((mSleep.reduce((a, b) => a + b.sleepHours, 0) / mSleep.length) * 10) / 10
          : 0;

      const mRhr = mDays.filter((x) => x.rhr > 30);
      const avgRhrVal =
        mRhr.length > 0 ? Math.round(mRhr.reduce((a, b) => a + b.rhr, 0) / mRhr.length) : 0;

      const mHrv = mDays.filter((x) => x.hrv > 0);
      const avgHrvVal =
        mHrv.length > 0 ? Math.round(mHrv.reduce((a, b) => a + b.hrv, 0) / mHrv.length) : 0;

      const mSteps = mDays.reduce((a, b) => a + b.steps, 0);
      const avgStepsVal = mDays.length > 0 ? Math.round(mSteps / mDays.length) : 0;

      const mWorkoutCals = Math.round(mDays.reduce((a, b) => a + b.workoutCalories, 0));
      const mWorkoutMins = Math.round(mDays.reduce((a, b) => a + b.workoutDuration, 0));

      const mWeights = mDays.map((x) => x.bodyweight).filter((w) => w > 50);
      const avgWeight =
        mWeights.length > 0
          ? Math.round((mWeights.reduce((a, b) => a + b, 0) / mWeights.length) * 10) / 10
          : 175.0;

      months.push({
        monthKey: mKey,
        monthLabel,
        year: y,
        daysTracked: mDays.length,
        avgSleep,
        avgRhr: avgRhrVal,
        avgHrv: avgHrvVal,
        totalSteps: mSteps,
        avgSteps: avgStepsVal,
        totalWorkoutCalories: mWorkoutCals,
        totalWorkoutMinutes: mWorkoutMins,
        avgWeight,
      });
    }

    return NextResponse.json({
      success: true,
      timeframe,
      summary,
      days,
      months,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in health analytics API:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
