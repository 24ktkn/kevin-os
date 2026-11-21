'use client';

import React, { useState } from 'react';
import {
  Activity,
  Brain,
  CalendarClock,
  Flame,
  Heart,
  Moon,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  AnkiDailyStats,
  AnkiDeckBreakdown,
  BiometricsRetentionInsights,
  ExamPacingProjection,
  ExamTarget,
} from '@/types/anki';
import { addDaysToDateStr, getTodayDateStr } from '@/lib/date-utils';

interface AnkiChartsProps {
  today: AnkiDailyStats | null;
  history: AnkiDailyStats[];
  biometricsInsights: BiometricsRetentionInsights;
  examProjections: ExamPacingProjection[];
  examTargets: ExamTarget[];
  availableDecks: string[];
  onSaveExamTargets: (targets: ExamTarget[]) => Promise<void>;
  onSelectDeckToStudy: (deckName: string) => void;
}

export default function AnkiCharts({
  today,
  history,
  biometricsInsights,
  examProjections,
  examTargets,
  availableDecks,
  onSaveExamTargets,
  onSelectDeckToStudy,
}: AnkiChartsProps) {
  const [showAddExam, setShowAddExam] = useState(false);
  const [examName, setExamName] = useState('');
  const [examDate, setExamDate] = useState(() => addDaysToDateStr(getTodayDateStr(), 14));
  const [examDeckFilter, setExamDeckFilter] = useState('');
  const [examTagFilter, setExamTagFilter] = useState('');
  const [examBufferDays, setExamBufferDays] = useState(3);
  const [savingExam, setSavingExam] = useState(false);
  const [selectedExamIdx, setSelectedExamIdx] = useState(0);

  // Build 84-day (12 weeks) review heatmap
  const todayStr = getTodayDateStr();
  const historyMap = new Map(history.map((h) => [h.date, h]));
  const heatmapDays: Array<{ date: string; count: number; retention: number }> = [];
  for (let i = 83; i >= 0; i -= 1) {
    const d = addDaysToDateStr(todayStr, -i);
    const row = historyMap.get(d);
    heatmapDays.push({
      date: d,
      count: row?.reviews_today || 0,
      retention: row?.retention_pct || 0,
    });
  }

  const maxHeatmapCount = Math.max(50, ...heatmapDays.map((d) => d.count));
  const getHeatColor = (count: number) => {
    if (count === 0) return 'bg-zinc-900 border-zinc-800/80';
    const ratio = count / maxHeatmapCount;
    if (ratio < 0.25) return 'bg-cyan-950 border-cyan-800/50';
    if (ratio < 0.5) return 'bg-cyan-800/70 border-cyan-600/50';
    if (ratio < 0.75) return 'bg-cyan-500/80 border-cyan-400/60';
    return 'bg-emerald-400 border-emerald-300';
  };

  const handleAddExamTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examName.trim() || !examDate) return;
    setSavingExam(true);
    try {
      const next: ExamTarget[] = [
        ...examTargets,
        {
          id: `exam-${Date.now()}`,
          name: examName.trim(),
          examDate,
          deckFilter: examDeckFilter.trim() || undefined,
          tagFilter: examTagFilter.trim() || undefined,
          bufferDays: examBufferDays,
        },
      ];
      await onSaveExamTargets(next);
      setExamName('');
      setExamDeckFilter('');
      setExamTagFilter('');
      setShowAddExam(false);
    } finally {
      setSavingExam(false);
    }
  };

  const handleRemoveExam = async (id: string) => {
    const next = examTargets.filter((t) => t.id !== id);
    await onSaveExamTargets(next);
    setSelectedExamIdx(0);
  };

  const activeProjection = examProjections[selectedExamIdx] || examProjections[0] || null;
  const fallbackForecast = (today?.forecast_30d || []).slice(0, 30);

  const curvePoints = activeProjection
    ? activeProjection.burdenCurve
    : fallbackForecast.map((f) => ({
        dayOffset: f.dayOffset,
        date: f.date,
        baselineDue: f.dueCount,
        projectedNewReviews: 0,
        newIntroduced: 0,
        totalProjected: f.dueCount,
      }));

  const maxCurve = Math.max(20, ...curvePoints.map((p) => p.totalProjected));
  const decks: AnkiDeckBreakdown[] = today?.deck_breakdown || [];

  return (
    <div className="space-y-6">
      {/* Top Row: Deck Breakdown + 12-Week Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Deck Breakdown */}
        <div className="lg:col-span-7 rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-white">Deck Queue Breakdown</h3>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">
              {decks.length} deck{decks.length === 1 ? '' : 's'}
            </span>
          </div>

          {decks.length === 0 ? (
            <div className="py-10 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
              No deck breakdown synced yet. Start the Windows Anki Bridge while Anki Desktop is open.
            </div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {decks.map((d) => {
                const dueTotal = d.reviewRemaining + d.learningRemaining;
                return (
                  <div
                    key={d.deck}
                    className="p-3 rounded-xl bg-[#0F0F15] border border-zinc-800/80 hover:border-cyan-500/35 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{d.deck}</div>
                      <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5 flex-wrap">
                        <span>{d.totalCards} total</span>
                        <span>•</span>
                        <span>{d.suspendedCards} suspended</span>
                        {d.leechCards > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-rose-400">{d.leechCards} leeches</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/25 text-[11px] font-mono">
                        {d.newRemaining} new
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25 text-[11px] font-mono">
                        {d.learningRemaining} lrn
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 text-[11px] font-mono font-semibold">
                        {d.reviewRemaining} rev
                      </span>
                      {dueTotal > 0 && (
                        <button
                          onClick={() => onSelectDeckToStudy(d.deck)}
                          className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/35 text-[11px] font-semibold transition cursor-pointer"
                        >
                          Study
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 12-Week Review Consistency Heatmap */}
        <div className="lg:col-span-5 rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">84-Day Review Heatmap</h3>
            </div>
            <span className="text-xs font-mono text-amber-300">
              🔥 {today?.streak_days || 0}d streak
            </span>
          </div>

          <div className="grid grid-cols-12 gap-1.5">
            {heatmapDays.map((cell) => (
              <div
                key={cell.date}
                title={`${cell.date}: ${cell.count} reviews${cell.retention ? ` (${cell.retention}% ret.)` : ''}`}
                className={`aspect-square rounded-[4px] border transition-transform hover:scale-110 ${getHeatColor(cell.count)}`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
            <span>12 weeks ago</span>
            <div className="flex items-center gap-1">
              <span>Less</span>
              <span className="h-2.5 w-2.5 rounded-[2px] bg-zinc-900 border border-zinc-800" />
              <span className="h-2.5 w-2.5 rounded-[2px] bg-cyan-950 border border-cyan-800/50" />
              <span className="h-2.5 w-2.5 rounded-[2px] bg-cyan-800/70" />
              <span className="h-2.5 w-2.5 rounded-[2px] bg-cyan-500/80" />
              <span className="h-2.5 w-2.5 rounded-[2px] bg-emerald-400" />
              <span>More</span>
            </div>
            <span>Today</span>
          </div>
        </div>
      </div>

      {/* Exam Countdown, Daily New-Card Pacing & 30-Day Projected Burden Curve */}
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-[#141422] via-[#121218] to-[#0E141D] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">
                Exam Countdown, Card Pacing &amp; 30-Day Projected Burden Curve
              </h3>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Computes daily New Cards needed to finish unsuspending before your exam buffer and simulates your future review workload.
            </p>
          </div>

          <button
            onClick={() => setShowAddExam((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-200 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/35 transition self-start cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Exam Target</span>
          </button>
        </div>

        {showAddExam && (
          <form
            onSubmit={handleAddExamTarget}
            className="p-4 rounded-xl bg-[#0D0E16] border border-indigo-500/25 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs"
          >
            <div>
              <label className="text-zinc-400 block mb-1">Exam Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Infection & Immunity Exam"
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-400"
              />
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">Exam Date</label>
              <input
                type="date"
                required
                value={examDate}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                onChange={(e) => setExamDate(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white [color-scheme:dark] cursor-pointer"
              />
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">Deck Filter (Optional)</label>
              <input
                list="anki-decks-datalist"
                placeholder="All decks or Schulich::..."
                value={examDeckFilter}
                onChange={(e) => setExamDeckFilter(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
              />
              <datalist id="anki-decks-datalist">
                {availableDecks.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">Tag Filter / Buffer Days</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="tag (opt.)"
                  value={examTagFilter}
                  onChange={(e) => setExamTagFilter(e.target.value)}
                  className="w-2/3 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-white"
                />
                <input
                  type="number"
                  min={0}
                  max={14}
                  title="Review-only buffer days before exam"
                  value={examBufferDays}
                  onChange={(e) => setExamBufferDays(parseInt(e.target.value, 10) || 3)}
                  className="w-1/3 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-white font-mono"
                />
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={savingExam}
                className="w-full py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold transition cursor-pointer"
              >
                {savingExam ? 'Saving...' : 'Save Exam'}
              </button>
            </div>
          </form>
        )}

        {/* Saved Exam Selector Pills */}
        {examProjections.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {examProjections.map((proj, idx) => (
              <div
                key={proj.target.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition ${
                  idx === selectedExamIdx
                    ? 'bg-indigo-500/20 border-indigo-400/60 text-white'
                    : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <button
                  onClick={() => setSelectedExamIdx(idx)}
                  className="font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{proj.target.name}</span>
                  <span className="font-mono text-[11px] text-cyan-300">
                    {proj.daysUntilExam}d left
                  </span>
                </button>
                <button
                  onClick={() => handleRemoveExam(proj.target.id)}
                  className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                  title="Delete exam target"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Active Exam Pacing KPI Strip */}
        {activeProjection && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-[#0D0F18] border border-zinc-800/80">
              <div className="text-[11px] text-zinc-400">Countdown</div>
              <div className="text-xl font-bold text-white mt-0.5">
                {activeProjection.daysUntilExam} days
              </div>
              <div className="text-[10px] text-zinc-500">
                {activeProjection.studyDaysLeft} unlock days ({activeProjection.target.bufferDays ?? 3}d buffer)
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#0D0F18] border border-zinc-800/80">
              <div className="text-[11px] text-zinc-400">Cards Left to Unlock</div>
              <div className="text-xl font-bold text-cyan-300 mt-0.5">
                {activeProjection.cardsToUnlock}
              </div>
              <div className="text-[10px] text-zinc-500">
                {activeProjection.suspendedCards} susp. + {activeProjection.newCards} new
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#0D0F18] border border-indigo-500/35">
              <div className="text-[11px] text-indigo-300">Required Pace</div>
              <div className="text-xl font-bold text-white mt-0.5">
                {activeProjection.recommendedNewPerDay} new/day
              </div>
              <div className="text-[10px] text-zinc-400">
                to finish before buffer
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[#0D0F18] border border-zinc-800/80">
              <div className="text-[11px] text-zinc-400">Projected Peak Burden</div>
              <div className="text-xl font-bold text-amber-300 mt-0.5">
                {activeProjection.peakDailyReviews} cards
              </div>
              <div className="text-[10px] text-zinc-500">
                max daily reviews in next 30d
              </div>
            </div>
          </div>
        )}

        {/* 30-Day Stacked Burden Curve SVG Chart */}
        <div className="p-4 rounded-xl bg-[#0B0C12] border border-zinc-800/80 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-zinc-300 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />
              30-Day Projected Daily Review Workload
            </span>
            <div className="flex items-center gap-3 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-cyan-500" /> Baseline Due
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-indigo-400" /> Paced Follow-ups
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Daily New
              </span>
            </div>
          </div>

          {curvePoints.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-zinc-500">
              Sync your Anki collection or add an Exam Target above to view your 30-day projected review curve.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg viewBox="0 0 660 175" className="w-full min-w-[520px] h-44">
                {[0.25, 0.5, 0.75, 1].map((frac) => {
                  const y = 145 - frac * 125;
                  return (
                    <g key={frac}>
                      <line
                        x1="34"
                        y1={y}
                        x2="652"
                        y2={y}
                        stroke="#27272a"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text x="28" y={y + 3} textAnchor="end" fill="#71717a" fontSize="9">
                        {Math.round(maxCurve * frac)}
                      </text>
                    </g>
                  );
                })}
                {curvePoints.map((pt, idx) => {
                  const barW = 14;
                  const gap = 6.5;
                  const x = 40 + idx * (barW + gap);
                  const baseH = (pt.baselineDue / maxCurve) * 125;
                  const followH = (pt.projectedNewReviews / maxCurve) * 125;
                  const newH = (pt.newIntroduced / maxCurve) * 125;
                  const yBase = 145 - baseH;
                  const yFollow = yBase - followH;
                  const yNew = yFollow - newH;

                  return (
                    <g key={pt.date}>
                      <title>{`${pt.date}: ${pt.totalProjected} total (${pt.baselineDue} baseline + ${pt.projectedNewReviews} follow-up + ${pt.newIntroduced} new)`}</title>
                      {baseH > 0 && (
                        <rect x={x} y={yBase} width={barW} height={baseH} rx="2" fill="#06b6d4" />
                      )}
                      {followH > 0 && (
                        <rect x={x} y={yFollow} width={barW} height={followH} rx="2" fill="#818cf8" />
                      )}
                      {newH > 0 && (
                        <rect x={x} y={yNew} width={barW} height={newH} rx="2" fill="#34d399" />
                      )}
                      {idx % 5 === 0 && (
                        <text x={x + barW / 2} y="164" textAnchor="middle" fill="#a1a1aa" fontSize="9">
                          {pt.date.slice(5)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Biometrics × Anki Retention Insights */}
      <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              Biometrics × Anki Retention Insights
            </h3>
          </div>
          <span className="text-[11px] font-mono text-zinc-500">
            {biometricsInsights.pairedDays} paired days (Health Tracker × Anki)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-[#0F0F15] border border-zinc-800/80 space-y-1">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Moon className="h-3.5 w-3.5 text-indigo-400" /> Sleep ≥ 7h vs &lt; 7h
            </div>
            <div className="text-lg font-bold text-white flex items-baseline gap-2">
              <span className="text-emerald-400">
                {biometricsInsights.avgRetentionGoodSleep !== null
                  ? `${biometricsInsights.avgRetentionGoodSleep}%`
                  : '—'}
              </span>
              <span className="text-xs text-zinc-500">vs</span>
              <span className="text-amber-400">
                {biometricsInsights.avgRetentionLowSleep !== null
                  ? `${biometricsInsights.avgRetentionLowSleep}%`
                  : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500">Average daily retention</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0F0F15] border border-zinc-800/80 space-y-1">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 text-rose-400" /> High HRV vs Low HRV
            </div>
            <div className="text-lg font-bold text-white flex items-baseline gap-2">
              <span className="text-cyan-400">
                {biometricsInsights.avgRetentionHighHrv !== null
                  ? `${biometricsInsights.avgRetentionHighHrv}%`
                  : '—'}
              </span>
              <span className="text-xs text-zinc-500">vs</span>
              <span className="text-zinc-400">
                {biometricsInsights.avgRetentionLowHrv !== null
                  ? `${biometricsInsights.avgRetentionLowHrv}%`
                  : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500">
              {biometricsInsights.medianHrv
                ? `Split at median ${biometricsInsights.medianHrv} ms HRV`
                : 'Awaiting paired HRV data'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0F0F15] border border-zinc-800/80 space-y-1">
            <div className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" /> Speed on ≥ 7h vs &lt; 7h
            </div>
            <div className="text-lg font-bold text-white flex items-baseline gap-2">
              <span className="text-emerald-300">
                {biometricsInsights.avgSpeedGoodSleep !== null
                  ? `${biometricsInsights.avgSpeedGoodSleep}s`
                  : '—'}
              </span>
              <span className="text-xs text-zinc-500">vs</span>
              <span className="text-amber-300">
                {biometricsInsights.avgSpeedLowSleep !== null
                  ? `${biometricsInsights.avgSpeedLowSleep}s`
                  : '—'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500">Seconds per card reviewed</div>
          </div>
        </div>

        <div className="space-y-1.5">
          {biometricsInsights.takeaways.map((t, i) => (
            <div
              key={i}
              className="text-xs text-zinc-300 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20"
            >
              ✨ {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
