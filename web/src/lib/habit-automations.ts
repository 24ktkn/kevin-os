import { supabase, supabaseAdmin } from '@/lib/supabase';
import { mirrorHabitToSheets } from '@/lib/google-sheets';

export interface OsAutomationSettings {
  wake_cutoff_time: string; // HH:MM 24h ET, default '06:00'
  gym_min_duration_mins: number;
  gym_min_calories: number;
  ntfy_topic: string;
  ntfy_server: string;
  morning_brief_enabled: boolean;
  exam_taper_days: number;
}

export const DEFAULT_OS_SETTINGS: OsAutomationSettings = {
  wake_cutoff_time: '06:00',
  gym_min_duration_mins: 20,
  gym_min_calories: 150,
  ntfy_topic: process.env.NTFY_TOPIC?.trim() || '',
  ntfy_server: process.env.NTFY_SERVER?.trim() || 'https://ntfy.sh',
  morning_brief_enabled: true,
  exam_taper_days: 7,
};

export async function getOsSettings(): Promise<OsAutomationSettings> {
  const sb = supabaseAdmin || supabase;
  if (!sb) return { ...DEFAULT_OS_SETTINGS };
  try {
    const { data, error } = await sb
      .from('os_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_OS_SETTINGS };
    return {
      wake_cutoff_time: String(data.wake_cutoff_time || DEFAULT_OS_SETTINGS.wake_cutoff_time),
      gym_min_duration_mins:
        Number(data.gym_min_duration_mins) || DEFAULT_OS_SETTINGS.gym_min_duration_mins,
      gym_min_calories: Number(data.gym_min_calories) || DEFAULT_OS_SETTINGS.gym_min_calories,
      ntfy_topic: String(data.ntfy_topic || DEFAULT_OS_SETTINGS.ntfy_topic).trim(),
      ntfy_server: String(data.ntfy_server || DEFAULT_OS_SETTINGS.ntfy_server).trim(),
      morning_brief_enabled:
        typeof data.morning_brief_enabled === 'boolean' ? data.morning_brief_enabled : true,
      exam_taper_days: Math.max(1, Math.min(21, Number(data.exam_taper_days) || 7)),
    };
  } catch {
    return { ...DEFAULT_OS_SETTINGS };
  }
}

export function parseClockToMins(timeStr?: string | null): number | null {
  if (!timeStr || timeStr === 'No data') return null;
  const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const mer = m[3]?.toUpperCase();
  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;
  if (isNaN(h) || isNaN(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Evaluates whether a wake time qualifies for "Wake Up On Time".
 * Guarded to >= 3:00 AM so midnight/1 AM mid-sleep timestamps never falsely trigger it.
 */
export function isWakeTimeOnTime(
  wakeTimeStr?: string | null,
  cutoffHHMM = '06:00'
): boolean {
  const wakeMins = parseClockToMins(wakeTimeStr);
  const cutoffMins = parseClockToMins(cutoffHHMM) ?? 6 * 60;
  if (wakeMins === null) return false;
  return wakeMins >= 3 * 60 && wakeMins <= cutoffMins;
}

/**
 * Automatically checks off 'Gym Workout' on every provided YYYY-MM-DD date in Supabase + Google Sheets
 * (called by Hevy CSV import and workout syncs).
 */
export async function autoCheckGymHabitForDates(dates: string[]): Promise<number> {
  const sb = supabaseAdmin || supabase;
  if (!sb || dates.length === 0) return 0;

  const unique = Array.from(
    new Set(dates.map((d) => String(d || '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))
  );
  if (unique.length === 0) return 0;

  const { data: existingRows } = await sb
    .from('habits')
    .select('date, wake_up_on_time, gym_workout, journaling, anki')
    .in('date', unique);

  const existingMap = new Map((existingRows || []).map((r) => [String(r.date).slice(0, 10), r]));
  const nowIso = new Date().toISOString();
  let updatedCount = 0;

  for (const dateStr of unique) {
    const existing = existingMap.get(dateStr);
    if (existing?.gym_workout === true) continue;

    const payload = {
      date: dateStr,
      wake_up_on_time: Boolean(existing?.wake_up_on_time),
      gym_workout: true,
      journaling: Boolean(existing?.journaling),
      anki: Boolean(existing?.anki),
      updated_at: nowIso,
    };

    const { error } = await sb.from('habits').upsert(payload, { onConflict: 'date' });
    if (!error) {
      updatedCount += 1;
      mirrorHabitToSheets(dateStr, 'Gym Workout', true).catch(() => {});
    }
  }

  return updatedCount;
}
