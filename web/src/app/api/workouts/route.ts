import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  WorkoutLogEntry,
  MuscleRecoveryStatus,
  ExercisePR,
  WorkoutSessionSummary,
  WorkoutsResponseData,
} from '@/types/workout';

export const dynamic = 'force-dynamic';

export function resolveMuscleGroup(exerciseName: string): string {
  const exe = exerciseName.toLowerCase();
  if (/knee raise|ab |crunch|woodchopper|twist|plank|leg raise|sit up/.test(exe)) return 'Abs/Core';
  if (/squat|leg press|lunge|quad|leg extension/.test(exe)) {
    if (/tricep/.test(exe)) return 'Triceps';
    return 'Quads';
  }
  if (/rdl|romanian|leg curl|hamstring|glute|hip thrust/.test(exe)) {
    if (/bicep|hammer/.test(exe)) return 'Biceps';
    return 'Hamstrings & Glutes';
  }
  if (/calf|calves/.test(exe)) return 'Calves';
  if (/bench|push up|chest fly|incline press|cable fly|pec deck|chest press/.test(exe)) return 'Chest';
  if (/pull up|chin up|row|lat pull|pulldown|face pull|shrug|deadlift|lat pulldown/.test(exe)) return 'Back';
  if (/shoulder press|overhead press|lateral raise|front raise|arnold press|upright row|military press/.test(exe)) return 'Shoulders';
  if (/bicep|curl|preacher|hammer/.test(exe)) return 'Biceps';
  if (/tricep|skull crusher|pushdown|dip/.test(exe)) return 'Triceps';
  return 'Full Body';
}

export function calculateEstimated1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  // Epley formula: w * (1 + r / 30)
  return Math.round((weight * (1 + reps / 30.0)) * 10) / 10;
}

