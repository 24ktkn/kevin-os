/**
 * Centralized Date, Time, Timezone, and Title Matching Utilities for Kevin-OS
 */

export const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Returns today's calendar date string (YYYY-MM-DD) in America/New_York timezone.
 */
export function getTodayDateStr(timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Returns the productivity date string (YYYY-MM-DD) in America/New_York with 2:00 AM Night Owl rollover.
 * Between 12:00 AM and 1:59 AM Eastern Time, returns yesterday's date.
 */
export function getProductivityDateStr(timeZone = DEFAULT_TIMEZONE): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const findPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const year = parseInt(findPart('year'), 10);
  const month = parseInt(findPart('month'), 10);
  const day = parseInt(findPart('day'), 10);
  const hour = parseInt(findPart('hour'), 10) % 24;

  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${year}-${pad(month)}-${pad(day)}`;

  if (hour < 2) {
    return addDaysToDateStr(todayStr, -1);
  }
  return todayStr;
}

/**
 * Parses a custom date string or current date into YYYY-MM-DD in America/New_York.
 */
export function getCalendarDateString(customDate?: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  if (typeof customDate === 'string' && customDate) {
    const trimmed = customDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const prefixMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (prefixMatch && !trimmed.endsWith('Z')) return prefixMatch[1];
  }
  const baseDate =
    customDate instanceof Date ? customDate : customDate ? new Date(customDate) : new Date();
  const validDate = isNaN(baseDate.getTime()) ? new Date() : baseDate;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(validDate);
}

/**
 * Safely adds (or subtracts) calendar days to a YYYY-MM-DD string without timezone drift.
 */
export function addDaysToDateStr(dateStr: string, daysToAdd: number): string {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dateStr;
  const utc = new Date(Date.UTC(y, m - 1, d + daysToAdd, 12, 0, 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

/**
 * Dynamically returns the ISO timezone offset (e.g. "-04:00" for EDT or "-05:00" for EST)
 * for a given YYYY-MM-DD date in America/New_York.
 */
export function getTimezoneOffsetStr(dateStr?: string, timeZone = DEFAULT_TIMEZONE): string {
  try {
    const refDate =
      dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? new Date(`${dateStr}T12:00:00Z`)
        : new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(refDate);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    const match = tzPart.match(/GMT([+-]\d{2}:\d{2})/);
    if (match) return match[1];
  } catch {
    // fallback below
  }
  return '-04:00';
}

/**
 * Parses a 12-hour ("2:30 PM") or 24-hour ("14:30") time string into 24-hour { hours, minutes }.
 */
export function parseTimeToHoursMinutes(timeStr?: string): { hours: number; minutes: number } {
  if (!timeStr || !timeStr.trim()) return { hours: 10, minutes: 0 };
  const cleaned = timeStr.trim();
  const isPM = /pm/i.test(cleaned);
  const isAM = /am/i.test(cleaned);
  const parts = cleaned
    .replace(/[^0-9:]/g, '')
    .split(':')
    .map((p) => parseInt(p, 10));

  let hours = isNaN(parts[0]) ? 10 : parts[0];
  const minutes = isNaN(parts[1]) ? 0 : parts[1];

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return { hours: Math.max(0, Math.min(23, hours)), minutes: Math.max(0, Math.min(59, minutes)) };
}

/**
 * Formats 24-hour { hours, minutes } into "10:30 AM" / "2:15 PM".
 */
export function format24hTo12h(hours24: number, minutes: number): string {
  const normalizedH = ((hours24 % 24) + 24) % 24;
  const ampm = normalizedH >= 12 ? 'PM' : 'AM';
  const h12 = normalizedH % 12 || 12;
  return `${h12}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/**
 * Computes start and end ISO strings (with dynamic EDT/EST offset and midnight rollover support)
 * for Google Calendar API events.
 */
export function computeStartEndIso(
  dateStr: string,
  timeStr: string,
  durationMins = 60,
  timeZone = DEFAULT_TIMEZONE
): {
  startIso: string;
  endIso: string;
  startDateTime: string;
  endDateTime: string;
  endTime12h: string;
} {
  const { hours, minutes } = parseTimeToHoursMinutes(timeStr);
  const safeDuration = Math.max(5, durationMins || 60);
  const startTotalMins = hours * 60 + minutes;
  const endTotalMins = startTotalMins + safeDuration;

  const daysOverflow = Math.floor(endTotalMins / 1440);
  const endDateStr = daysOverflow > 0 ? addDaysToDateStr(dateStr, daysOverflow) : dateStr;

  const endHours = Math.floor((endTotalMins % 1440) / 60);
  const endMinutes = endTotalMins % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const startIso = `${dateStr}T${pad(hours)}:${pad(minutes)}:00`;
  const endIso = `${endDateStr}T${pad(endHours)}:${pad(endMinutes)}:00`;

  const startOffset = getTimezoneOffsetStr(dateStr, timeZone);
  const endOffset = getTimezoneOffsetStr(endDateStr, timeZone);

  return {
    startIso,
    endIso,
    startDateTime: `${startIso}${startOffset}`,
    endDateTime: `${endIso}${endOffset}`,
    endTime12h: format24hTo12h(endHours, endMinutes),
  };
}

/**
 * Checks if a calendar event summary represents a Task timeblock
 * (e.g. "🎓 [Task] ...", "☑️ [Task] ...", or "[Task] ...").
 * Task timeblocks should only complete when the task is checked off, and roll over to today if incomplete.
 */
export function isTaskEventTitle(title?: string): boolean {
  if (!title) return false;
  const trimmed = title.trim();
  return /^(?:[🎓☑️📚📝⏰]\s*)*\[Task\]/i.test(trimmed);
}

/**
 * Cleans a task or event title for UI display (removes leading task prefixes/emojis while preserving case).
 */
export function cleanDisplayTitle(str?: string): string {
  if (!str) return '';
  return str
    .replace(/\\,/g, ',')
    .replace(/\\/g, '')
    .replace(/^(?:[🎓📚📝⏰☑️\s]+|\[Task\]\s*|Task:\s*)+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cleans and normalizes a task/event/school title for cross-table matching (lowercase, no prefixes or duration tags).
 */
export function cleanTaskTitle(str?: string): string {
  if (!str) return '';
  return cleanDisplayTitle(str)
    .replace(/^\(\s*\d+\s*(?:mins?|minutes?|hours?|hrs?)\s*\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Symmetric fuzzy title matching between two task/event/school item titles.
 * Requires both normalized strings to be > 5 chars before allowing substring inclusion.
 */
export function titlesMatch(a?: string, b?: string): boolean {
  const normA = cleanTaskTitle(a);
  const normB = cleanTaskTitle(b);

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  if (normA.length > 5 && normB.length > 5) {
    if (normA.includes(normB) || normB.includes(normA)) return true;
  }

  return false;
}

/**
 * Checks whether a standalone event with a given due_date and due_time has already ended in the past.
 * Uses Eastern Time (EDT/EST, America/New_York) with hourCycle: 'h23' to avoid the midnight "24" hour bug.
 */
export function isEventPast(
  dueDate?: string,
  dueTime?: string,
  durationMins = 60
): boolean {
  if (!dueDate || !dueDate.trim()) return false;

  const now = new Date();
  const todayStr = getTodayDateStr();
  const cleanDueDate = dueDate.trim();

  if (cleanDueDate < todayStr) return true;
  if (cleanDueDate > todayStr) return false;

  // All-day event scheduled for today does not pass until the day ends
  if (!dueTime || !dueTime.trim()) return false;

  try {
    const { hours, minutes } = parseTimeToHoursMinutes(dueTime);

    const timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const curHours = parseInt(timeParts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
    const curMinutes = parseInt(timeParts.find((p) => p.type === 'minute')?.value || '0', 10);

    const eventEndTotalMinutes = hours * 60 + minutes + (durationMins || 60);
    const curTotalMinutes = curHours * 60 + curMinutes;

    return eventEndTotalMinutes <= curTotalMinutes;
  } catch {
    return false;
  }
}

/**
 * Unified sleep duration parser supporting "Xh Ym", "HH:MM", decimal hours, minutes (>24), and seconds (>1440).
 */
export function parseSleepDuration(val: unknown): { text: string; hours: number } {
  if (val === undefined || val === null || val === '') {
    return { text: '0h 0m', hours: 0 };
  }

  const str = String(val).trim();
  if (!str || str === '0' || str === '0h 0m') {
    return { text: '0h 0m', hours: 0 };
  }

  // Format 1: "7h 14m" or "7 hr 14 min"
  if (str.includes('h') || str.includes('m')) {
    const hMatch = str.match(/(\d+(?:\.\d+)?)\s*h/i);
    const mMatch = str.match(/(\d+(?:\.\d+)?)\s*m/i);
    const h = hMatch ? parseFloat(hMatch[1]) : 0;
    const m = mMatch ? parseFloat(mMatch[1]) : 0;
    const totalHours = Math.round((h + m / 60) * 10) / 10;
    const wholeH = Math.floor(h + m / 60);
    const remM = Math.round(((h + m / 60) - wholeH) * 60);
    return {
      text: `${wholeH}h ${remM}m`,
      hours: totalHours,
    };
  }

  // Format 2: "HH:MM" or "HH:MM:SS"
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => parseFloat(p) || 0);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const totalHours = Math.round((h + m / 60) * 10) / 10;
    return {
      text: `${Math.floor(h)}h ${Math.round(m)}m`,
      hours: totalHours,
    };
  }

  // Format 3: Numeric (hours, minutes if > 24, or seconds if > 1440)
  const num = parseFloat(str);
  if (!isNaN(num) && num > 0) {
    let totalHours = num;
    if (num > 1440) {
      totalHours = num / 3600;
    } else if (num > 24) {
      totalHours = num / 60;
    }
    const wholeH = Math.floor(totalHours);
    const remM = Math.round((totalHours - wholeH) * 60);
    return {
      text: `${wholeH}h ${remM}m`,
      hours: Math.round(totalHours * 10) / 10,
    };
  }

  return { text: str, hours: 0 };
}

/**
 * Formats an ISO timestamp or time string into 12-hour Eastern Time (e.g. "07:15 AM").
 */
export function formatDisplayTime(str: unknown, fallback = 'No data'): string {
  if (!str) return fallback;
  const s = String(str).trim();
  if (!s || s.toLowerCase() === 'no data') return fallback;

  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s)) {
    return s.toUpperCase();
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  }

  return s;
}
