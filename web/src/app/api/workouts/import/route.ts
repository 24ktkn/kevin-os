import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { calculateEstimated1RM, resolveMuscleGroup } from '../route';

export const dynamic = 'force-dynamic';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
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
      return NextResponse.json({ error: 'CSV file must contain a header and at least one row' }, { status: 400 });
    }

    const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/[\"\'\s_]/g, ''));

    // Detect column indexes flexibly
    const dateIdx = headers.findIndex((h) => h.includes('start') || h.includes('date'));
    const exeIdx = headers.findIndex((h) => h.includes('exercise') || h.includes('movement'));
    const weightIdx = headers.findIndex((h) => h.includes('weight'));
    const repsIdx = headers.findIndex((h) => h.includes('rep'));
    const setIdx = headers.findIndex((h) => h.includes('set') && !h.includes('type'));
    const titleIdx = headers.findIndex((h) => h.includes('title') || h.includes('workout'));
    const durIdx = headers.findIndex((h) => h.includes('duration') || h.includes('second'));

    if (dateIdx === -1 || exeIdx === -1) {
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

    const dbRowsToInsert: any[] = [];
    const sheetsRowsToAppend: string[][] = [];
    const uniqueDates = new Set<string>();
    let skippedCount = 0;

    // Auto set-number tracker per day/exercise in the current CSV
    const currentRunSetCounter = new Map<string, number>();

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCSVLine(lines[i]);
      if (parts.length <= Math.max(dateIdx, exeIdx, weightIdx, repsIdx)) continue;

      let rawDate = parts[dateIdx] || '';
      let formattedDate = rawDate;
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          formattedDate = d.toISOString().split('T')[0];
        }
      } catch {
        formattedDate = rawDate.split(' ')[0] || rawDate;
      }

      const exercise = parts[exeIdx] || '';
      if (!formattedDate || !exercise) continue;

      const weight = parseFloat((parts[weightIdx] || '0').replace(/[^0-9.]/g, '')) || 0;
      const reps = parseInt((parts[repsIdx] || '0').replace(/[^0-9]/g, ''), 10) || 0;

      const dayExeKey = `${formattedDate}|${exercise.toLowerCase()}`;
      let setNum = setIdx !== -1 && parts[setIdx] ? parseInt(parts[setIdx].replace(/[^0-9]/g, ''), 10) || 0 : 0;
      if (setNum <= 0) {
        const currentCount = currentRunSetCounter.get(dayExeKey) || 0;
        setNum = currentCount + 1;
        currentRunSetCounter.set(dayExeKey, setNum);
      }

      // Check duplicate
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
      } else if (/leg|squat|ab|lower/i.test(workoutTitle) || muscle === 'Quads' || muscle === 'Hamstrings & Glutes' || muscle === 'Calves' || muscle === 'Abs/Core') {
        splitDay = 'Legs & Abs (Thigh/Calf Focus)';
      } else if (/push|chest|shoulder|tricep/i.test(workoutTitle) || muscle === 'Chest' || muscle === 'Shoulders' || muscle === 'Triceps') {
        splitDay = 'Push (Chest/Shoulders/Triceps)';
      } else {
        splitDay = workoutTitle || 'General Training';
      }

      const estimated1RM = calculateEstimated1RM(weight, reps);
      let durationMins = 0;
      if (durIdx !== -1 && parts[durIdx]) {
        const rawDur = parseFloat(parts[durIdx]) || 0;
        durationMins = rawDur > 200 ? Math.round(rawDur / 60) : Math.round(rawDur);
      }

      // Supabase format
      dbRowsToInsert.push({
        date: formattedDate,
        split_day: splitDay,
        exercise,
        set_number: setNum,
        weight_lbs: weight,
        reps,
        estimated_1rm: estimated1RM,
        timestamp: '12:00:00',
        duration_mins: 0,
        gym_duration_mins: durationMins || 60,
        distance_km: 0,
      });

      // Sheets backup format
      sheetsRowsToAppend.push([
        formattedDate,
        splitDay,
        exercise,
        String(setNum),
        String(weight),
        String(reps),
        String(estimated1RM),
        '12:00:00',
        '0',
        String(durationMins || 60),
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

    // 2. Non-blocking Google Sheets append (optional backup)
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
