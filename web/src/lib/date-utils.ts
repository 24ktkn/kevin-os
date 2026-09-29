/**
 * Date and time utilities for Kevin-OS
 */

/**
 * Checks whether an event with a given due_date and due_time has already ended in the past.
 * Uses Eastern Time (EDT/EST, America/New_York).
 */
export function isEventPast(
  dueDate?: string,
  dueTime?: string,
  durationMins = 60
): boolean {
  if (!dueDate || !dueDate.trim()) return false;

  const now = new Date();

  // Get current date string in America/New_York (YYYY-MM-DD)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now);

  const cleanDueDate = dueDate.trim();

  // If date is before today, it has already passed
  if (cleanDueDate < todayStr) {
    return true;
  }

  // If date is after today, it hasn't passed
  if (cleanDueDate > todayStr) {
    return false;
  }

  // The event is scheduled for today!
  // If no time is specified (all-day event), it does not pass until the day ends
  if (!dueTime || !dueTime.trim()) {
    return false;
  }

  try {
    const timeStr = dueTime.trim().toLowerCase();
    const isPM = timeStr.includes('pm');
    const isAM = timeStr.includes('am');
    const clean = timeStr.replace(/(am|pm)/gi, '').trim();
    const parts = clean.split(':').map((p) => parseInt(p, 10));

    let hours = parts[0] || 0;
    const minutes = parts[1] || 0;

    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    // Get current time in EDT
    const timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);

    const curHours = parseInt(timeParts.find((p) => p.type === 'hour')?.value || '0', 10);
    const curMinutes = parseInt(timeParts.find((p) => p.type === 'minute')?.value || '0', 10);

    const eventEndTotalMinutes = hours * 60 + minutes + (durationMins || 60);
    const curTotalMinutes = curHours * 60 + curMinutes;

    return eventEndTotalMinutes <= curTotalMinutes;
  } catch {
    return false;
  }
}
