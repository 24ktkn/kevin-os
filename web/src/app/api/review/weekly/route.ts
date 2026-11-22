import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { addDaysToDateStr, getTodayDateStr } from '@/lib/date-utils';
import { computeDailyReadiness } from '@/lib/readiness';
import { getDetectedElentraExams } from '@/lib/elentra-exams';
import { isMissingAnkiTableError } from '@/lib/anki-utils';
import { WeeklyExecutiveReview } from '@/types/digests';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

function computeGrade(score: number): WeeklyExecutiveReview['overallGrade'] {
  if (score >= 92) return 'A+';
  if (score >= 84) return 'A';
  if (score >= 76) return 'B+';
  if (score >= 68) return 'B';
  if (score >= 58) return 'C+';
  return 'C';
}

async function synthesizeWeeklyWithAI(
  review: Omit<WeeklyExecutiveReview, 'headline' | 'executiveSummary' | 'wins' | 'watchouts' | 'nextWeekAdjustments'>
): Promise<{
  headline: string;
  executiveSummary: string;
  wins: string[];
  watchouts: string[];
  nextWeekAdjustments: string[];
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  const fallback = {
    headline: `Week of ${review.weekStart} — Grade ${review.overallGrade}`,
    executiveSummary: `You completed ${review.pillars.academics.tasksCompleted}/${review.pillars.academics.tasksTotal} tasks (${review.pillars.academics.completionRate}%), reviewed ${review.pillars.anki.totalReviews} Anki cards across ${review.pillars.anki.activeDays} days, averaged ${review.pillars.health.avgSleepHours}h sleep (Readiness ${review.pillars.health.avgReadiness}/100), trained ${review.pillars.workouts.sessionsCount} times, and hit ${review.pillars.habits.overallPct}% habit consistency.`,
    wins: [
      `${review.pillars.habits.overallPct}% overall habit consistency across the 7-day window.`,
      `${review.pillars.workouts.sessionsCount} gym sessions logged (${review.pillars.workouts.totalSets} total sets).`,
      `${review.pillars.anki.totalReviews} Anki cards reviewed (${review.pillars.anki.avgRetentionPct}% avg retention).`,
    ],
    watchouts: [
      review.pillars.health.avgSleepHours > 0 && review.pillars.health.avgSleepHours < 7
        ? `Average sleep dipped to ${review.pillars.health.avgSleepHours}h — protect bedtime to support memory consolidation.`
        : 'Watch evening drift so your 6:00 AM wake-up streak stays effortless.',
      review.pillars.anki.dueRemainingNow > 0
        ? `${review.pillars.anki.dueRemainingNow} Anki cards are still queued right now.`
        : 'Keep unsuspending cards right after finishing Schulich online modules.',
    ],
    nextWeekAdjustments: [
      review.pillars.academics.inTaperMode
        ? `Exam Taper Mode is active for ${review.pillars.academics.nextMajorExam} — prioritize Anki & past practice questions over optional tasks.`
        : 'Use /school AI Recommended Scheduler Sunday night to timeblock the week’s online modules around classes.',
      'Hit your 7:30 AM Morning Brief and schedule Anki reviews early before fatigue builds.',
      'Log any new shadowing, research, or leadership hours in /portfolio while details are fresh.',
    ],
  };

  if (!apiKey) return fallback;

  const prompt = `You are the Executive Performance Coach for Kevin-OS (Kevin Nguyen, Western Schulich medical student).
Write a crisp, high-signal Sunday Weekly Executive Review based strictly on these 7-day numbers (${review.weekStart} to ${review.weekEnd}):
${JSON.stringify(review.pillars, null, 2)}

Return ONLY a raw JSON object with this exact schema:
{
  "headline": "Short punchy 6-10 word weekly headline",
  "executiveSummary": "2-3 sentence synthesis tying together med school, Anki, sleep/readiness, workouts, and habits.",
  "wins": ["3 specific data-backed wins from this week"],
  "watchouts": ["2 honest, constructive bottlenecks spotted in the numbers"],
  "nextWeekAdjustments": ["3 concrete, actionable moves for next week"]
}`;

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed?.headline && parsed?.executiveSummary) {
        return {
          headline: String(parsed.headline),
          executiveSummary: String(parsed.executiveSummary),
          wins: Array.isArray(parsed.wins) ? parsed.wins.map(String).slice(0, 4) : fallback.wins,
          watchouts: Array.isArray(parsed.watchouts)
            ? parsed.watchouts.map(String).slice(0, 3)
            : fallback.watchouts,
          nextWeekAdjustments: Array.isArray(parsed.nextWeekAdjustments)
            ? parsed.nextWeekAdjustments.map(String).slice(0, 4)
            : fallback.nextWeekAdjustments,
        };
      }
    } catch {
      // next model
    } finally {
      clearTimeout(timer);
    }
  }
  return fallback;
}

