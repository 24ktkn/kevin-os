import { NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getTimezoneOffsetStr } from '@/lib/date-utils';
import {
  WorkoutLogEntry,
  MuscleRecoveryStatus,
  ExercisePR,
  WorkoutSessionSummary,
  WorkoutsResponseData,
} from '@/types/workout';

export const dynamic = 'force-dynamic';

const muscleGroupCache = new Map<string, string>();

export function resolveMuscleGroup(exerciseName: string): string {
  const exe = exerciseName.toLowerCase().trim();
  const cached = muscleGroupCache.get(exe);
  if (cached) return cached;

  let group = 'Full Body';
  if (/knee raise|ab |crunch|woodchopper|twist|plank|leg raise|sit up/.test(exe)) {
    group = 'Abs/Core';
  } else if (/squat|leg press|lunge|quad|leg extension/.test(exe)) {
    group = /tricep/.test(exe) ? 'Triceps' : 'Quads';
  } else if (/rdl|romanian|leg curl|hamstring|glute|hip thrust/.test(exe)) {
    group = /bicep|hammer/.test(exe) ? 'Biceps' : 'Hamstrings & Glutes';
  } else if (/calf|calves/.test(exe)) {
    group = 'Calves';
  } else if (/bench|push up|chest fly|incline press|cable fly|pec deck|chest press/.test(exe)) {
    group = 'Chest';
  } else if (/pull up|chin up|row|lat pull|pulldown|face pull|shrug|deadlift|lat pulldown/.test(exe)) {
    group = 'Back';
  } else if (/shoulder press|overhead press|lateral raise|front raise|arnold press|upright row|military press/.test(exe)) {
    group = 'Shoulders';
  } else if (/bicep|curl|preacher|hammer/.test(exe)) {
    group = 'Biceps';
  } else if (/tricep|skull crusher|pushdown|dip/.test(exe)) {
    group = 'Triceps';
  }

  muscleGroupCache.set(exe, group);
  return group;
}

export function calculateEstimated1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30.0) * 10) / 10;
}

const CARDIO_REGEX = /cardio|treadmill|run|walk|bike|cycle|elliptical|rower/i;

export async function GET() {
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
            const isCardio = CARDIO_REGEX.test(exercise);
            const effectiveVol = isCardio ? 0 : weight === 0 ? 175.2 * reps : weight * reps;
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

    // 2. Fallback to Google Sheets
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

            const isCardio = CARDIO_REGEX.test(exercise);
            const effectiveVol = isCardio ? 0 : weight === 0 ? 175.2 * reps : weight * reps;
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

    // Sort descending by date, then ascending by setNumber
    parsedLogs.sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
      return a.setNumber - b.setNumber;
    });

    const now = new Date();

    // Single-pass grouping by session date, muscle group, and PRs
    const sessionMap = new Map<string, WorkoutLogEntry[]>();
    const muscleMap = new Map<string, WorkoutLogEntry[]>();
    const prMap = new Map<string, ExercisePR>();

    for (const log of parsedLogs) {
      // Session grouping (insertion order is already descending by date)
      const sArr = sessionMap.get(log.date) || [];
      sArr.push(log);
      sessionMap.set(log.date, sArr);

      // Muscle grouping
      const mArr = muscleMap.get(log.muscleGroup) || [];
      mArr.push(log);
      muscleMap.set(log.muscleGroup, mArr);

      // Personal Records (support both weighted 1RM and bodyweight max reps)
      if (log.weightLbs > 0 || log.reps > 0) {
        const currentPR = prMap.get(log.exercise);
        const isBetterWeighted = log.estimated1RM > (currentPR?.bestEstimated1RM || 0);
        const isBetterBodyweight =
          log.weightLbs === 0 &&
          currentPR?.maxWeightLbs === 0 &&
          log.reps > currentPR.maxRepsAtMaxWeight;

        if (!currentPR || isBetterWeighted || isBetterBodyweight) {
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
    }

    const totalWorkouts = sessionMap.size;
    let totalVolumeLbs = 0;
    let totalDurationMins = 0;
    const recentSessions: WorkoutSessionSummary[] = [];

    for (const [d, sets] of sessionMap.entries()) {
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

    // 2. Muscle Recovery Matrix (O(1) lookup from muscleMap)
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
      const setsOfMuscle = muscleMap.get(muscle) || [];
      if (setsOfMuscle.length === 0) {
        return {
          muscleGroup: muscle,
          lastTrainedDate: null,
          hoursElapsed: null,
          status: 'fresh',
          lastExercises: [],
        };
      }

      const mostRecentSet = setsOfMuscle[0];
      let hoursElapsed: number | null = null;
      try {
        const tzOffset = getTimezoneOffsetStr(mostRecentSet.date);
        const sDate = new Date(`${mostRecentSet.date}T12:00:00${tzOffset}`);
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

      const recentExercises: string[] = [];
      const seenExe = new Set<string>();
      for (const s of setsOfMuscle) {
        if (s.date !== mostRecentSet.date) break;
        if (!seenExe.has(s.exercise)) {
          seenExe.add(s.exercise);
          recentExercises.push(s.exercise);
        }
      }

      return {
        muscleGroup: muscle,
        lastTrainedDate: mostRecentSet.date,
        hoursElapsed,
        status,
        lastExercises: recentExercises,
      };
    });

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
    return NextResponse.json(
      {
        success: false,
        totalWorkouts: 0,
        totalVolumeLbs: 0,
        averageDurationMins: 0,
        recentSessions: [],
        muscleRecovery: [],
        personalRecords: [],
        recentLogs: [],
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
