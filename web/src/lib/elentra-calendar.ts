import {
  DEFAULT_TIMEZONE,
  getTodayDateStr,
  addDaysToDateStr,
  getTimezoneOffsetStr,
  parseTimeToHoursMinutes,
  format24hTo12h,
} from '@/lib/date-utils';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import type { BusyInterval } from '@/lib/ai-rollover-scheduler';

export const DEFAULT_ELENTRA_ICAL_URL =
  process.env.ELENTRA_ICAL_URL ||
  'https://elentra.schulich.uwo.ca/calendars/private-75254bda7546b960cf7cafa6c97f213b/knguy69.ics';

export const SYSTEM_ELENTRA_CLASSES_UID = '__system_elentra_timed_classes__';

export interface ElentraBusyEvent extends BusyInterval {
  uid: string;
  startIso: string;
  endIso: string;
  location?: string;
}

const MEMORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes in warm memory
const DB_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours in Supabase
const ELENTRA_FETCH_TIMEOUT_MS = 20_000;    // Schulich Elentra takes ~6s to generate 1,000+ VEVENTs

let cachedByDate: Map<string, ElentraBusyEvent[]> | null = null;
let cachedAtMs = 0;
let inFlightFetch: Promise<Map<string, ElentraBusyEvent[]>> | null = null;

function unescapeIcalText(val?: string): string {
  if (!val) return '';
  return val
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\n/gi, '\n')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcalTimedDate(propKey: string, propVal: string): Date | null {
  const val = propVal.trim();
  // All-day YYYYMMDD dates are unscheduled module/due markers, NOT timed busy classes
  if (propKey.includes('VALUE=DATE') && !propKey.includes('VALUE=DATE-TIME')) {
    return null;
  }
  const match = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const min = parseInt(match[5], 10);
  const sec = parseInt(match[6], 10);
  const isUtc = Boolean(match[7]);

  if (isUtc) {
    return new Date(Date.UTC(year, month - 1, day, hour, min, sec));
  }

  const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
  const timeStr = `${match[4]}:${match[5]}:${match[6]}`;
  const tzOffset = getTimezoneOffsetStr(dateStr, DEFAULT_TIMEZONE);
  return new Date(`${dateStr}T${timeStr}${tzOffset}`);
}

function parseElentraIcs(rawIcs: string): Map<string, ElentraBusyEvent[]> {
  const byDate = new Map<string, ElentraBusyEvent[]>();
  const normalized = rawIcs.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const blocks = normalized.split('BEGIN:VEVENT').slice(1);

  for (const block of blocks) {
    const endIdx = block.indexOf('END:VEVENT');
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
    const props = new Map<string, { key: string; value: string }>();

    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx <= 0) continue;
      const fullKey = line.slice(0, colonIdx);
      const baseKey = fullKey.split(';')[0].toUpperCase();
      const value = line.slice(colonIdx + 1);
      props.set(baseKey, { key: fullKey, value });
    }

    const dtStartProp = props.get('DTSTART');
    const dtEndProp = props.get('DTEND');
    if (!dtStartProp || !dtEndProp) continue;

    const startDate = parseIcalTimedDate(dtStartProp.key, dtStartProp.value);
    const endDate = parseIcalTimedDate(dtEndProp.key, dtEndProp.value);
    if (!startDate || !endDate) continue;

    const durationMins = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    // Ignore invalid, sub-5m, or multi-day (>12h) assessment window banners
    if (durationMins < 5 || durationMins > 12 * 60) continue;

    const summary = unescapeIcalText(props.get('SUMMARY')?.value);
    if (!summary) continue;

    // Never treat self-paced online modules (e.g. "(57 min) ...") as immovable live class blocks
    if (/^(?:FLAG\s*)?\(\s*\d+\s*mins?\s*\)/i.test(summary)) continue;

    const dateStr = startDate.toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
    const startTime12h = startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: DEFAULT_TIMEZONE,
    });
    const parsedStart = parseTimeToHoursMinutes(startTime12h);
    const startMins = parsedStart.hours * 60 + parsedStart.minutes;
    const endMins = Math.min(24 * 60, startMins + durationMins);

    // Ignore midnight release/quiz placeholders (e.g. 12:00 AM - 1:00 AM EST) outside waking hours
    if (endMins <= 6 * 60) continue;

    const endH = Math.floor((endMins % 1440) / 60);
    const endM = endMins % 60;
    const endTime12h = format24hTo12h(endH, endM);

    const tzOffset = getTimezoneOffsetStr(dateStr, DEFAULT_TIMEZONE);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startH = Math.floor(startMins / 60);
    const startM = startMins % 60;
    const endHourClamped = Math.floor(endMins / 60);
    const endMinClamped = endMins % 60;
    const startIso = `${dateStr}T${pad(startH)}:${pad(startM)}:00${tzOffset}`;
    const endIso =
      endMins >= 24 * 60
        ? `${dateStr}T23:59:00${tzOffset}`
        : `${dateStr}T${pad(endHourClamped)}:${pad(endMinClamped)}:00${tzOffset}`;

    const uid = props.get('UID')?.value || `${summary}-${startDate.toISOString()}`;
    const entry: ElentraBusyEvent = {
      uid,
      id: `elentra-${uid}`,
      title: summary,
      calendar: 'School',
      startMins,
      endMins,
      startTime12h,
      endTime12h,
      startIso,
      endIso,
      location: unescapeIcalText(props.get('LOCATION')?.value) || undefined,
    };

    const list = byDate.get(dateStr) || [];
    list.push(entry);
    byDate.set(dateStr, list);
  }

  for (const list of byDate.values()) {
    list.sort((a, b) => a.startMins - b.startMins);
  }

  return byDate;
}

