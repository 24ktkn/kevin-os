'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Brain,
  CheckCircle2,
  Compass,
  Dumbbell,
  Flame,
  GraduationCap,
  HeartPulse,
  RefreshCw,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { WeeklyExecutiveReview } from '@/types/digests';

interface ArchiveRow {
  id: string;
  date: string;
  headline: string;
}

export default function WeeklyReviewPage() {
  const [review, setReview] = useState<WeeklyExecutiveReview | null>(null);
  const [archive, setArchive] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReview = useCallback(async (opts?: { weekEnd?: string; refresh?: boolean }) => {
    if (opts?.refresh) setRegenerating(true);
    else setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (opts?.weekEnd) sp.set('weekEnd', opts.weekEnd);
      if (opts?.refresh) sp.set('refresh', 'true');
      const qs = sp.toString() ? `?${sp.toString()}` : '';
      const res = await fetch(`/api/review/weekly${qs}`);
      const data = await res.json();
      if (data.success && data.review) {
        setReview(data.review);
        setArchive(data.archive || []);
      } else {
        setError(data.error || 'Could not generate weekly review.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error loading review.');
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadReview();
    }, 0);
    return () => clearTimeout(t);
  }, [loadReview]);

  const gradeColor =
    review?.overallGrade.startsWith('A')
      ? 'from-emerald-400 to-cyan-400 text-emerald-950'
      : review?.overallGrade.startsWith('B')
      ? 'from-cyan-400 to-indigo-400 text-slate-950'
      : 'from-amber-400 to-rose-400 text-slate-950';

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0F0F14]/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">
              Sunday Weekly Executive Review
            </h1>
            <p className="text-xs text-zinc-400">
              Cross-Pillar 7-Day Synthesis · Academics · Anki · Readiness · Workouts · Habits
            </p>
          </div>
        </div>

        <button
          onClick={() => loadReview({ weekEnd: review?.weekEnd, refresh: true })}
          disabled={regenerating || loading}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 disabled:opacity-60 text-white text-xs font-semibold shadow-sm transition cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          <span>{regenerating ? 'Synthesizing...' : 'Regenerate Review'}</span>
        </button>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
            {error}
          </div>
        )}

        {loading || !review ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="h-8 w-8 text-cyan-400 animate-spin" />
            <p className="text-xs text-zinc-400">
              Synthesizing your 7-day performance across all Kevin-OS systems...
            </p>
          </div>
        ) : (
          <>
            {/* Executive Hero Card */}
            <section className="rounded-2xl border border-indigo-500/35 bg-gradient-to-br from-[#141528] via-[#121218] to-[#0E1620] p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/35">
                      {review.weekStart} → {review.weekEnd}
                    </span>
                    {review.pillars.academics.inTaperMode && (
                      <span className="font-semibold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/35">
                        🔥 Exam Taper Mode ({review.pillars.academics.daysUntilExam}d)
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    {review.headline}
                  </h2>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div
                    className={`h-16 w-16 rounded-2xl bg-gradient-to-tr ${gradeColor} flex flex-col items-center justify-center shadow-lg`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                      Grade
                    </span>
                    <span className="text-2xl font-black leading-none">{review.overallGrade}</span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-zinc-200 leading-relaxed">{review.executiveSummary}</p>

              {/* Wins / Watchouts / Next-Week Adjustments */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2">
                <div className="p-4 rounded-xl bg-emerald-950/25 border border-emerald-500/25 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                    <Trophy className="h-3.5 w-3.5" /> Biggest Wins
                  </div>
                  <ul className="space-y-1.5 text-xs text-zinc-200">
                    {review.wins.map((w, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/25 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> Bottlenecks
                  </div>
                  <ul className="space-y-1.5 text-xs text-zinc-200">
                    {review.watchouts.map((w, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-400 font-bold">•</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-cyan-950/25 border border-cyan-500/25 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                    <Compass className="h-3.5 w-3.5" /> Next Week Moves
                  </div>
                  <ul className="space-y-1.5 text-xs text-zinc-200">
                    {review.nextWeekAdjustments.map((a, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {/* 6-Pillar Scorecard Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Academics */}
              <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4" /> Academics &amp; Tasks
                  </span>
                  <Link href="/school" className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    School <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Task Completion</div>
                    <div className="text-lg font-bold text-white font-mono">
                      {review.pillars.academics.completionRate}%
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {review.pillars.academics.tasksCompleted}/{review.pillars.academics.tasksTotal} done
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Modules Done</div>
                    <div className="text-lg font-bold text-cyan-300 font-mono">
                      {review.pillars.academics.modulesCompleted}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">
                      {review.pillars.academics.nextMajorExam
                        ? `Exam in ${review.pillars.academics.daysUntilExam}d`
                        : 'No major exam soon'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Anki */}
              <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Brain className="h-4 w-4" /> Anki Spaced Repetition
                  </span>
                  <Link href="/anki" className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    Anki <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Weekly Reviews</div>
                    <div className="text-lg font-bold text-white font-mono">
                      {review.pillars.anki.totalReviews}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {review.pillars.anki.activeDays}/7 active days
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Avg Retention</div>
                    <div className="text-lg font-bold text-emerald-400 font-mono">
                      {review.pillars.anki.avgRetentionPct ? `${review.pillars.anki.avgRetentionPct}%` : '—'}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {review.pillars.anki.avgSecsPerCard}s/card · {review.pillars.anki.dueRemainingNow} due
                    </div>
                  </div>
                </div>
              </div>

              {/* Health & Readiness */}
              <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                    <HeartPulse className="h-4 w-4" /> Health &amp; Readiness
                  </span>
                  <Link href="/health" className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    Health <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Avg Readiness</div>
                    <div className="text-lg font-bold text-emerald-400 font-mono">
                      {review.pillars.health.avgReadiness || '—'}/100
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Sleep {review.pillars.health.avgSleepHours}h · HRV {review.pillars.health.avgHrv}ms
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Steps &amp; Weight</div>
                    <div className="text-lg font-bold text-white font-mono">
                      {review.pillars.health.avgSteps.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {review.pillars.health.latestWeightLbs
                        ? `${review.pillars.health.latestWeightLbs} lbs${
                            review.pillars.health.weightDeltaLbs !== null
                              ? ` (${review.pillars.health.weightDeltaLbs >= 0 ? '+' : ''}${review.pillars.health.weightDeltaLbs})`
                              : ''
                          }`
                        : 'Weight N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Workouts */}
              <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <Dumbbell className="h-4 w-4" /> Training (Hevy)
                  </span>
                  <Link href="/workouts" className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    Workouts <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="flex items-baseline gap-3">
                  <div className="text-2xl font-bold text-white font-mono">
                    {review.pillars.workouts.sessionsCount} sessions
                  </div>
                  <div className="text-xs text-zinc-400">
                    {review.pillars.workouts.totalSets} sets ·{' '}
                    {review.pillars.workouts.totalVolumeLbs.toLocaleString()} lbs vol
                  </div>
                </div>
                {review.pillars.workouts.topExercises.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {review.pillars.workouts.topExercises.slice(0, 3).map((ex) => (
                      <div key={ex.exercise} className="text-[11px] text-zinc-300 flex justify-between">
                        <span className="truncate">{ex.exercise}</span>
                        <span className="font-mono text-cyan-300 shrink-0">
                          {ex.bestWeightLbs}×{ex.bestReps}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Habits */}
              <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Flame className="h-4 w-4" /> Habits ({review.pillars.habits.overallPct}%)
                  </span>
                  <Link href="/habits" className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    Habits <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="space-y-2">
                  {review.pillars.habits.perHabit.map((h) => (
                    <div key={h.name} className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-zinc-300">{h.name}</span>
                        <span className="font-mono text-zinc-400">
                          {h.daysDone}/7 ({h.pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                          style={{ width: `${h.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Portfolio & Journal */}
              <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                    <Award className="h-4 w-4" /> CaRMS Portfolio &amp; Journal
                  </span>
                  <Link href="/portfolio" className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    CaRMS <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Portfolio Log</div>
                    <div className="text-lg font-bold text-white font-mono">
                      {review.pillars.portfolioAndJournal.portfolioEntriesCount} items
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {review.pillars.portfolioAndJournal.totalPortfolioHours} total hrs
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#0D0E14] border border-zinc-800">
                    <div className="text-zinc-500 text-[10px]">Journal Reflections</div>
                    <div className="text-lg font-bold text-indigo-300 font-mono">
                      {review.pillars.portfolioAndJournal.journalEntriesCount}/7
                    </div>
                    <div className="text-[10px] text-zinc-500">days logged</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Historical Weekly Archive */}
            {archive.length > 1 && (
              <section className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-4 space-y-2.5">
                <div className="text-xs font-semibold text-zinc-300">Past Weekly Reviews</div>
                <div className="flex flex-wrap gap-2">
                  {archive.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => loadReview({ weekEnd: a.date })}
                      className={`px-3 py-1.5 rounded-xl text-xs border transition cursor-pointer ${
                        a.date === review.weekEnd
                          ? 'bg-indigo-500/20 border-indigo-400/50 text-white font-semibold'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {a.date}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
