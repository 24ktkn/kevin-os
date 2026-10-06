'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  HeartPulse,
  Moon,
  Heart,
  Activity,
  Flame,
  TrendingUp,
  RefreshCw,
  Clock,
  ArrowRight,
  Sparkles,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Scale,
  Zap,
  BarChart3,
  ListFilter,
  ChevronDown,
  Sliders,
  X,
  Save,
} from 'lucide-react';
import { AnalyticsSummary, DayMetricPoint, MonthRollup } from '../api/health/analytics/route';

type Timeframe = 'week' | 'month' | 'year';

export default function HealthTrackerPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>('month');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [days, setDays] = useState<DayMetricPoint[]>([]);
  const [months, setMonths] = useState<MonthRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeMetricTab, setActiveMetricTab] = useState<'sleep' | 'cardio' | 'steps' | 'workout' | 'weight'>('sleep');
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [editFormData, setEditFormData] = useState({
    date: '',
    sleep: '',
    sleepTime: '',
    wakeTime: '',
    steps: '',
    rhr: '',
    hrv: '',
    weight: '',
    workoutCalories: '',
    workoutDuration: '',
  });

  const openEditModal = () => {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const targetPoint = days.find((d) => d.date === todayStr) || days[days.length - 1];

    setEditFormData({
      date: targetPoint?.date || todayStr,
      sleep: targetPoint?.sleepHours ? `${targetPoint.sleepHours}` : '',
      sleepTime: targetPoint?.sleepTime || '',
      wakeTime: targetPoint?.wakeTime || '',
      steps: targetPoint?.steps ? `${targetPoint.steps}` : '',
      rhr: targetPoint?.rhr ? `${targetPoint.rhr}` : '',
      hrv: targetPoint?.hrv ? `${targetPoint.hrv}` : '',
      weight: targetPoint?.bodyweight ? `${targetPoint.bodyweight}` : '',
      workoutCalories: targetPoint?.workoutCalories ? `${targetPoint.workoutCalories}` : '',
      workoutDuration: targetPoint?.workoutDuration ? `${targetPoint.workoutDuration}` : '',
    });
    setShowEditModal(true);
  };

  const handleSaveMetrics = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMetrics(true);
    try {
      const payload: Record<string, any> = {
        date: editFormData.date,
        timezone: 'America/New_York',
      };
      if (editFormData.sleep) payload.sleep = editFormData.sleep;
      if (editFormData.sleepTime) payload.sleepTime = editFormData.sleepTime;
      if (editFormData.wakeTime) payload.wakeTime = editFormData.wakeTime;
      if (editFormData.steps) payload.steps = parseInt(editFormData.steps, 10);
      if (editFormData.rhr) payload.rhr = parseFloat(editFormData.rhr);
      if (editFormData.hrv) payload.hrv = parseFloat(editFormData.hrv);
      if (editFormData.weight) payload.weight = parseFloat(editFormData.weight);
      if (editFormData.workoutCalories) payload.workoutCalories = parseFloat(editFormData.workoutCalories);
      if (editFormData.workoutDuration) payload.workoutDuration = parseFloat(editFormData.workoutDuration);

      const res = await fetch('/api/health/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowEditModal(false);
        fetchAnalytics(timeframe);
      }
    } catch (err) {
      console.error('Failed to save metrics:', err);
    } finally {
      setSavingMetrics(false);
    }
  };

  const fetchAnalytics = useCallback(async (tf: Timeframe) => {
    try {
      const res = await fetch(`/api/health/analytics?timeframe=${tf}`);
      const json = await res.json();
      if (json.success) {
        setSummary(json.summary);
        setDays(json.days || []);
        setMonths(json.months || []);
      }
    } catch (err) {
      console.error('Failed to load health analytics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAnalytics(timeframe);
  }, [timeframe, fetchAnalytics]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAnalytics(timeframe);
  };

  // Max values for chart scaling
  const maxSleepVal = useMemo(() => {
    const maxVal = Math.max(...days.map((d) => d.sleepHours), 10);
    return Math.ceil(maxVal);
  }, [days]);

  const maxStepsVal = useMemo(() => {
    const maxVal = Math.max(...days.map((d) => d.steps), 12000);
    return Math.ceil(maxVal / 2000) * 2000;
  }, [days]);

  const maxWorkoutCalVal = useMemo(() => {
    const maxVal = Math.max(...days.map((d) => d.workoutCalories), 600);
    return Math.ceil(maxVal / 100) * 100;
  }, [days]);

  const maxCardioVal = useMemo(() => {
    const maxVal = Math.max(...days.map((d) => Math.max(d.hrv, d.rhr)), 100);
    return Math.ceil(maxVal / 20) * 20;
  }, [days]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0D] text-white p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <HeartPulse className="h-5 w-5 text-rose-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              Biometrics Analytics & Longitudinal Intelligence
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
            Health Tracker
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Tracking your sleep architecture, cardiovascular recovery, daily steps, and workout outputs.
          </p>
        </div>

        {/* Timeframe Controls & Refresh */}
        <div className="flex items-center gap-3">
          {/* Segmented Timeframe Switcher */}
          <div className="flex items-center bg-[#14141B] p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setTimeframe('week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                timeframe === 'week'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Weekly (7D)
            </button>
            <button
              onClick={() => setTimeframe('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                timeframe === 'month'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Monthly (30D)
            </button>
            <button
              onClick={() => setTimeframe('year')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                timeframe === 'year'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Yearly (12M)
            </button>
          </div>

          <button
            onClick={openEditModal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-950/40 border border-cyan-500/30 hover:border-cyan-400 text-xs font-medium text-cyan-300 hover:text-white transition shadow-sm"
          >
            <Sliders className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Edit Metrics</span>
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 hover:text-white transition shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-32 rounded-2xl bg-zinc-900/50 border border-zinc-800 animate-pulse" />
            ))}
          </div>
          <div className="h-96 rounded-2xl bg-zinc-900/40 border border-zinc-800 animate-pulse" />
        </div>
      ) : summary ? (
        <>
          {/* SECTION 1: HERO KPI METRIC SCORECARDS (5 COLUMNS) */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* Card 1: Sleep Duration */}
            <div className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/90 shadow-xl flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5 text-indigo-400">
                  <Moon className="h-3.5 w-3.5" /> Sleep Duration
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">Goal: 8.0h</span>
              </div>
              <div>
                <div className="text-2xl font-black text-indigo-300 flex items-baseline gap-1.5">
                  {summary.avgSleepText}
                  <span className="text-xs font-medium text-zinc-400">avg</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                  {summary.avgSleepHours >= 7.5 ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                      <CheckCircle2 className="h-3 w-3" /> Optimal Rest
                    </span>
                  ) : (
                    <span className="text-amber-400 font-semibold">
                      {summary.sleepDebtHours > 0 ? `${summary.sleepDebtHours}h debt` : 'Light Rest'}
                    </span>
                  )}
                  <span className="text-zinc-500 font-mono">• {summary.sleepTrackedDays} nights</span>
                </div>
              </div>
              <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-purple-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((summary.avgSleepHours / 8.0) * 100))}%` }}
                />
              </div>
            </div>

            {/* Card 2: Resting Heart Rate (RHR) */}
            <div className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/90 shadow-xl flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5 text-rose-400">
                  <Heart className="h-3.5 w-3.5" /> Resting Heart Rate
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">BPM</span>
              </div>
              <div>
                <div className="text-2xl font-black text-rose-400 flex items-baseline gap-1.5">
                  {summary.avgRhr > 0 ? `${summary.avgRhr}` : '—'}
                  <span className="text-xs font-medium text-zinc-400">bpm avg</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-1">
                  {summary.minRhr > 0 ? (
                    <span className="text-zinc-300">
                      Range: <strong className="text-emerald-400 font-mono">{summary.minRhr}</strong> -{' '}
                      <strong className="text-rose-400 font-mono">{summary.maxRhr}</strong> bpm
                    </span>
                  ) : (
                    'No cardiac data'
                  )}
                </div>
              </div>
              <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-rose-500 to-amber-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(20, 100 - (summary.avgRhr - 45) * 2))}%` }}
                />
              </div>
            </div>

            {/* Card 3: Heart Rate Variability (HRV) */}
            <div className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/90 shadow-xl flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5 text-cyan-400">
                  <Activity className="h-3.5 w-3.5" /> Heart Rate Var. (HRV)
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">MS</span>
              </div>
              <div>
                <div className="text-2xl font-black text-cyan-400 flex items-baseline gap-1.5">
                  {summary.avgHrv > 0 ? `${summary.avgHrv}` : '—'}
                  <span className="text-xs font-medium text-zinc-400">ms avg</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                  {summary.maxHrv > 0 ? (
                    <span>
                      Peak: <strong className="text-cyan-300 font-mono">{summary.maxHrv} ms</strong>
                    </span>
                  ) : (
                    'Autonomic balance'
                  )}
                  <span className="text-zinc-500 font-mono">• {summary.hrvTrackedDays} days</span>
                </div>
              </div>
              <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-teal-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((summary.avgHrv / 100) * 100))}%` }}
                />
              </div>
            </div>

            {/* Card 4: Daily Steps Tracker */}
            <div className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/90 shadow-xl flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5 text-emerald-400">
                  <TrendingUp className="h-3.5 w-3.5" /> Daily Steps
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">Goal: 10k</span>
              </div>
              <div>
                <div className="text-2xl font-black text-emerald-400 flex items-baseline gap-1.5">
                  {summary.avgSteps.toLocaleString()}
                  <span className="text-xs font-medium text-zinc-400">/ day</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                  <span className="font-mono text-emerald-300 font-bold">{summary.stepGoalHitRate}%</span>
                  <span>hit rate</span>
                  <span className="text-zinc-500 font-mono">({summary.daysOver10k} days)</span>
                </div>
              </div>
              <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((summary.avgSteps / 10000) * 100))}%` }}
                />
              </div>
            </div>

            {/* Card 5: Workout Energy & Calories */}
            <div className="p-4 rounded-2xl bg-[#14141B] border border-zinc-800/90 shadow-xl flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-semibold uppercase tracking-wider text-[10px] flex items-center gap-1.5 text-amber-400">
                  <Flame className="h-3.5 w-3.5" /> Workout Output
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">Apple Watch</span>
              </div>
              <div>
                <div className="text-2xl font-black text-amber-400 flex items-baseline gap-1.5">
                  {summary.totalWorkoutCalories.toLocaleString()}
                  <span className="text-xs font-medium text-zinc-400">kcal</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                  <span>{summary.totalWorkoutHours} hrs active</span>
                  <span className="text-zinc-500 font-mono">• {summary.activeWorkoutDays} sessions</span>
                </div>
              </div>
              <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-500 to-orange-400 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.round((summary.activeWorkoutDays / summary.totalDays) * 100))}%` }}
                />
              </div>
            </div>
          </section>

          {/* SECTION 2: INTERACTIVE VISUAL CHARTS COMMAND CENTER */}
          <section className="p-6 rounded-2xl bg-[#121218] border border-zinc-800/90 shadow-xl space-y-6">
            {/* Chart Sub-tabs Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-cyan-400" /> Longitudinal Visual Trends
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Hover over bars and data nodes to inspect daily biomarkers for {summary.periodLabel}.
                </p>
              </div>

              {/* Metric Selector Pills */}
              <div className="flex items-center gap-1.5 flex-wrap bg-[#181822] p-1 rounded-xl border border-zinc-800">
                <button
                  onClick={() => setActiveMetricTab('sleep')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeMetricTab === 'sleep'
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Moon className="h-3 w-3" />
                  <span>Sleep</span>
                </button>

                <button
                  onClick={() => setActiveMetricTab('cardio')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeMetricTab === 'cardio'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Heart className="h-3 w-3" />
                  <span>RHR & HRV</span>
                </button>

                <button
                  onClick={() => setActiveMetricTab('steps')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeMetricTab === 'steps'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <TrendingUp className="h-3 w-3" />
                  <span>Steps (10k)</span>
                </button>

                <button
                  onClick={() => setActiveMetricTab('workout')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeMetricTab === 'workout'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Flame className="h-3 w-3" />
                  <span>Workouts</span>
                </button>

                <button
                  onClick={() => setActiveMetricTab('weight')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeMetricTab === 'weight'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Scale className="h-3 w-3" />
                  <span>Bodyweight</span>
                </button>
              </div>
            </div>

            {/* CHART 1: SLEEP ARCHITECTURE (BARS + 8-HOUR TARGET LINE) */}
            {activeMetricTab === 'sleep' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Nightly Sleep Duration (Hours)</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono">
                      Average: {summary.avgSleepText}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className="h-2 w-2 rounded-full bg-indigo-400"></span> Optimal (7h+)
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className="h-2 w-2 rounded-full bg-purple-600"></span> Under 7h
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="h-0.5 w-3 border-t-2 border-dashed border-emerald-400"></span> 8.0h Target
                    </span>
                  </div>
                </div>

                {/* SVG Visual Bar Canvas */}
                <div className="relative pt-6 pb-2">
                  {/* 8.0 Hour Goal Guideline */}
                  <div
                    className="absolute left-0 right-0 border-b-2 border-dashed border-emerald-500/50 z-10 pointer-events-none flex items-center justify-end pr-2"
                    style={{ bottom: `${(8.0 / maxSleepVal) * 100 * 0.85 + 15}%` }}
                  >
                    <span className="text-[9px] font-mono text-emerald-400 bg-zinc-950 px-1 py-0.2 rounded border border-emerald-500/30">
                      8h Target
                    </span>
                  </div>

                  <div className="flex items-end gap-1.5 sm:gap-2 h-56 border-b border-zinc-800/80 pb-2 overflow-x-auto">
                    {days.map((d, idx) => {
                      const heightPct = d.sleepHours > 0 ? Math.min(100, (d.sleepHours / maxSleepVal) * 100) : 3;
                      const isOptimal = d.sleepHours >= 7.0;
                      const barColor =
                        d.sleepHours === 0
                          ? 'bg-zinc-800/50'
                          : isOptimal
                          ? 'bg-gradient-to-t from-indigo-600 via-indigo-500 to-purple-400 shadow-md shadow-indigo-500/20'
                          : 'bg-gradient-to-t from-purple-800 to-purple-600';

                      return (
                        <div
                          key={d.date}
                          onMouseEnter={() => setHoveredIndex(idx)}
                          onMouseLeave={() => setHoveredIndex(null)}
                          className="flex-1 min-w-[14px] flex flex-col items-center justify-end h-full group relative cursor-pointer"
                        >
                          {/* Hover Tooltip */}
                          <div
                            className={`absolute -top-16 z-30 hidden group-hover:flex flex-col items-center pointer-events-none whitespace-nowrap bg-zinc-950 border border-zinc-700 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-2xl ${
                              idx < 3 ? 'left-0' : idx > days.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                            }`}
                          >
                            <span className="font-bold text-zinc-200">
                              {d.weekday}, {d.dayLabel}
                            </span>
                            <span className="text-indigo-400 font-bold font-mono">
                              {d.sleepHours > 0 ? `${d.sleepHours} hrs (${d.sleepDuration})` : 'Untracked'}
                            </span>
                            {d.wakeTime && d.wakeTime !== 'No data' && (
                              <span className="text-[9px] text-zinc-400">
                                Bed: {d.sleepTime} • Wake: {d.wakeTime}
                              </span>
                            )}
                          </div>

                          <div
                            className={`w-full rounded-t-md transition-all duration-300 ${barColor} group-hover:brightness-125`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono pt-2">
                    <span>{days[0]?.dayLabel || 'Start'}</span>
                    <span>{days[Math.floor(days.length / 2)]?.dayLabel || 'Mid'}</span>
                    <span>{days[days.length - 1]?.dayLabel || 'Today'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CHART 2: CARDIOVASCULAR RECOVERY (RHR VS HRV DUAL METRIC) */}
            {activeMetricTab === 'cardio' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Cardiovascular Performance Dynamics</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono">
                      Resting HR vs HRV Variability
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-[11px] text-rose-400">
                      <span className="h-2 w-2 rounded-full bg-rose-400"></span> RHR (BPM, lower is better)
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-cyan-400">
                      <span className="h-2 w-2 rounded-full bg-cyan-400"></span> HRV (MS, higher is better)
                    </span>
                  </div>
                </div>

                {/* Dual Column Bars */}
                <div className="relative pt-6 pb-2">
                  <div className="flex items-end gap-2 sm:gap-3 h-56 border-b border-zinc-800/80 pb-2 overflow-x-auto">
                    {days.map((d, idx) => {
                      const rhrHeight = d.rhr > 0 ? Math.min(100, (d.rhr / maxCardioVal) * 100) : 3;
                      const hrvHeight = d.hrv > 0 ? Math.min(100, (d.hrv / maxCardioVal) * 100) : 3;

                      return (
                        <div
                          key={d.date}
                          className="flex-1 min-w-[20px] flex items-end justify-center gap-0.5 h-full group relative cursor-pointer"
                        >
                          {/* Tooltip */}
                          <div
                            className={`absolute -top-16 z-30 hidden group-hover:flex flex-col items-center pointer-events-none whitespace-nowrap bg-zinc-950 border border-zinc-700 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-2xl ${
                              idx < 3 ? 'left-0' : idx > days.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                            }`}
                          >
                            <span className="font-bold text-zinc-200">
                              {d.weekday}, {d.dayLabel}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-rose-400 font-mono font-bold">RHR: {d.rhr > 0 ? `${d.rhr} bpm` : '—'}</span>
                              <span className="text-cyan-400 font-mono font-bold">HRV: {d.hrv > 0 ? `${d.hrv} ms` : '—'}</span>
                            </div>
                          </div>

                          {/* RHR Bar */}
                          <div
                            className="w-1/2 rounded-t-sm bg-gradient-to-t from-rose-700 to-rose-500 transition-all duration-300 group-hover:brightness-125"
                            style={{ height: `${rhrHeight}%` }}
                          />
                          {/* HRV Bar */}
                          <div
                            className="w-1/2 rounded-t-sm bg-gradient-to-t from-cyan-700 to-cyan-400 transition-all duration-300 group-hover:brightness-125"
                            style={{ height: `${hrvHeight}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono pt-2">
                    <span>{days[0]?.dayLabel || 'Start'}</span>
                    <span>{days[Math.floor(days.length / 2)]?.dayLabel || 'Mid'}</span>
                    <span>{days[days.length - 1]?.dayLabel || 'Today'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CHART 3: STEPS TRACKER (10,000 STEP BENCHMARK) */}
            {activeMetricTab === 'steps' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Daily Step Volume & Consistency</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
                      Average: {summary.avgSteps.toLocaleString()} steps
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className="h-2 w-2 rounded-full bg-emerald-400"></span> 10,000+ Hit
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className="h-2 w-2 rounded-full bg-teal-600"></span> Under 10k
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="h-0.5 w-3 border-t-2 border-dashed border-emerald-400"></span> 10,000 Goal
                    </span>
                  </div>
                </div>

                <div className="relative pt-6 pb-2">
                  {/* 10,000 Benchmark Guideline */}
                  <div
                    className="absolute left-0 right-0 border-b-2 border-dashed border-emerald-500/50 z-10 pointer-events-none flex items-center justify-end pr-2"
                    style={{ bottom: `${(10000 / maxStepsVal) * 100 * 0.85 + 15}%` }}
                  >
                    <span className="text-[9px] font-mono text-emerald-400 bg-zinc-950 px-1 py-0.2 rounded border border-emerald-500/30">
                      10,000 Step Goal
                    </span>
                  </div>

                  <div className="flex items-end gap-1.5 sm:gap-2 h-56 border-b border-zinc-800/80 pb-2 overflow-x-auto">
                    {days.map((d, idx) => {
                      const heightPct = d.steps > 0 ? Math.min(100, (d.steps / maxStepsVal) * 100) : 3;
                      const hitGoal = d.steps >= 10000;
                      const barColor =
                        d.steps === 0
                          ? 'bg-zinc-800/50'
                          : hitGoal
                          ? 'bg-gradient-to-t from-emerald-600 via-teal-500 to-cyan-400 shadow-md shadow-emerald-500/20'
                          : 'bg-gradient-to-t from-teal-800 to-teal-600';

                      return (
                        <div
                          key={d.date}
                          className="flex-1 min-w-[14px] flex flex-col items-center justify-end h-full group relative cursor-pointer"
                        >
                          {/* Tooltip */}
                          <div
                            className={`absolute -top-16 z-30 hidden group-hover:flex flex-col items-center pointer-events-none whitespace-nowrap bg-zinc-950 border border-zinc-700 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-2xl ${
                              idx < 3 ? 'left-0' : idx > days.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                            }`}
                          >
                            <span className="font-bold text-zinc-200">
                              {d.weekday}, {d.dayLabel}
                            </span>
                            <span className="text-emerald-400 font-bold font-mono">
                              {d.steps.toLocaleString()} steps ({d.stepsPercentage}%)
                            </span>
                            <span className="text-[9px] text-zinc-400">
                              {hitGoal ? '🎉 Daily target met' : `${(10000 - d.steps).toLocaleString()} remaining`}
                            </span>
                          </div>

                          <div
                            className={`w-full rounded-t-md transition-all duration-300 ${barColor} group-hover:brightness-125`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono pt-2">
                    <span>{days[0]?.dayLabel || 'Start'}</span>
                    <span>{days[Math.floor(days.length / 2)]?.dayLabel || 'Mid'}</span>
                    <span>{days[days.length - 1]?.dayLabel || 'Today'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CHART 4: WORKOUT OUTPUT (CALORIES & DURATION) */}
            {activeMetricTab === 'workout' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Training Intensity & Caloric Output</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                      Total: {summary.totalWorkoutCalories.toLocaleString()} kcal
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                      <span className="h-2 w-2 rounded-full bg-amber-400"></span> Active Energy (Kcal)
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-orange-400">
                      <span className="h-2 w-2 rounded-full bg-orange-400"></span> Session Duration (Min)
                    </span>
                  </div>
                </div>

                <div className="relative pt-6 pb-2">
                  <div className="flex items-end gap-1.5 sm:gap-2 h-56 border-b border-zinc-800/80 pb-2 overflow-x-auto">
                    {days.map((d, idx) => {
                      const heightPct =
                        d.workoutCalories > 0 ? Math.min(100, (d.workoutCalories / maxWorkoutCalVal) * 100) : 3;

                      return (
                        <div
                          key={d.date}
                          className="flex-1 min-w-[14px] flex flex-col items-center justify-end h-full group relative cursor-pointer"
                        >
                          {/* Tooltip */}
                          <div
                            className={`absolute -top-16 z-30 hidden group-hover:flex flex-col items-center pointer-events-none whitespace-nowrap bg-zinc-950 border border-zinc-700 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-2xl ${
                              idx < 3 ? 'left-0' : idx > days.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                            }`}
                          >
                            <span className="font-bold text-zinc-200">
                              {d.weekday}, {d.dayLabel}
                            </span>
                            <span className="text-amber-400 font-bold font-mono">
                              {d.workoutCalories > 0 ? `${d.workoutCalories} kcal` : 'Rest day'}
                            </span>
                            {d.workoutDuration > 0 && (
                              <span className="text-[9px] text-zinc-400">Duration: {d.workoutDuration} mins</span>
                            )}
                          </div>

                          <div
                            className={`w-full rounded-t-md transition-all duration-300 ${
                              d.workoutCalories > 0
                                ? 'bg-gradient-to-t from-amber-600 via-orange-500 to-amber-300 shadow-md shadow-amber-500/20'
                                : 'bg-zinc-800/50'
                            } group-hover:brightness-125`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono pt-2">
                    <span>{days[0]?.dayLabel || 'Start'}</span>
                    <span>{days[Math.floor(days.length / 2)]?.dayLabel || 'Mid'}</span>
                    <span>{days[days.length - 1]?.dayLabel || 'Today'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CHART 5: BODYWEIGHT TRAJECTORY */}
            {activeMetricTab === 'weight' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">Bodyweight Longitudinal Trajectory</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono">
                      Current: {summary.currentWeight} lbs ({summary.weightDelta > 0 ? `+${summary.weightDelta}` : summary.weightDelta} lbs)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-400">
                      Min: <strong className="text-white font-mono">{summary.minWeight}</strong> • Max:{' '}
                      <strong className="text-white font-mono">{summary.maxWeight}</strong> lbs
                    </span>
                  </div>
                </div>

                <div className="relative pt-6 pb-2">
                  <div className="flex items-end gap-1.5 sm:gap-2 h-56 border-b border-zinc-800/80 pb-2 overflow-x-auto">
                    {days.map((d, idx) => {
                      const minBound = summary.minWeight - 5;
                      const maxBound = summary.maxWeight + 5;
                      const heightPct = Math.min(100, Math.max(10, ((d.bodyweight - minBound) / (maxBound - minBound)) * 100));

                      return (
                        <div
                          key={d.date}
                          className="flex-1 min-w-[14px] flex flex-col items-center justify-end h-full group relative cursor-pointer"
                        >
                          {/* Tooltip */}
                          <div
                            className={`absolute -top-14 z-30 hidden group-hover:flex flex-col items-center pointer-events-none whitespace-nowrap bg-zinc-950 border border-zinc-700 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-2xl ${
                              idx < 3 ? 'left-0' : idx > days.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                            }`}
                          >
                            <span className="font-bold text-zinc-200">
                              {d.weekday}, {d.dayLabel}
                            </span>
                            <span className="text-cyan-400 font-bold font-mono">{d.bodyweight} lbs</span>
                          </div>

                          <div
                            className="w-full rounded-t-md bg-gradient-to-t from-cyan-600 via-teal-500 to-cyan-300 transition-all duration-300 group-hover:brightness-125"
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono pt-2">
                    <span>{days[0]?.dayLabel || 'Start'}</span>
                    <span>{days[Math.floor(days.length / 2)]?.dayLabel || 'Mid'}</span>
                    <span>{days[days.length - 1]?.dayLabel || 'Today'}</span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 3: YEARLY MACRO MONTHLY BREAKDOWN (WHEN YEAR VIEW IS ACTIVE) */}
          {timeframe === 'year' && months.length > 0 && (
            <section className="p-6 rounded-2xl bg-[#121218] border border-zinc-800/90 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-purple-400" /> Monthly Longitudinal Breakdown
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Aggregated monthly performance across sleep, cardiac health, and fitness volume.
                  </p>
                </div>
                <span className="text-xs font-mono text-zinc-500">{months.length} months tracked</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                {months.map((m) => (
                  <div
                    key={m.monthKey}
                    className="p-4 rounded-xl bg-[#181822] border border-zinc-800 hover:border-zinc-700 transition space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                      <span className="text-sm font-bold text-white">{m.monthLabel}</span>
                      <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                        {m.daysTracked} days
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-[10px] uppercase font-bold text-zinc-500">Avg Sleep</div>
                        <div className="text-sm font-black text-indigo-400 font-mono">
                          {m.avgSleep > 0 ? `${m.avgSleep}h` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-zinc-500">Avg Steps</div>
                        <div className="text-sm font-black text-emerald-400 font-mono">
                          {m.avgSteps.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-zinc-500">Resting HR</div>
                        <div className="text-sm font-black text-rose-400 font-mono">
                          {m.avgRhr > 0 ? `${m.avgRhr} bpm` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold text-zinc-500">Workouts</div>
                        <div className="text-sm font-black text-amber-400 font-mono">
                          {m.totalWorkoutCalories.toLocaleString()} cals
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* SECTION 4: HISTORICAL DATA TABLE */}
          <section className="p-6 rounded-2xl bg-[#121218] border border-zinc-800/90 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ListFilter className="h-4 w-4 text-cyan-400" /> Historical Biometric Ledger
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Detailed day-by-day records collected from Apple Health for {summary.periodLabel}.
                </p>
              </div>
              <span className="text-xs font-mono text-zinc-500">{days.length} total entries</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-[#181822] text-[10px] uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Sleep</th>
                    <th className="py-3 px-4">Resting HR</th>
                    <th className="py-3 px-4">HRV</th>
                    <th className="py-3 px-4">Steps</th>
                    <th className="py-3 px-4">Workout</th>
                    <th className="py-3 px-4">Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {days
                    .slice()
                    .reverse()
                    .slice(0, 30)
                    .map((d) => (
                      <tr key={d.date} className="hover:bg-zinc-900/40 transition">
                        <td className="py-2.5 px-4 font-mono font-medium text-white">
                          {d.date}{' '}
                          <span className="text-[10px] text-zinc-500 font-normal">({d.weekday})</span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-mono font-bold ${
                              d.sleepHours >= 7 ? 'text-indigo-300' : d.sleepHours > 0 ? 'text-purple-400' : 'text-zinc-600'
                            }`}
                          >
                            {d.sleepDuration}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-mono font-bold text-rose-400">
                            {d.rhr > 0 ? `${d.rhr} bpm` : '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-mono font-bold text-cyan-400">
                            {d.hrv > 0 ? `${d.hrv} ms` : '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-mono font-bold ${
                              d.steps >= 10000 ? 'text-emerald-400' : 'text-zinc-300'
                            }`}
                          >
                            {d.steps.toLocaleString()}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-mono text-amber-400">
                            {d.workoutCalories > 0 ? `${d.workoutCalories} cals` : '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-zinc-400">
                          {d.bodyweight} lbs
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="p-8 rounded-2xl bg-[#14141B] border border-zinc-800 text-center space-y-2">
          <AlertCircle className="h-8 w-8 text-amber-400 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Biometrics Recorded Yet</h3>
          <p className="text-xs text-zinc-400">
            Ensure your Apple Health shortcut is active and syncing to Kevin-OS.
          </p>
        </div>
      )}

      {/* Edit Biometrics Modal */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="bg-[#121218] border border-zinc-700/80 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-cyan-400" />
                  Edit / Override Biometric Record
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Target Date: <span className="font-mono text-zinc-200">{editFormData.date}</span> • Direct Supabase & Sheets Update
                </p>
              </div>

              <button
                onClick={() => setShowEditModal(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMetrics} className="space-y-4">
              {/* Date Input */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Date</label>
                <input
                  type="date"
                  value={editFormData.date}
                  onChange={(e) => setEditFormData({ ...editFormData, date: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  required
                />
              </div>

              {/* Sleep Architecture Group */}
              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-400 uppercase tracking-wider">
                  <Moon className="h-3.5 w-3.5" /> Sleep Architecture
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Duration (Hours or 6h 43m)</label>
                    <input
                      type="text"
                      placeholder="e.g. 6.7 or 6h 43m"
                      value={editFormData.sleep}
                      onChange={(e) => setEditFormData({ ...editFormData, sleep: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Fell Asleep (Bedtime)</label>
                    <input
                      type="text"
                      placeholder="e.g. 10:48 PM"
                      value={editFormData.sleepTime}
                      onChange={(e) => setEditFormData({ ...editFormData, sleepTime: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Woke Up Time</label>
                    <input
                      type="text"
                      placeholder="e.g. 5:44 AM"
                      value={editFormData.wakeTime}
                      onChange={(e) => setEditFormData({ ...editFormData, wakeTime: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Cardiovascular & Steps Group */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-emerald-400" /> Steps
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 8500"
                    value={editFormData.steps}
                    onChange={(e) => setEditFormData({ ...editFormData, steps: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                    <Heart className="h-3 w-3 text-rose-400" /> RHR (BPM)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 55"
                    value={editFormData.rhr}
                    onChange={(e) => setEditFormData({ ...editFormData, rhr: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                    <Activity className="h-3 w-3 text-cyan-400" /> HRV (MS)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 82"
                    value={editFormData.hrv}
                    onChange={(e) => setEditFormData({ ...editFormData, hrv: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              {/* Weight & Workouts Group */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                    <Scale className="h-3 w-3 text-cyan-400" /> Weight (lbs)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 172.8"
                    value={editFormData.weight}
                    onChange={(e) => setEditFormData({ ...editFormData, weight: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                    <Flame className="h-3 w-3 text-amber-400" /> Workout Cal
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 420"
                    value={editFormData.workoutCalories}
                    onChange={(e) => setEditFormData({ ...editFormData, workoutCalories: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                    <Zap className="h-3 w-3 text-amber-400" /> Workout Mins
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 55"
                    value={editFormData.workoutDuration}
                    onChange={(e) => setEditFormData({ ...editFormData, workoutDuration: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              {/* Modal Action Buttons */}
              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingMetrics}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-black bg-cyan-400 hover:bg-cyan-300 shadow-md transition disabled:opacity-50"
                >
                  {savingMetrics ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  <span>Save to Supabase</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
