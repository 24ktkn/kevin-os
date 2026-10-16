import { NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID, mirrorHabitToSheets } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getProductivityDateStr, addDaysToDateStr } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

const HABITS_LIST = ['Wake Up On Time', 'Gym Workout', 'Journaling', 'Anki'] as const;
type HabitName = (typeof HABITS_LIST)[number];

const HABIT_DB_MAP: Record<string, keyof Omit<HabitRecord, 'date'>> = {
  'Wake Up On Time': 'wake_up_on_time',
  'Gym Workout': 'gym_workout',
  'Journaling': 'journaling',
  'Anki': 'anki',
};

interface HabitRecord {
  date: string;
  wake_up_on_time: boolean;
  gym_workout: boolean;
  journaling: boolean;
  anki: boolean;
}

export async function GET() {
  try {
    const todayStr = getProductivityDateStr();
    const [year, month] = todayStr.split('-').map(Number);
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });
    let records: HabitRecord[] = [];

    // 1. Primary: Load from Supabase (sub-20ms)
    const sb = supabaseAdmin || supabase;
    if (sb) {
      let { data, error } = await sb
        .from('habits')
        .select('date, wake_up_on_time, gym_workout, journaling, anki')
        .order('date', { ascending: true });

      if (error && (error.code === '42703' || error.message?.includes('anki'))) {
        const fallback = await sb
          .from('habits')
          .select('date, wake_up_on_time, gym_workout, journaling')
          .order('date', { ascending: true });
        if (!fallback.error && fallback.data) {
          data = fallback.data.map((r) => ({ ...r, anki: false }));
          error = null;
        }
      }

      if (!error && data && data.length > 0) {
        records = data.map((r) => ({
          date: String(r.date).trim(),
          wake_up_on_time: Boolean(r.wake_up_on_time),
          gym_workout: Boolean(r.gym_workout),
          journaling: Boolean(r.journaling),
          anki: Boolean(r.anki),
        }));
      }
    }

    // 2. Fallback to Google Sheets if Supabase had no records
    if (records.length === 0) {
      try {
        const sheets = getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Habits!A1:E1005',
        });
        const rows = res.data.values || [];
        if (rows.length > 1) {
          const headers = rows[0].map((h: string) => String(h).trim());
          const dateIdx = headers.indexOf('Date');
          const wakeIdx = headers.indexOf('Wake Up On Time');
          const gymIdx = headers.indexOf('Gym Workout');
          const journalIdx = headers.indexOf('Journaling');
          const ankiIdx = headers.indexOf('Anki');

          for (let i = 1; i < rows.length; i++) {
            const d = String(rows[i][dateIdx] || '').trim();
            if (!d) continue;
            records.push({
              date: d,
              wake_up_on_time: String(rows[i][wakeIdx] || '').trim().toUpperCase() === 'TRUE',
              gym_workout: String(rows[i][gymIdx] || '').trim().toUpperCase() === 'TRUE',
              journaling: String(rows[i][journalIdx] || '').trim().toUpperCase() === 'TRUE',
              anki: ankiIdx !== -1 && String(rows[i][ankiIdx] || '').trim().toUpperCase() === 'TRUE',
            });
          }
        }
      } catch (sheetsErr) {
        console.warn('Fallback to Sheets failed in habits GET:', sheetsErr);
      }
    }

    // 3. Ensure today's row exists
    let todayRecord = records.find((r) => r.date === todayStr);
    if (!todayRecord) {
      todayRecord = {
        date: todayStr,
        wake_up_on_time: false,
        gym_workout: false,
        journaling: false,
        anki: false,
      };
      records.push(todayRecord);

      if (sb) {
        (async () => {
          const { error: uErr } = await sb.from('habits').upsert(todayRecord, { onConflict: 'date' });
          if (uErr && uErr.code === '42703') {
            const { anki: _omit, ...rest } = todayRecord;
            await sb.from('habits').upsert(rest, { onConflict: 'date' });
          }
        })().catch(() => {});
      }
      mirrorHabitToSheets(todayStr, 'Wake Up On Time', false).catch(() => {});
    }

    // 4. Single-pass build of rawHistory and per-habit completion counts
    const rawHistory: Record<
      string,
      { 'Wake Up On Time': boolean; 'Gym Workout': boolean; 'Journaling': boolean; 'Anki': boolean; total: number }
    > = {};
    const habitTotals: Record<HabitName, number> = {
      'Wake Up On Time': 0,
      'Gym Workout': 0,
      'Journaling': 0,
      'Anki': 0,
    };

    for (const rec of records) {
      const total =
        (rec.wake_up_on_time ? 1 : 0) +
        (rec.gym_workout ? 1 : 0) +
        (rec.journaling ? 1 : 0) +
        (rec.anki ? 1 : 0);
      rawHistory[rec.date] = {
        'Wake Up On Time': rec.wake_up_on_time,
        'Gym Workout': rec.gym_workout,
        'Journaling': rec.journaling,
        'Anki': rec.anki,
        total,
      };
      if (rec.wake_up_on_time) habitTotals['Wake Up On Time']++;
      if (rec.gym_workout) habitTotals['Gym Workout']++;
      if (rec.journaling) habitTotals['Journaling']++;
      if (rec.anki) habitTotals['Anki']++;
    }

    const totalDays = records.length;

    // 5. Build 30-Day Completeness Velocity
    const velocity30Days: Array<{
      date: string;
      dayLabel: string;
      wake: boolean;
      gym: boolean;
      journal: boolean;
      anki: boolean;
      total: number;
    }> = [];
    for (let i = 29; i >= 0; i--) {
      const dStr = addDaysToDateStr(todayStr, -i);
      const dObj = new Date(dStr + 'T12:00:00');
      const rec = rawHistory[dStr] || {
        'Wake Up On Time': false,
        'Gym Workout': false,
        'Journaling': false,
        'Anki': false,
        total: 0,
      };
      velocity30Days.push({
        date: dStr,
        dayLabel: dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }),
        wake: rec['Wake Up On Time'],
        gym: rec['Gym Workout'],
        journal: rec['Journaling'],
        anki: rec['Anki'],
        total: rec.total,
      });
    }

    // 6. Days in current month & weekday calculation
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon = 0 ... Sun = 6

    const habitsData = HABITS_LIST.map((habitName) => {
      const dbCol = HABIT_DB_MAP[habitName];
      const totalCompleted = habitTotals[habitName];

      // Calculate continuous streak backwards day-by-day from today using O(1) rawHistory lookup
      let streak = 0;
      if (rawHistory[todayStr]?.[habitName]) {
        streak++;
      }
      let offset = -1;
      while (true) {
        const checkStr = addDaysToDateStr(todayStr, offset);
        if (rawHistory[checkStr]?.[habitName]) {
          streak++;
          offset--;
        } else {
          break;
        }
      }

      const consistencyRate = totalDays > 0 ? Math.round((totalCompleted / totalDays) * 100) : 0;
      const completedToday = Boolean(todayRecord && todayRecord[dbCol]);

      const days = [];
      for (let i = 0; i < firstDayWeekday; i++) {
        days.push({ dayNumber: 0, dateStr: '', completed: false, isToday: false, isFuture: false });
      }

      for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        const dStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const isToday = dStr === todayStr;
        const isFuture = dStr > todayStr;
        const completed = Boolean(rawHistory[dStr]?.[habitName]);

        days.push({
          dayNumber: dayNum,
          dateStr: dStr,
          completed,
          isToday,
          isFuture,
        });
      }

      return {
        name: habitName,
        icon:
          habitName === 'Anki'
            ? '🎴'
            : habitName.includes('Wake')
              ? '⏰'
              : habitName.includes('Gym')
                ? '💪'
                : '✍️',
        streak,
        consistencyRate,
        totalCompleted,
        totalDays,
        completedToday,
        monthName,
        year,
        days,
      };
    });

    return NextResponse.json({
      success: true,
      today: todayStr,
      habits: habitsData,
      rawHistory,
      velocity30Days,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in habits GET:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { habit, completed, date } = body;

    if (!habit || typeof completed !== 'boolean') {
      return NextResponse.json({ error: 'Missing habit name or completed boolean' }, { status: 400 });
    }

    const dbCol = HABIT_DB_MAP[habit];
    if (!dbCol) {
      return NextResponse.json({ error: `Unknown habit '${habit}'` }, { status: 400 });
    }

    const todayStr = getProductivityDateStr();
    const targetDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())
        ? String(date).trim()
        : todayStr;

    const sb = supabaseAdmin || supabase;
    if (sb) {
      try {
        const { data: existing } = await sb
          .from('habits')
          .select('*')
          .eq('date', targetDate)
          .maybeSingle();

        const nowIso = new Date().toISOString();
        const payload: Record<string, unknown> = {
          date: targetDate,
          wake_up_on_time: existing?.wake_up_on_time ?? false,
          gym_workout: existing?.gym_workout ?? false,
          journaling: existing?.journaling ?? false,
          anki: existing?.anki ?? false,
          [dbCol]: completed,
          updated_at: nowIso,
        };

        if (!existing) {
          payload.created_at = nowIso;
        }

        const { error: uErr } = await sb.from('habits').upsert(payload, { onConflict: 'date' });
        if (uErr && (uErr.code === '42703' || uErr.message?.includes('anki'))) {
          const { anki: _omit, ...fallbackPayload } = payload;
          await sb.from('habits').upsert(fallbackPayload, { onConflict: 'date' });
        }
      } catch (sbErr) {
        console.warn('Supabase habit update warning:', sbErr);
      }
    }

    // Background mirror to Google Sheets (non-blocking)
    mirrorHabitToSheets(targetDate, habit, completed).catch((e) => {
      console.warn('Background Sheets sync failed:', e);
    });

    return NextResponse.json({
      success: true,
      habit,
      completed,
      date: targetDate,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in habits POST:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
