import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
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
    const sheets = getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'workout_logs!A1:K3000',
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
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

    const parsedLogs: WorkoutLogEntry[] = [];
    const now = new Date();

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

      // Effective volume
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

    // Sort descending by date, then setNumber
    parsedLogs.sort((a, b) => {
      const cmp = b.date.localeCompare(a.date);
      if (cmp !== 0) return cmp;
      return a.setNumber - b.setNumber;
    });

    // 1. Group by Workout Session (Date + SplitDay)
    const sessionMap = new Map<string, {
      date: string;
      splitDay: string;
      exercises: Set<string>;
      setCount: number;
      totalVolume: number;
      gymDuration: number;
    }>();

    for (const log of parsedLogs) {
      const key = `${log.date}_${log.splitDay}`;
      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          date: log.date,
          splitDay: log.splitDay,
          exercises: new Set<string>(),
          setCount: 0,
          totalVolume: 0,
          gymDuration: log.gymDurationMins || 60,
        });
      }
      const sess = sessionMap.get(key)!;
      sess.exercises.add(log.exercise);
      sess.setCount += 1;
      sess.totalVolume += log.effectiveVolume;
      if (log.gymDurationMins && log.gymDurationMins > sess.gymDuration) {
        sess.gymDuration = log.gymDurationMins;
      }
    }

    const recentSessions: WorkoutSessionSummary[] = Array.from(sessionMap.values()).map((s) => ({
      date: s.date,
      splitDay: s.splitDay,
      exerciseCount: s.exercises.size,
      setCount: s.setCount,
      totalVolumeLbs: Math.round(s.totalVolume),
      gymDurationMins: Math.round(s.gymDuration),
      exercises: Array.from(s.exercises),
    })).sort((a, b) => b.date.localeCompare(a.date));

    // 2. Compute Total Volume and Average Duration
    const totalVolumeLbs = recentSessions.reduce((acc, s) => acc + s.totalVolumeLbs, 0);
    const avgDuration = recentSessions.length > 0
      ? Math.round(recentSessions.reduce((acc, s) => acc + s.gymDurationMins, 0) / recentSessions.length)
      : 0;

    // 3. Compute Muscle Recovery Matrix
    const targetMuscles = [
      'Chest',
      'Back',
      'Shoulders',
      'Quads',
      'Hamstrings & Glutes',
      'Biceps',
      'Triceps',
      'Calves',
      'Abs/Core',
    ];

    const muscleRecovery: MuscleRecoveryStatus[] = targetMuscles.map((mg) => {
      // Find latest log for this muscle group
      const matchingLogs = parsedLogs.filter((l) => l.muscleGroup === mg);
      if (matchingLogs.length === 0) {
        return {
          muscleGroup: mg,
          lastTrainedDate: null,
          hoursElapsed: null,
          status: 'fresh',
          lastExercises: [],
        };
      }

      const latestLog = matchingLogs[0];
      const latestDate = new Date(latestLog.date + 'T12:00:00');
      const hoursDiff = Math.max(0, Math.round((now.getTime() - latestDate.getTime()) / (1000 * 60 * 60)));

      let status: 'fresh' | 'recovering' | 'fatigued' = 'fresh';
      if (hoursDiff < 24) {
        status = 'fatigued';
      } else if (hoursDiff <= 72) {
        status = 'recovering';
      }

      const recentExes = Array.from(
        new Set(matchingLogs.filter((l) => l.date === latestLog.date).map((l) => l.exercise))
      ).slice(0, 3);

      return {
        muscleGroup: mg,
        lastTrainedDate: latestLog.date,
        hoursElapsed: hoursDiff,
        status,
        lastExercises: recentExes,
      };
    });

    // 4. Compute Personal Records (PRs) per Exercise
    const prMap = new Map<string, ExercisePR>();
    for (const log of parsedLogs) {
      if (log.weightLbs <= 0) continue;
      const current = prMap.get(log.exercise);
      if (!current || log.estimated1RM > current.bestEstimated1RM) {
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

    const personalRecords = Array.from(prMap.values())
      .sort((a, b) => b.bestEstimated1RM - a.bestEstimated1RM)
      .slice(0, 15);

    return NextResponse.json<WorkoutsResponseData>({
      success: true,
      totalWorkouts: recentSessions.length,
      totalVolumeLbs,
      averageDurationMins: avgDuration,
      recentSessions: recentSessions.slice(0, 20),
      muscleRecovery,
      personalRecords,
      recentLogs: parsedLogs.slice(0, 50),
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error fetching workout data:', errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