async function persistElentraCacheToDb(byDate: Map<string, ElentraBusyEvent[]>): Promise<void> {
  const sb = supabaseAdmin || supabase;
  if (!sb) return;
  try {
    const todayStr = getTodayDateStr();
    const minDate = addDaysToDateStr(todayStr, -7);
    const maxDate = addDaysToDateStr(todayStr, 45);
    const compact: Record<string, ElentraBusyEvent[]> = {};
    for (const [dStr, list] of byDate.entries()) {
      if (dStr >= minDate && dStr <= maxDate) {
        compact[dStr] = list;
      }
    }
    const payload = JSON.stringify({
      fetchedAtMs: Date.now(),
      byDate: compact,
    });
    await sb.from('school_items').upsert({
      uid: SYSTEM_ELENTRA_CLASSES_UID,
      title: 'System Elentra Timed Classes Cache',
      category: 'system',
      is_completed: false,
      is_scheduled: false,
      target_calendar: payload,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not persist Elentra class cache to Supabase:', err);
  }
}

async function loadElentraCacheFromDb(): Promise<{
  byDate: Map<string, ElentraBusyEvent[]>;
  isFresh: boolean;
} | null> {
  const sb = supabaseAdmin || supabase;
  if (!sb) return null;
  try {
    const { data } = await sb
      .from('school_items')
      .select('target_calendar')
      .eq('uid', SYSTEM_ELENTRA_CLASSES_UID)
      .maybeSingle();

    if (!data?.target_calendar) return null;
    const parsed = JSON.parse(data.target_calendar) as {
      fetchedAtMs?: number;
      byDate?: Record<string, ElentraBusyEvent[]>;
    };
    if (!parsed?.byDate || typeof parsed.byDate !== 'object') return null;

    const map = new Map<string, ElentraBusyEvent[]>(Object.entries(parsed.byDate));
    const isFresh =
      typeof parsed.fetchedAtMs === 'number' && Date.now() - parsed.fetchedAtMs < DB_CACHE_TTL_MS;
    return { byDate: map, isFresh };
  } catch {
    return null;
  }
}

/**
 * Updates both the in-memory and Supabase class caches from raw Elentra ICS text.
 */
export async function warmElentraBusyCacheFromRawIcs(
  rawText: string
): Promise<Map<string, ElentraBusyEvent[]>> {
  const parsed = parseElentraIcs(rawText);
  cachedByDate = parsed;
  cachedAtMs = Date.now();
  await persistElentraCacheToDb(parsed);
  return parsed;
}

async function fetchAndCacheElentraMap(): Promise<Map<string, ElentraBusyEvent[]>> {
  const now = Date.now();
  if (cachedByDate && now - cachedAtMs < MEMORY_CACHE_TTL_MS) {
    return cachedByDate;
  }

  if (inFlightFetch) {
    return inFlightFetch;
  }

  inFlightFetch = (async () => {
    const dbCache = await loadElentraCacheFromDb();
    if (dbCache?.isFresh) {
      cachedByDate = dbCache.byDate;
      cachedAtMs = Date.now();
      return dbCache.byDate;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ELENTRA_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(DEFAULT_ELENTRA_ICAL_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KevinOS/2.0',
        },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Elentra ICS HTTP ${res.status}`);
      }
      const rawText = await res.text();
      return await warmElentraBusyCacheFromRawIcs(rawText);
    } catch (err) {
      console.warn('Failed to fetch Elentra iCal schedule for AI busy blocks:', err);
      if (dbCache?.byDate) {
        cachedByDate = dbCache.byDate;
        cachedAtMs = Date.now();
        return dbCache.byDate;
      }
      return cachedByDate || new Map<string, ElentraBusyEvent[]>();
    } finally {
      clearTimeout(timer);
      inFlightFetch = null;
    }
  })();

  return inFlightFetch;
}

/**
 * Returns timed daytime/evening classes from Kevin's subscribed Schulich Elentra iCal feed
 * for the requested YYYY-MM-DD date(s), ready for AI busy-block conflict avoidance.
 */
export async function getElentraBusyBlocksForDate(
  targetDate: string
): Promise<ElentraBusyEvent[]> {
  if (!targetDate) return [];
  const byDate = await fetchAndCacheElentraMap();
  return [...(byDate.get(targetDate) || [])];
}