export async function GET(req: NextRequest) {
  try {
    let parsedLogs: WorkoutLogEntry[] = [];
    const sb = supabaseAdmin || supabase;

    // 1. Primary: Load from Supabase workout_logs (sub-20ms)
    if (sb) {
      try {
        const { data: dbRows, error: dbErr } = await sb
          .from('workout_logs')
          .select('*')
          .order('date', { ascending: false });

        if (!dbErr && dbRows && dbRows.length > 0) {
          parsedLogs = dbRows.map((r, i) => {
            const exercise = String(r.exercise || '').trim();
            const weight = parseFloat(String(r.weight_lbs || '0')) || 0;
            const reps = parseInt(String(r.reps || '0'), 10) || 0;
            const isCardio = /cardio|treadmill|run|walk|bike|cycle|elliptical|rower/.test(exercise.toLowerCase());
            const effectiveVol = isCardio ? 0 : (weight === 0 ? 175.2 * reps : weight * reps);
            const muscleGroup = resolveMuscleGroup(exercise);

            return {
              id: r.id || `${r.date}_${exercise}_${r.set_number}_${i}`,
              date: String(r.date).trim(),
              splitDay: r.split_day || 'General Training',
              exercise,
              setNumber: parseInt(String(r.set_number || '1'), 10) || 1,
              weightLbs: weight,
              reps,
              estimated1RM: parseFloat(String(r.estimated_1rm || '0')) || calculateEstimated1RM(weight, reps),
              timestamp: r.timestamp || '',
              durationMins: parseFloat(String(r.duration_mins || '0')) || 0,
              gymDurationMins: parseFloat(String(r.gym_duration_mins || '60')) || 60,
              distanceKm: parseFloat(String(r.distance_km || '0')) || 0,
              effectiveVolume: Math.round(effectiveVol),
              muscleGroup,
            };
          });
        }
      } catch (sbErr) {
        console.warn('Supabase workout_logs fetch notice:', sbErr);
      }
    }

    // 2. Fallback to Google Sheets (safety net during migration)
    if (parsedLogs.length === 0) {
      try {
        const sheets = getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'workout_logs!A1:K3000',
        });

        const rows = res.data.values || [];
        if (rows.length > 1) {
          const headers = rows[0].map((h: string) => String(h).trim().toLowerCase());
          const dateIdx = headers.indexOf('date');
          const splitIdx = headers.indexOf('split day');
          const exeIdx = headers.indexOf('exercise');
          const setIdx = headers.indexOf('set number');
          const weightIdx = headers.indexOf('weight (lbs)');
          const repsIdx = headers.indexOf('reps');
          const oneRmIdx = headers.indexOf('estimated 1rm');
          const timeIdx = headers.indexOf('timestamp');
          const durIdx = headers.indexOf('duration (mins)');
          const gymDurIdx = headers.indexOf('gym duration (mins)');
          const distIdx = headers.indexOf('distance (km)');

          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const dateStr = String(r[dateIdx] || '').trim();
            const exercise = String(r[exeIdx] || '').trim();
            if (!dateStr || !exercise) continue;

            const weight = parseFloat(String(r[weightIdx] || '0').replace(/,/g, '')) || 0;
            const reps = parseInt(String(r[repsIdx] || '0').replace(/,/g, ''), 10) || 0;
            const setNum = parseInt(String(r[setIdx] || '1'), 10) || 1;
            const splitDay = String(r[splitIdx] || 'General').trim();
            const raw1RM = parseFloat(String(r[oneRmIdx] || '0')) || calculateEstimated1RM(weight, reps);
            const gymDur = parseFloat(String(r[gymDurIdx] || '0')) || 0;
            const dur = parseFloat(String(r[durIdx] || '0')) || 0;
            const dist = parseFloat(String(r[distIdx] || '0')) || 0;

            const isCardio = /cardio|treadmill|run|walk|bike|cycle|elliptical|rower/.test(exercise.toLowerCase());
            const effectiveVol = isCardio ? 0 : (weight === 0 ? 175.2 * reps : weight * reps);
            const muscleGroup = resolveMuscleGroup(exercise);

            parsedLogs.push({
              id: `${dateStr}_${exercise}_${setNum}_${i}`,
              date: dateStr,
              splitDay,
              exercise,
              setNumber: setNum,
              weightLbs: weight,
              reps,
              estimated1RM: raw1RM,
              timestamp: String(r[timeIdx] || ''),
              durationMins: dur,
              gymDurationMins: gymDur,
              distanceKm: dist,
              effectiveVolume: Math.round(effectiveVol),
              muscleGroup,
            });
          }
        }
      } catch (sheetsErr) {
        console.warn('Sheets fallback notice in workout GET:', sheetsErr);
      }
    }

    if (parsedLogs.length === 0) {
      return NextResponse.json<WorkoutsResponseData>({
        success: true,
        totalWorkouts: 0,
        totalVolumeLbs: 0,
        averageDurationMins: 0,
        recentSessions: [],
        muscleRecovery: [],
        personalRecords: [],
        recentLogs: [],
      });
    }

    // Sort descending by date, then setNumber
    parsedLogs.sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
      return a.setNumber - b.setNumber;
    });

    const now = new Date();

    // 1. Group sessions by Date
    const sessionMap = new Map<string, WorkoutLogEntry[]>();
    for (const log of parsedLogs) {
      const arr = sessionMap.get(log.date) || [];
      arr.push(log);
      sessionMap.set(log.date, arr);
    }

    const totalWorkouts = sessionMap.size;
    let totalVolumeLbs = 0;
    let totalDurationMins = 0;
    const recentSessions: WorkoutSessionSummary[] = [];

    const sortedDates = Array.from(sessionMap.keys()).sort((a, b) => b.localeCompare(a));

    for (const d of sortedDates) {
      const sets = sessionMap.get(d) || [];
      const volume = sets.reduce((sum, s) => sum + s.effectiveVolume, 0);
      totalVolumeLbs += volume;

      const dur = sets[0]?.gymDurationMins || 60;
      totalDurationMins += dur;

      const split = sets[0]?.splitDay || 'General Training';
      const exercises = Array.from(new Set(sets.map((s) => s.exercise)));

      recentSessions.push({
        date: d,
        splitDay: split,
        exerciseCount: exercises.length,
        setCount: sets.length,
        totalVolumeLbs: Math.round(volume),
        gymDurationMins: dur,
        exercises,
      });
    }

    const averageDurationMins = totalWorkouts > 0 ? Math.round(totalDurationMins / totalWorkouts) : 0;

    // 2. Muscle Recovery Matrix
    const trackedMuscles = [
      'Chest',
      'Back',
      'Quads',
      'Hamstrings & Glutes',
      'Shoulders',
      'Biceps',
      'Triceps',
      'Abs/Core',
      'Calves',
    ];

    const muscleRecovery: MuscleRecoveryStatus[] = trackedMuscles.map((muscle) => {
      const setsOfMuscle = parsedLogs.filter((l) => l.muscleGroup === muscle);
      if (setsOfMuscle.length === 0) {
        return {
          muscleGroup: muscle,
          lastTrainedDate: null,
          hoursElapsed: null,
          status: 'fresh',
          lastExercises: [],
        };
      }

      const mostRecentSet = setsOfMuscle[0]; // parsedLogs is sorted descending by date
      let hoursElapsed: number | null = null;
      try {
        const sDate = new Date(mostRecentSet.date + 'T12:00:00');
        const diffMs = now.getTime() - sDate.getTime();
        hoursElapsed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
      } catch {
        hoursElapsed = null;
      }

      let status: 'fresh' | 'recovering' | 'fatigued' = 'fresh';
      if (hoursElapsed !== null) {
        if (hoursElapsed < 24) {
          status = 'fatigued';
        } else if (hoursElapsed <= 72) {
          status = 'recovering';
        } else {
          status = 'fresh';
        }
      }

      const recentExercises = Array.from(
        new Set(
          setsOfMuscle
            .filter((s) => s.date === mostRecentSet.date)
            .map((s) => s.exercise)
        )
      );

      return {
        muscleGroup: muscle,
        lastTrainedDate: mostRecentSet.date,
        hoursElapsed,
        status,
        lastExercises: recentExercises,
      };
    });

    // 3. Personal Records (1RM) per Exercise
    const prMap = new Map<string, ExercisePR>();

    for (const log of parsedLogs) {
      if (log.weightLbs <= 0 && log.reps <= 0) continue;
      const currentPR = prMap.get(log.exercise);
      if (!currentPR || log.estimated1RM > currentPR.bestEstimated1RM) {
        prMap.set(log.exercise, {
          exercise: log.exercise,
          maxWeightLbs: log.weightLbs,
          maxRepsAtMaxWeight: log.reps,
          bestEstimated1RM: log.estimated1RM,
          dateAchieved: log.date,
          muscleGroup: log.muscleGroup,
        });
      }
    }

    const personalRecords = Array.from(prMap.values()).sort(
      (a, b) => b.bestEstimated1RM - a.bestEstimated1RM
    );

    return NextResponse.json<WorkoutsResponseData>({
      success: true,
      totalWorkouts,
      totalVolumeLbs: Math.round(totalVolumeLbs),
      averageDurationMins,
      recentSessions: recentSessions.slice(0, 15),
      muscleRecovery,
      personalRecords: personalRecords.slice(0, 20),
      recentLogs: parsedLogs.slice(0, 50),
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in workouts GET:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
