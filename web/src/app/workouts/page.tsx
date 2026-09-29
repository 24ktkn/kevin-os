'use client';

import React, { useState, useEffect, useCallback, useId } from 'react';
import Link from 'next/link';
import {
  Dumbbell,
  UploadCloud,
  Activity,
  TrendingUp,
  Award,
  RefreshCw,
  Flame,
  CheckCircle2,
  Clock,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  ChevronRight,
  Calculator,
} from 'lucide-react';
import {
  WorkoutsResponseData,
  MuscleRecoveryStatus,
  ExercisePR,
  WorkoutSessionSummary,
} from '@/types/workout';

export default function WorkoutsPage() {
  const [data, setData] = useState<WorkoutsResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'recovery' | 'importer' | 'ledger' | '1rm'>('recovery');
  
  // Hevy CSV Upload State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 1RM Calculator Interactive State
  const [calcWeight, setCalcWeight] = useState<number>(185);
  const [calcReps, setCalcReps] = useState<number>(8);

  const fileInputId = useId();

  // Fetch Workout Data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workouts');
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load workout data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle File Input
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCsvFile(file);
      setUploadMessage(null);
      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvText(String(event.target?.result || ''));
      };
      reader.readAsText(file);
    }
  };

  // Submit CSV
  const handleUploadCSV = async () => {
    if (!csvText) {
      setUploadMessage({ type: 'error', text: 'Please select a valid CSV file first.' });
      return;
    }

    setUploading(true);
    setUploadMessage(null);

    try {
      const res = await fetch('/api/workouts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: csvText }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setUploadMessage({ type: 'success', text: json.message });
        setCsvFile(null);
        setCsvText('');
        await fetchData(); // Refresh analytics
      } else {
        setUploadMessage({ type: 'error', text: json.error || 'Failed to import CSV' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown upload error';
      setUploadMessage({ type: 'error', text: msg });
    } finally {
      setUploading(false);
    }
  };

  // 1RM Calculation Formula: weight * (1 + reps / 30)
  const calculated1RM = Math.round((calcWeight * (1 + calcReps / 30.0)) * 10) / 10;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0D] text-white p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🏋️</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              Training Command Center
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Workout Tracker & Hevy Hub
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Muscle recovery readiness, volume progression, and Hevy workout ingestion.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 hover:text-white transition shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Top KPI Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
          <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            Total Sessions
          </div>
          <div className="text-2xl font-black text-cyan-400 mt-2">
            {data ? data.totalWorkouts : '--'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Logged workouts</div>
        </div>

        <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
          <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Total Volume
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-2">
            {data ? `${(data.totalVolumeLbs / 1000).toFixed(1)}k lbs` : '--'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Cumulative weight lifted</div>
        </div>

        <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
          <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            Avg. Session Length
          </div>
          <div className="text-2xl font-black text-amber-400 mt-2">
            {data ? `${data.averageDurationMins} min` : '--'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Average gym duration</div>
        </div>

        <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between">
          <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider flex items-center gap-1.5">
            <Award className="h-3.5 w-3.5 text-purple-400" />
            Top Estimated 1RM
          </div>
          <div className="text-2xl font-black text-purple-400 mt-2 truncate">
            {data && data.personalRecords.length > 0
              ? `${data.personalRecords[0].bestEstimated1RM} lbs`
              : '--'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 truncate">
            {data && data.personalRecords.length > 0 ? data.personalRecords[0].exercise : 'Compound peak'}
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('recovery')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'recovery'
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>Muscle Recovery Grid</span>
        </button>

        <button
          onClick={() => setActiveTab('importer')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'importer'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <UploadCloud className="h-3.5 w-3.5" />
          <span>Hevy CSV Importer</span>
        </button>

        <button
          onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'ledger'
              ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          <span>Volume & Session History</span>
        </button>

        <button
          onClick={() => setActiveTab('1rm')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === '1rm'
              ? 'bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-lg shadow-purple-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Calculator className="h-3.5 w-3.5" />
          <span>1RM Calculator & PRs</span>
        </button>
      </div>

      {/* TAB 1: MUSCLE RECOVERY GRID */}
      {activeTab === 'recovery' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#121218] p-4 rounded-xl border border-zinc-800/80">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🔋</span> Muscle Group Recovery Readiness
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Calculates hours elapsed since each muscle group was stimulated in your Hevy workouts.
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-semibold">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Fresh (&gt;72h)
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Recovering (24–72h)
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="h-2 w-2 rounded-full bg-rose-400" /> Fatigued (&lt;24h)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {data && data.muscleRecovery.length > 0 ? (
              data.muscleRecovery.map((mr) => {
                const isFresh = mr.status === 'fresh';
                const isRecovering = mr.status === 'recovering';
                const isFatigued = mr.status === 'fatigued';

                return (
                  <div
                    key={mr.muscleGroup}
                    className={`p-4 rounded-xl bg-[#14141B] border transition-all ${
                      isFresh
                        ? 'border-emerald-500/30 hover:border-emerald-500/50'
                        : isRecovering
                        ? 'border-amber-500/30 hover:border-amber-500/50'
                        : 'border-rose-500/30 hover:border-rose-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">{mr.muscleGroup}</span>
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                          isFresh
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : isRecovering
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {isFresh ? 'Ready To Train' : isRecovering ? 'Recovering' : 'Fatigued'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-2xl font-black text-white">
                        {mr.hoursElapsed !== null ? `${mr.hoursElapsed}h` : 'No history'}
                      </span>
                      {mr.hoursElapsed !== null && (
                        <span className="text-xs text-zinc-400">
                          {mr.hoursElapsed >= 24 ? `(${Math.floor(mr.hoursElapsed / 24)}d ago)` : 'recently'}
                        </span>
                      )}
                    </div>

                    {mr.lastExercises.length > 0 ? (
                      <div className="mt-3 pt-3 border-t border-zinc-800/60">
                        <div className="text-[10px] font-bold uppercase text-zinc-500 tracking-wider mb-1">
                          Last Stimulated With:
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {mr.lastExercises.map((e, idx) => (
                            <span
                              key={idx}
                              className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 truncate max-w-full"
                            >
                              {e}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 pt-3 border-t border-zinc-800/60 text-xs text-zinc-500 italic">
                        Clear to train without fatigue.
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="col-span-full p-8 text-center text-zinc-500">
                Loading muscle recovery telemetry...
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: HEVY CSV IMPORTER */}
      {activeTab === 'importer' && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-[#121218] p-5 rounded-2xl border border-zinc-800/80 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">📥</span>
              <h3 className="text-base font-bold text-white">Import Hevy Workouts</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Export your workout data from the Hevy app (Profile &rarr; Settings &rarr; Export Data &rarr; CSV), 
              then drop the file here. KevinOS will automatically compute your 1RM, volume progressions, and muscle recovery matrix.
            </p>
          </div>

          {/* Drag & Drop Zone */}
          <div className="p-8 rounded-2xl border-2 border-dashed border-zinc-700/80 hover:border-cyan-500/80 bg-[#14141B] transition-all flex flex-col items-center justify-center text-center space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-inner">
              <FileSpreadsheet className="h-7 w-7" />
            </div>

            <div>
              <p className="text-sm font-bold text-white">
                {csvFile ? csvFile.name : 'Select or Drop your Hevy CSV file'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {csvFile
                  ? `${(csvFile.size / 1024).toFixed(1)} KB • Ready for cloud sync`
                  : 'Supports standard Hevy export format (hevy_workouts.csv)'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                id={fileInputId}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor={fileInputId}
                className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-xs font-semibold text-zinc-200 hover:text-white cursor-pointer transition shadow-sm"
              >
                Browse CSV File
              </label>

              {csvFile && (
                <button
                  onClick={handleUploadCSV}
                  disabled={uploading}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-xs font-bold text-white transition flex items-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                >
                  <UploadCloud className={`h-4 w-4 ${uploading ? 'animate-bounce' : ''}`} />
                  <span>{uploading ? 'Ingesting...' : 'Ingest & Sync Cloud'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Status Message */}
          {uploadMessage && (
            <div
              className={`p-4 rounded-xl border text-xs flex items-center gap-3 ${
                uploadMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}
            >
              {uploadMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{uploadMessage.text}</span>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: VOLUME & SESSION LEDGER */}
      {activeTab === 'ledger' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-400" />
              Recent Workout Sessions
            </h3>
            <span className="text-xs text-zinc-400">
              {data ? `${data.recentSessions.length} sessions recorded` : ''}
            </span>
          </div>

          <div className="space-y-3">
            {data && data.recentSessions.length > 0 ? (
              data.recentSessions.map((session, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 hover:border-zinc-700/80 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold uppercase px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        {session.splitDay}
                      </span>
                      <span className="text-xs font-semibold text-zinc-300">
                        {session.date}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {session.exercises.slice(0, 5).map((e, eIdx) => (
                        <span
                          key={eIdx}
                          className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300"
                        >
                          {e}
                        </span>
                      ))}
                      {session.exercises.length > 5 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-900 text-zinc-400">
                          +{session.exercises.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 sm:text-right shrink-0">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-zinc-500">Volume</div>
                      <div className="text-sm font-black text-emerald-400">
                        {session.totalVolumeLbs.toLocaleString()} lbs
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-zinc-500">Sets</div>
                      <div className="text-sm font-black text-white">
                        {session.setCount} sets
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase text-zinc-500">Duration</div>
                      <div className="text-sm font-black text-amber-400">
                        {session.gymDurationMins} min
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-zinc-500">No workout sessions logged yet.</div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: 1RM CALCULATOR & PRs */}
      {activeTab === '1rm' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Interactive Calculator */}
          <div className="p-5 rounded-2xl bg-[#14141B] border border-zinc-800/80 space-y-5">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-purple-400" />
              <h3 className="text-base font-bold text-white">1RM Formula Calculator</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-bold uppercase text-zinc-400 tracking-wider block mb-1.5">
                  Weight (lbs)
                </label>
                <input
                  type="number"
                  value={calcWeight}
                  onChange={(e) => setCalcWeight(parseFloat(e.target.value) || 0)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-bold text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase text-zinc-400 tracking-wider block mb-1.5">
                  Reps Performed
                </label>
                <input
                  type="number"
                  value={calcReps}
                  onChange={(e) => setCalcReps(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-bold text-sm focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Calculated Result Card */}
              <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                <div className="text-[10px] font-extrabold uppercase text-purple-400 tracking-wider">
                  Estimated One-Rep Max
                </div>
                <div className="text-3xl font-black text-white mt-1">
                  {calculated1RM} <span className="text-base font-semibold text-purple-300">lbs</span>
                </div>
                <div className="text-[10px] text-zinc-400 mt-1">Epley Formula: W &times; (1 + R / 30)</div>
              </div>

              {/* Training Percentages */}
              <div className="space-y-1.5 pt-2">
                <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-1">
                  Training Percentages:
                </div>
                {[
                  { pct: '90%', weight: Math.round(calculated1RM * 0.9) },
                  { pct: '80%', weight: Math.round(calculated1RM * 0.8) },
                  { pct: '70%', weight: Math.round(calculated1RM * 0.7) },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800"
                  >
                    <span className="text-zinc-400">{item.pct} intensity</span>
                    <span className="font-bold text-white">{item.weight} lbs</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Personal Records Leaderboard */}
          <div className="lg:col-span-2 p-5 rounded-2xl bg-[#14141B] border border-zinc-800/80 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Estimated 1RM Leaderboard</h3>
              </div>
              <span className="text-xs text-zinc-400">Peak performance per exercise</span>
            </div>

            <div className="space-y-2.5">
              {data && data.personalRecords.length > 0 ? (
                data.personalRecords.map((pr, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-black text-xs">
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{pr.exercise}</div>
                        <div className="text-[11px] text-zinc-400">
                          {pr.muscleGroup} • {pr.maxWeightLbs} lbs &times; {pr.maxRepsAtMaxWeight} reps on {pr.dateAchieved}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-base font-black text-amber-300">
                        {pr.bestEstimated1RM} lbs
                      </div>
                      <div className="text-[10px] text-zinc-500">Est. 1RM</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-zinc-500">
                  Import a Hevy CSV file to calculate your 1RM records.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
