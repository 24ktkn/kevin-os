import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getCalendarDateString } from '@/lib/date-utils';
import { calculateEstimated1RM, resolveMuscleGroup } from '../route';

export const dynamic = 'force-dynamic';

/**
 * RFC-4180 compliant CSV line parser (only double-quotes `"` delimit quoted fields so apostrophes `'` in exercise names are preserved).
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { csvContent } = body;

    if (!csvContent || typeof csvContent !== 'string') {
      return NextResponse.json({ error: 'No CSV content provided' }, { status: 400 });
    }

    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV file must contain a header and at least one row' },
        { status: 400 }
      );
    }

    const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/["'\s_]/g, ''));

    // Detect column indexes flexibly
    const startIdx = headers.findIndex((h) => h.includes('starttime') || h.includes('date'));
    const endIdx = headers.findIndex((h) => h.includes('endtime'));
    const exeIdx = headers.findIndex((h) => h.includes('exercise') || h.includes('movement'));
    const weightIdx = headers.findIndex((h) => h.includes('weight'));
    const repsIdx = headers.findIndex((h) => h.includes('rep'));
    const setIdx = headers.findIndex((h) => h.includes('set') && !h.includes('type'));
    const titleIdx = headers.findIndex((h) => h.includes('title') || h.includes('workout'));
    const setDurIdx = headers.findIndex((h) => h.includes('durationseconds') || h.includes('duration'));

    if (startIdx === -1 || exeIdx === -1) {
      return NextResponse.json(
        { error: 'CSV missing required Date or Exercise column headers' },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin || supabase;
    const existingKeys = new Set<string>();

    // 1. Fetch existing keys from Supabase
    if (sb) {
      try {
        const { data: existingRows } = await sb.from('workout_logs').select('date, exercise, set_number');
        if (existingRows) {
          for (const r of existingRows) {
            existingKeys.add(`${r.date}|${String(r.exercise).toLowerCase()}|${r.set_number}`);
          }
        }
      } catch (err) {
        console.warn('Supabase workout_logs existing check notice:', err);
      }
    }

    // Fallback: Check existing from Sheets if Supabase had none
    if (existingKeys.size === 0) {
      try {
        const sheets = getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'workout_logs!A:E',
        });
        const existingRows = res.data.values || [];
        for (let i = 1; i < existingRows.length; i++) {
          const r = existingRows[i];
          const d = String(r[0] || '').trim();
          const exe = String(r[2] || '').trim().toLowerCase();
          const setN = String(r[3] || '').trim();
          if (d && exe) {
            existingKeys.add(`${d}|${exe}|${setN}`);
          }
        }
      } catch (sheetsErr) {
        console.warn('Sheets existing check fallback notice:', sheetsErr);
      }
    }

    const dbRowsToInsert: Record<string, unknown>[] = [];
    const sheetsRowsToAppend: string[][] = [];
    const uniqueDates = new Set<string>();
    let skippedCount = 0;

    // Detect if the CSV uses 0-indexed set_index (standard Hevy export starts sets at 0)
    let isZeroIndexedSetCol = false;
    if (setIdx !== -1) {
      for (let i = 1; i < Math.min(lines.length, 25); i++) {
        const p = parseCSVLine(lines[i]);
        if (p[setIdx]?.trim() === '0') {
          isZeroIndexedSetCol = true;
          break;
        }
      }
    }

    const currentRunSetCounter = new Map<string, number>();

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCSVLine(lines[i]);
      if (parts.length <= Math.max(startIdx, exeIdx)) continue;

      const rawDate = parts[startIdx] || '';
      const formattedDate = getCalendarDateString(rawDate);
      const exercise = parts[exeIdx] || '';
      if (!formattedDate || !exercise) continue;

      const weight =
        weightIdx !== -1 && parts[weightIdx]
          ? parseFloat(parts[weightIdx].replace(/[^0-9.]/g, '')) || 0
          : 0;
      const reps =
        repsIdx !== -1 && parts[repsIdx]
          ? parseInt(parts[repsIdx].replace(/[^0-9]/g, ''), 10) || 0
          : 0;

      const dayExeKey = `${formattedDate}|${exercise.toLowerCase()}`;
      let setNum = 0;
      if (setIdx !== -1 && parts[setIdx] !== undefined && parts[setIdx].trim() !== '') {
        const parsedSet = parseInt(parts[setIdx].replace(/[^0-9]/g, ''), 10);
        if (!isNaN(parsedSet)) {
          setNum = isZeroIndexedSetCol ? parsedSet + 1 : parsedSet;
        }
      }
      if (setNum <= 0) {
        const currentCount = currentRunSetCounter.get(dayExeKey) || 0;
        setNum = currentCount + 1;
      }
      currentRunSetCounter.set(dayExeKey, setNum);

      const dedupKey = `${formattedDate}|${exercise.toLowerCase()}|${setNum}`;
      if (existingKeys.has(dedupKey)) {
        skippedCount++;
        continue;
      }
      existingKeys.add(dedupKey);

      // Derive Split Day
      let splitDay = 'Push (Chest/Shoulders/Triceps)';
      const workoutTitle = titleIdx !== -1 ? parts[titleIdx] : '';
      const muscle = resolveMuscleGroup(exercise);

      if (/pull|back|bicep/i.test(workoutTitle) || muscle === 'Back' || muscle === 'Biceps') {
        splitDay = 'Pull (Back/Biceps)';
      } else if (
        /leg|squat|ab|lower/i.test(workoutTitle) ||
        muscle === 'Quads' ||
        muscle === 'Hamstrings & Glutes' ||
        muscle === 'Calves' ||
        muscle === 'Abs/Core'
      ) {
        splitDay = 'Legs & Abs (Thigh/Calf Focus)';
      } else if (
        /push|chest|shoulder|tricep/i.test(workoutTitle) ||
        muscle === 'Chest' ||
        muscle === 'Shoulders' ||
        muscle === 'Triceps'
      ) {
        splitDay = 'Push (Chest/Shoulders/Triceps)';
      } else {
        splitDay = workoutTitle || 'General Training';
      }

      const estimated1RM = calculateEstimated1RM(weight, reps);

      // Compute gym session duration from start_time -> end_time if present, otherwise default 60m
      let gymDurationMins = 60;
      if (endIdx !== -1 && parts[endIdx] && rawDate) {
        const dStart = new Date(rawDate);
        const dEnd = new Date(parts[endIdx]);
        if (!isNaN(dStart.getTime()) && !isNaN(dEnd.getTime())) {
          const diffMins = Math.round((dEnd.getTime() - dStart.getTime()) / 60000);
          if (diffMins >= 10 && diffMins <= 240) {
            gymDurationMins = diffMins;
          }
        }
      }

      let setDurationMins = 0;
      if (setDurIdx !== -1 && parts[setDurIdx]) {
        const rawSec = parseFloat(parts[setDurIdx]) || 0;
        setDurationMins = Math.round((rawSec / 60) * 10) / 10;
      }

      dbRowsToInsert.push({
        date: formattedDate,
        split_day: splitDay,
        exercise,
        set_number: setNum,
        weight_lbs: weight,
        reps,
        estimated_1rm: estimated1RM,
        timestamp: '12:00:00',
        duration_mins: setDurationMins,
        gym_duration_mins: gymDurationMins,
        distance_km: 0,
      });

      sheetsRowsToAppend.push([
        formattedDate,
        splitDay,
        exercise,
        String(setNum),
        String(weight),
        String(reps),
        String(estimated1RM),
        '12:00:00',
        String(setDurationMins),
        String(gymDurationMins),
        '0',
      ]);

      uniqueDates.add(formattedDate);
    }

    // 1. Primary write to Supabase workout_logs
    if (sb && dbRowsToInsert.length > 0) {
      try {
        const { error: insErr } = await sb.from('workout_logs').insert(dbRowsToInsert);
        if (insErr) {
          console.warn('Supabase workout_logs insert notice:', insErr.message);
        }
      } catch (sbErr) {
        console.warn('Supabase workout_logs insert error:', sbErr);
      }
    }

    // 2. Non-blocking Google Sheets append
    if (sheetsRowsToAppend.length > 0) {
      try {
        const sheets = getGoogleSheetsClient();
        sheets.spreadsheets.values
          .append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'workout_logs!A:K',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: sheetsRowsToAppend },
          })
          .catch((e) => console.warn('Background sheets workout append notice:', e));
      } catch {
        // silent
      }
    }

    return NextResponse.json({
      success: true,
      importedSetsCount: dbRowsToInsert.length,
      importedWorkoutsCount: uniqueDates.size,
      skippedCount,
      message: `Successfully imported ${dbRowsToInsert.length} sets across ${uniqueDates.size} workout sessions (${skippedCount} duplicates skipped).`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in Hevy CSV import:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
