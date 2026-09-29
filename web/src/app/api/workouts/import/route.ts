import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
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

    if (dateIdx === -1 || exeIdx === -1 || weightIdx === -1 || repsIdx === -1) {
      return NextResponse.json(
        { error: 'CSV missing required Hevy columns (Date/Start Time, Exercise, Weight, Reps)' },
        { status: 400 }
      );
    }

    const sheets = getGoogleSheetsClient();
    const existingRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'workout_logs!A1:K3000',
    });

    const existingRows = existingRes.data.values || [];
    const existingKeys = new Set<string>();

    if (existingRows.length > 1) {
      const eDateIdx = 0;
      const eExeIdx = 2;
      const eSetIdx = 3;
      for (let i = 1; i < existingRows.length; i++) {
        const r = existingRows[i];
        const key = `${String(r[eDateIdx] || '').trim()}|${String(r[eExeIdx] || '').trim().toLowerCase()}|${String(r[eSetIdx] || '').trim()}`;
        existingKeys.add(key);
      }
    }

    const newRowsToAppend: string[][] = [];
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

      const weight = parseFloat(parts[weightIdx].replace(/[^0-9.]/g, '')) || 0;
      const reps = parseInt(parts[repsIdx].replace(/[^0-9]/g, ''), 10) || 0;

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

      const row = [
        formattedDate, // Date
        splitDay,      // Split Day
        exercise,      // Exercise
        String(setNum),// Set Number
        String(weight),// Weight (lbs)
        String(reps),  // Reps
        String(estimated1RM), // Estimated 1RM
        '12:00:00',    // Timestamp
        '0',           // Duration (Mins)
        String(durationMins || 60), // Gym Duration (Mins)
        '0',           // Distance (km)
      ];

      newRowsToAppend.push(row);
      uniqueDates.add(formattedDate);
    }

    if (newRowsToAppend.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'workout_logs!A:K',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: newRowsToAppend },
      });
    }

    return NextResponse.json({
      success: true,
      importedSetsCount: newRowsToAppend.length,
      importedWorkoutsCount: uniqueDates.size,
      skippedCount,
      message: `Successfully imported ${newRowsToAppend.length} sets across ${uniqueDates.size} workout sessions (${skippedCount} duplicates skipped).`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in Hevy CSV import:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
