'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Save,
  Clock,
  MapPin,
  Dumbbell,
  GraduationCap,
  Sparkles,
  Footprints,
  Moon,
  Heart,
  Flame,
  CheckCircle2,
  Image as ImageIcon,
  Plus,
  Trash2,
} from 'lucide-react';

interface BiometricsData {
  date: string;
  raw_date: string;
  steps: number;
  steps_goal: number;
  steps_percentage: number;
  hrv: number;
  sleep_duration: string;
  sleep_hours: number;
  sleep_time: string;
  wake_time: string;
  rhr: number;
  bodyweight: number;
  workout_calories: number;
  workout_duration: number;
}

interface TimelineItem {
  id: string;
  time: string;
  title: string;
  type: 'event' | 'task' | 'workout' | 'school' | 'location';
  category: string;
  is_completed: boolean;
}

interface LocationItem {
  timestamp: string;
  time: string;
  name: string;
  lat: number;
  lng: number;
}

export default function DailyJournalPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    // Current date in EDT
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  });

  const [entryText, setEntryText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [showPhotoInput, setShowPhotoInput] = useState(false);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [biometrics, setBiometrics] = useState<BiometricsData | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Load Journal Entry, Locations, and Timeline for selectedDate
  const loadDayData = useCallback(async (dateStr: string) => {
    setLoading(true);
    try {
      // 1. Fetch Journal & Timeline
      const jRes = await fetch(`/api/journal?date=${dateStr}`);
      const jData = await jRes.json();
      if (jData.success) {
        setEntryText(jData.entry || '');
        setPhotos(jData.photos || []);
        setLocations(jData.locations || []);
        setTimeline(jData.timeline || []);
      }

      // 2. Fetch Biometrics for date
      const bRes = await fetch(`/api/health?date=${dateStr}`);
      const bData = await bRes.json();
      if (bData.success && bData.data) {
        setBiometrics(bData.data);
      } else {
        setBiometrics(null);
      }
    } catch (err) {
      console.error('Failed to load day data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDayData(selectedDate);
  }, [selectedDate, loadDayData]);

  // Save Journal Entry
  const handleSaveJournal = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          entry: entryText,
          photos,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLastSaved(
          new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
        );
      }
    } catch (err) {
      console.error('Failed to save journal:', err);
    } finally {
      setSaving(false);
    }
  };

  // Date Navigation Helpers
  const shiftDate = (days: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const yStr = dt.getFullYear();
    const mStr = String(dt.getMonth() + 1).padStart(2, '0');
    const dStr = String(dt.getDate()).padStart(2, '0');
    setSelectedDate(`${yStr}-${mStr}-${dStr}`);
  };

  const setDateToToday = () => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    setSelectedDate(formatter.format(now));
  };

  // Insert Guided Prompts into Journal
  const insertPrompt = (title: string, placeholder: string) => {
    const addition = `\n\n### ${title}\n${placeholder}\n`;
    setEntryText((prev) => (prev ? prev.trim() + addition : `### ${title}\n${placeholder}\n`));
  };

  // Add Photo URL
  const handleAddPhoto = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhotoUrl.trim()) return;
    setPhotos((prev) => [...prev, newPhotoUrl.trim()]);
    setNewPhotoUrl('');
    setShowPhotoInput(false);
  };

  const handleRemovePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  // Formatted Date Header
  const dateObj = new Date(selectedDate + 'T12:00:00');
  const formattedDateTitle = isNaN(dateObj.getTime())
    ? selectedDate
    : dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });

  const wordCount = entryText.trim() ? entryText.trim().split(/\s+/).length : 0;

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0F0F14]/90 backdrop-blur-md px-4 sm:px-8 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-purple-400" /> Daily Time Atlas
            </h1>
            <span className="text-xs text-zinc-400 font-mono">| Reflection & Timeline Hub</span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Your locations, activities, biometrics, and journals summarized in one beautiful view
          </p>
        </div>

        {/* Date Navigator Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            <button
              onClick={() => shiftDate(-1)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              title="Previous Day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5 px-2">
              <CalendarIcon className="h-3.5 w-3.5 text-purple-400" />
              <input
                type="date"
                value={selectedDate}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none [color-scheme:dark] cursor-pointer"
              />
            </div>

            <button
              onClick={() => shiftDate(1)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              title="Next Day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={setDateToToday}
            className="px-3 py-1.5 rounded-xl text-xs font-medium text-purple-300 hover:text-white bg-purple-950/40 border border-purple-800/60 hover:bg-purple-900/60 transition"
          >
            Today
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {/* SECTION 1: BIOMETRICS SUMMARY RIBBON */}
        <section className="rounded-2xl border border-zinc-800/80 bg-[#121218] p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3 border-b border-zinc-800/60 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" /> Biometrics Summary — {formattedDateTitle}
            </h2>
            {biometrics && (
              <span className="text-[11px] font-mono text-zinc-500">
                Bodyweight: <strong className="text-white">{biometrics.bodyweight} lbs</strong>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Steps */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
                <Footprints className="h-3.5 w-3.5 text-cyan-400" /> Steps
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {biometrics ? biometrics.steps.toLocaleString() : '—'}
              </div>
              <div className="text-[10px] text-zinc-500">
                {biometrics ? `${biometrics.steps_percentage}% goal` : 'No data'}
              </div>
            </div>

            {/* Sleep */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
                <Moon className="h-3.5 w-3.5 text-indigo-400" /> Sleep
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {biometrics ? biometrics.sleep_duration : '—'}
              </div>
              <div className="text-[10px] text-zinc-500">
                {biometrics && biometrics.wake_time !== 'No data' ? `Wake: ${biometrics.wake_time}` : 'In Bed'}
              </div>
            </div>

            {/* HRV */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
                <Heart className="h-3.5 w-3.5 text-purple-400" /> HRV
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {biometrics && biometrics.hrv > 0 ? `${biometrics.hrv} ms` : '—'}
              </div>
              <div className="text-[10px] text-zinc-500">Autonomic state</div>
            </div>

            {/* Resting HR */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
                <Heart className="h-3.5 w-3.5 text-rose-400" /> Resting HR
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {biometrics && biometrics.rhr > 0 ? `${biometrics.rhr} bpm` : '—'}
              </div>
              <div className="text-[10px] text-zinc-500">Recovery baseline</div>
            </div>

            {/* Workout Calories */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
                <Flame className="h-3.5 w-3.5 text-amber-500" /> Workout Cal
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {biometrics ? `${biometrics.workout_calories} kcal` : '—'}
              </div>
              <div className="text-[10px] text-zinc-500">Active burn</div>
            </div>

            {/* Workout Duration */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
                <Clock className="h-3.5 w-3.5 text-emerald-400" /> Workout Time
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {biometrics && biometrics.workout_duration > 0 ? `${biometrics.workout_duration}m` : '0m'}
              </div>
              <div className="text-[10px] text-zinc-500">Session length</div>
            </div>
          </div>
        </section>

        {/* SECTION 2: TWO-COLUMN WORKSPACE (JOURNAL + TIMELINE) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN: DAILY JOURNAL REFLECTION & PHOTOS (2 COLS) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-zinc-800/80 bg-[#121218] p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-200 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-purple-400" /> Daily Reflection
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Capture insights, mental reflections, and daily lessons
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {lastSaved && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Saved at {lastSaved}
                    </span>
                  )}
                  <button
                    onClick={handleSaveJournal}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-black bg-emerald-400 hover:bg-emerald-300 transition shadow-md shadow-emerald-500/20 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{saving ? 'Saving...' : 'Save Reflection'}</span>
                  </button>
                </div>
              </div>

              {/* Quick Guided Reflection Starters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-zinc-400">Quick Prompts:</span>
                <button
                  type="button"
                  onClick={() => insertPrompt('🌟 Highlights & Wins', '- ')}
                  className="px-2.5 py-1 rounded-lg text-xs bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition"
                >
                  🌟 Wins & Highlights
                </button>
                <button
                  type="button"
                  onClick={() => insertPrompt('🧠 Key Learnings', '- ')}
                  className="px-2.5 py-1 rounded-lg text-xs bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition"
                >
                  🧠 Key Learnings
                </button>
                <button
                  type="button"
                  onClick={() => insertPrompt('🙏 Daily Gratitude', '1. \n2. \n3. ')}
                  className="px-2.5 py-1 rounded-lg text-xs bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition"
                >
                  🙏 Gratitude
                </button>
                <button
                  type="button"
                  onClick={() => insertPrompt('⚡ Energy & Reflections', '')}
                  className="px-2.5 py-1 rounded-lg text-xs bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition"
                >
                  ⚡ Energy & Mindset
                </button>
              </div>

              {/* Reflection Textarea */}
              <div className="relative">
                <textarea
                  value={entryText}
                  onChange={(e) => setEntryText(e.target.value)}
                  placeholder="How did today feel? What was meaningful, what went well, and what did you learn?"
                  rows={14}
                  className="w-full bg-[#0F0F14] border border-zinc-800/90 rounded-xl p-4 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-purple-500 font-sans leading-relaxed resize-y"
                />
                <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono px-1 mt-1">
                  <span>Markdown formatting supported</span>
                  <span>{wordCount} words</span>
                </div>
              </div>
            </div>

            {/* Photo Memories & Highlights */}
            <div className="rounded-2xl border border-zinc-800/80 bg-[#121218] p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
                    Photo Memories & Highlights ({photos.length})
                  </h3>
                </div>

                <button
                  onClick={() => setShowPhotoInput((v) => !v)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white transition"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Photo</span>
                </button>
              </div>

              {/* Add Photo Form */}
              {showPhotoInput && (
                <form onSubmit={handleAddPhoto} className="flex gap-2">
                  <input
                    type="url"
                    required
                    placeholder="Paste photo image URL (Google Photos / Web)..."
                    value={newPhotoUrl}
                    onChange={(e) => setNewPhotoUrl(e.target.value)}
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-black bg-cyan-400 hover:bg-cyan-300 transition"
                  >
                    Attach
                  </button>
                </form>
              )}

              {/* Photo Reel Grid */}
              {photos.length === 0 ? (
                <div className="text-center py-6 text-xs text-zinc-500">
                  No photos attached for this date. Click &quot;Add Photo&quot; to link highlights from your day.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {photos.map((url, i) => (
                    <div
                      key={`photo-${i}`}
                      className="group relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 aspect-square"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Daily memory ${i + 1}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=500&q=80';
                        }}
                      />
                      <button
                        onClick={() => handleRemovePhoto(i)}
                        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove photo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: TIME ATLAS TIMELINE (1 COL) */}
          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-800/80 bg-[#121218] p-5 sm:p-6 space-y-4">
              <div className="border-b border-zinc-800/80 pb-3">
                <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-200 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-cyan-400" /> Day Timeline
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">Chronological activities, locations & events</p>
              </div>

              {/* Timeline Items */}
              {timeline.length === 0 && locations.length === 0 ? (
                <div className="text-center py-8 text-xs text-zinc-500">
                  No timeline checkpoints or tasks logged for {selectedDate}.
                </div>
              ) : (
                <div className="relative pl-6 border-l-2 border-zinc-800 space-y-4 py-2">
                  {/* Wake Timestamp if available */}
                  {biometrics && biometrics.wake_time && biometrics.wake_time !== 'No data' && (
                    <div className="relative">
                      <div className="absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full bg-amber-400 border-2 border-[#121218]" />
                      <div className="text-[10px] font-mono text-amber-400 font-semibold">{biometrics.wake_time}</div>
                      <div className="text-xs font-bold text-white">☀️ Wake Up Time</div>
                    </div>
                  )}

                  {/* Task & Event Items */}
                  {timeline.map((item) => {
                    const isWorkout = item.type === 'workout';
                    const isSchool = item.type === 'school';
                    const dotColor = isWorkout
                      ? 'bg-rose-500'
                      : isSchool
                      ? 'bg-cyan-400'
                      : item.type === 'event'
                      ? 'bg-purple-400'
                      : 'bg-emerald-400';

                    return (
                      <div key={item.id} className="relative group">
                        <div
                          className={`absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 border-[#121218] ${dotColor}`}
                        />
                        <div className="text-[10px] font-mono text-zinc-400 flex items-center justify-between">
                          <span>{item.time}</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">
                            {item.category}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-white mt-0.5 flex items-center gap-1.5">
                          {isWorkout && <Dumbbell className="h-3 w-3 text-rose-400" />}
                          {isSchool && <GraduationCap className="h-3 w-3 text-cyan-400" />}
                          <span className={item.is_completed ? 'line-through text-zinc-400' : ''}>{item.title}</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Locations Checkpoints */}
                  {locations.map((loc, idx) => (
                    <div key={`loc-${idx}`} className="relative">
                      <div className="absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full bg-blue-500 border-2 border-[#121218]" />
                      <div className="text-[10px] font-mono text-blue-400">{loc.time}</div>
                      <div className="text-xs font-medium text-zinc-200 flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3 text-blue-400" />
                        <span>{loc.name}</span>
                      </div>
                    </div>
                  ))}

                  {/* Sleep Timestamp if available */}
                  {biometrics && biometrics.sleep_time && biometrics.sleep_time !== 'No data' && (
                    <div className="relative">
                      <div className="absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full bg-indigo-500 border-2 border-[#121218]" />
                      <div className="text-[10px] font-mono text-indigo-400 font-semibold">{biometrics.sleep_time}</div>
                      <div className="text-xs font-bold text-white">🌙 In Bed / Sleep</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