async function generateWeeklyReview(weekEnd: string): Promise<WeeklyExecutiveReview> {
  const weekStart = addDaysToDateStr(weekEnd, -6);
  const sb = supabaseAdmin || supabase;

  const [
    tasksRes,
    schoolRes,
    ankiRes,
    bioRes,
    workoutRes,
    habitsRes,
    journalRes,
    portfolioRes,
    taperStatus,
  ] = await Promise.all([
    sb
      ? sb
          .from('tasks')
          .select('id, title, due_date, is_completed, type')
          .gte('due_date', weekStart)
          .lte('due_date', weekEnd)
      : Promise.resolve({ data: [] }),
    sb
      ? sb
          .from('school_items')
          .select('uid, category, is_completed, updated_at')
          .eq('category', 'module')
          .eq('is_completed', true)
      : Promise.resolve({ data: [] }),
    sb
      ? sb
          .from('anki_daily_stats')
          .select('*')
          .gte('date', weekStart)
          .lte('date', weekEnd)
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] }),
    sb
      ? sb
          .from('biometrics')
          .select('date, sleep_hours, hrv, rhr, steps, bodyweight, workout_duration, workout_calories')
          .lte('date', weekEnd)
          .order('date', { ascending: false })
          .limit(21)
      : Promise.resolve({ data: [] }),
    sb
      ? sb
          .from('workout_logs')
          .select('date, exercise, weight_lbs, reps')
          .gte('date', weekStart)
          .lte('date', weekEnd)
      : Promise.resolve({ data: [] }),
    sb
      ? sb
          .from('habits')
          .select('date, wake_up_on_time, gym_workout, journaling, anki')
          .gte('date', weekStart)
          .lte('date', weekEnd)
      : Promise.resolve({ data: [] }),
    sb
      ? sb
          .from('journal_entries')
          .select('date')
          .gte('date', weekStart)
          .lte('date', weekEnd)
      : Promise.resolve({ data: [] }),
    sb
      ? sb.from('portfolio_entries').select('id, hours')
      : Promise.resolve({ data: [] }),
    getDetectedElentraExams(7),
  ]);

  // 1. Academics
  const taskRows = (tasksRes?.data || []) as Array<{ is_completed?: boolean }>;
  const tasksTotal = taskRows.length;
  const tasksCompleted = taskRows.filter((t) => t.is_completed).length;
  const completionRate = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

  const startMs = new Date(`${weekStart}T00:00:00Z`).getTime();
  const modulesCompleted = ((schoolRes?.data || []) as Array<{ updated_at?: string }>).filter(
    (m) => m.updated_at && new Date(m.updated_at).getTime() >= startMs
  ).length;

  // 2. Anki
  const ankiRows = (ankiRes?.data || []) as Array<{
    reviews_today?: number;
    retention_pct?: number;
    avg_secs_per_card?: number;
    streak_days?: number;
    total_due_remaining?: number;
    leech_cards?: number;
  }>;
  const totalReviews = ankiRows.reduce((s, r) => s + (Number(r.reviews_today) || 0), 0);
  const activeAnkiDays = ankiRows.filter((r) => (Number(r.reviews_today) || 0) > 0).length;
  const retRows = ankiRows.filter((r) => (Number(r.retention_pct) || 0) > 0);
  const avgRetentionPct =
    retRows.length > 0
      ? Math.round((retRows.reduce((s, r) => s + Number(r.retention_pct || 0), 0) / retRows.length) * 10) / 10
      : 0;
  const speedRows = ankiRows.filter((r) => (Number(r.avg_secs_per_card) || 0) > 0);
  const avgSecsPerCard =
    speedRows.length > 0
      ? Math.round(
          (speedRows.reduce((s, r) => s + Number(r.avg_secs_per_card || 8.5), 0) / speedRows.length) * 10
        ) / 10
      : 8.5;
  const latestAnki = ankiRows[ankiRows.length - 1];

  // 3. Health & Readiness
  const allBioNewestFirst = (bioRes?.data || []) as Array<{
    date: string;
    sleep_hours?: number | null;
    hrv?: number | null;
    rhr?: number | null;
    steps?: number | null;
    bodyweight?: number | null;
    workout_duration?: number | null;
    workout_calories?: number | null;
  }>;
  const weekBio = allBioNewestFirst.filter((b) => b.date >= weekStart && b.date <= weekEnd);
  const avgNum = (vals: number[]) =>
    vals.length > 0 ? Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 10) / 10 : 0;

  const avgSleepHours = avgNum(weekBio.map((b) => Number(b.sleep_hours || 0)).filter((v) => v > 0));
  const avgHrv = Math.round(avgNum(weekBio.map((b) => Number(b.hrv || 0)).filter((v) => v > 0)));
  const avgRhr = Math.round(avgNum(weekBio.map((b) => Number(b.rhr || 0)).filter((v) => v > 0)));
  const avgSteps = Math.round(avgNum(weekBio.map((b) => Number(b.steps || 0)).filter((v) => v > 0)));

  const weights = weekBio
    .map((b) => Number(b.bodyweight || 0))
    .filter((v) => v > 50 && v < 400);
  const latestWeightLbs = weights.length > 0 ? Math.round(weights[0] * 10) / 10 : null;
  const weightDeltaLbs =
    weights.length >= 2
      ? Math.round((weights[0] - weights[weights.length - 1]) * 10) / 10
      : null;

  const readinessScores = weekBio.map((_, idx) =>
    computeDailyReadiness(allBioNewestFirst.slice(idx)).score
  );
  const avgReadiness = Math.round(avgNum(readinessScores.filter((s) => s > 0)));

  // 4. Workouts
  const wRows = (workoutRes?.data || []) as Array<{
    date: string;
    exercise: string;
    weight_lbs?: number;
    reps?: number;
  }>;
  const sessionDates = new Set(wRows.map((w) => w.date));
  let totalVolumeLbs = 0;
  const bestByEx = new Map<string, { exercise: string; bestWeightLbs: number; bestReps: number }>();
  for (const w of wRows) {
    const wt = Number(w.weight_lbs || 0);
    const reps = Number(w.reps || 0);
    totalVolumeLbs += Math.round(wt * reps);
    const prev = bestByEx.get(w.exercise);
    if (!prev || wt > prev.bestWeightLbs || (wt === prev.bestWeightLbs && reps > prev.bestReps)) {
      bestByEx.set(w.exercise, { exercise: w.exercise, bestWeightLbs: wt, bestReps: reps });
    }
  }
  const topExercises = Array.from(bestByEx.values())
    .filter((e) => e.bestWeightLbs > 0)
    .sort((a, b) => b.bestWeightLbs - a.bestWeightLbs)
    .slice(0, 5);

  // 5. Habits
  const hRows = (habitsRes?.data || []) as Array<{
    wake_up_on_time?: boolean;
    gym_workout?: boolean;
    journaling?: boolean;
    anki?: boolean;
  }>;
  const denom = 7;
  const habitMetrics = [
    {
      name: 'Wake Up On Time',
      daysDone: hRows.filter((h) => h.wake_up_on_time).length,
      totalDays: denom,
    },
    {
      name: 'Gym Workout',
      daysDone: hRows.filter((h) => h.gym_workout).length,
      totalDays: denom,
    },
    {
      name: 'Journaling',
      daysDone: hRows.filter((h) => h.journaling).length,
      totalDays: denom,
    },
    {
      name: 'Anki',
      daysDone: hRows.filter((h) => h.anki).length,
      totalDays: denom,
    },
  ].map((hm) => ({
    ...hm,
    pct: Math.round((hm.daysDone / hm.totalDays) * 100),
  }));
  const overallHabitPct = Math.round(
    (habitMetrics.reduce((s, h) => s + h.daysDone, 0) / (denom * 4)) * 100
  );

  // 6. Portfolio & Journal
  const portRows = (portfolioRes?.data || []) as Array<{ hours?: number }>;
  const totalPortfolioHours = Math.round(
    portRows.reduce((s, p) => s + (Number(p.hours) || 0), 0) * 10
  ) / 10;

  // Composite score for weekly grade
  const compositeScore = Math.round(
    (completionRate || 70) * 0.25 +
      overallHabitPct * 0.35 +
      (avgReadiness || 75) * 0.25 +
      Math.min(100, (activeAnkiDays / 7) * 100) * 0.15
  );

  const baseReview = {
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString(),
    overallGrade: computeGrade(compositeScore),
    pillars: {
      academics: {
        tasksCompleted,
        tasksTotal,
        completionRate,
        modulesCompleted,
        nextMajorExam: taperStatus.nextMajorExam?.name || null,
        daysUntilExam: taperStatus.daysUntilNextMajorExam,
        inTaperMode: taperStatus.inTaperMode,
      },
      anki: {
        totalReviews,
        activeDays: activeAnkiDays,
        avgRetentionPct,
        avgSecsPerCard,
        currentStreak: Number(latestAnki?.streak_days || 0),
        dueRemainingNow: Number(latestAnki?.total_due_remaining || 0),
        leechCount: Number(latestAnki?.leech_cards || 0),
      },
      health: {
        avgSleepHours,
        avgHrv,
        avgRhr,
        avgSteps,
        avgReadiness,
        weightDeltaLbs,
        latestWeightLbs,
      },
      workouts: {
        sessionsCount: sessionDates.size,
        totalSets: wRows.length,
        totalVolumeLbs,
        topExercises,
      },
      habits: {
        overallPct: overallHabitPct,
        perHabit: habitMetrics,
      },
      portfolioAndJournal: {
        journalEntriesCount: (journalRes?.data || []).length,
        portfolioEntriesCount: portRows.length,
        totalPortfolioHours,
      },
    },
  };

  const aiText = await synthesizeWeeklyWithAI(baseReview);
  return { ...baseReview, ...aiText };
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    const weekEnd = req.nextUrl.searchParams.get('weekEnd') || getTodayDateStr();
    const refresh = req.nextUrl.searchParams.get('refresh') === 'true';
    const digestId = `weekly:${weekEnd}`;

    let archive: Array<{ id: string; date: string; headline: string }> = [];
    if (sb) {
      const { data: archRows, error: archErr } = await sb
        .from('os_digests')
        .select('id, date, headline')
        .eq('digest_type', 'weekly')
        .order('date', { ascending: false })
        .limit(12);
      if (!archErr && archRows) {
        archive = archRows as Array<{ id: string; date: string; headline: string }>;
      }

      if (!refresh) {
        const { data: cached, error } = await sb
          .from('os_digests')
          .select('*')
          .eq('id', digestId)
          .maybeSingle();
        if (!error && cached?.payload_json) {
          return NextResponse.json({
            success: true,
            cached: true,
            review: cached.payload_json as WeeklyExecutiveReview,
            archive,
          });
        }
      }
    }

    const review = await generateWeeklyReview(weekEnd);

    if (sb) {
      const { error: uErr } = await sb.from('os_digests').upsert(
        {
          id: digestId,
          digest_type: 'weekly',
          date: weekEnd,
          headline: review.headline,
          summary_text: review.executiveSummary,
          payload_json: review,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (!uErr && !archive.some((a) => a.id === digestId)) {
        archive = [{ id: digestId, date: weekEnd, headline: review.headline }, ...archive];
      } else if (uErr && !isMissingAnkiTableError(uErr)) {
        console.warn('Weekly review cache warning:', uErr.message);
      }
    }

    return NextResponse.json({ success: true, cached: false, review, archive });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Weekly review error' },
      { status: 500 }
    );
  }
}
