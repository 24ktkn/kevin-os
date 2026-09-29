import { NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const HABITS_LIST = ['Wake Up On Time', 'Gym Workout', 'Journaling'];

const HABIT_DB_MAP: Record<string, string> = {
  'Wake Up On Time': 'wake_up_on_time',
  'Gym Workout': 'gym_workout',
  'Journaling': 'journaling',
};

// Night owl rollover: if before 2 AM EDT, count as previous day
function getProductivityDate(): { dateStr: string; year: number; month: number; monthName: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const findPart = (t: string) => parts.find((p) => p.type === t)?.value || '';

  let year = parseInt(findPart('year'), 10);
  let month = parseInt(findPart('month'), 10);
  let day = parseInt(findPart('day'), 10);
  const hour = parseInt(findPart('hour'), 10);

  if (hour < 2) {
    const prev = new Date(year, month - 1, day - 1);
    year = prev.getFullYear();
    month = prev.getMonth() + 1;
    day = prev.getDate();
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });

  return { dateStr, year, month, monthName };
}

// Background mirror helper to Google Sheets
async function mirrorHabitToSheets(todayStr: string, habit: string, completed: boolean) {
  try {
    const sheets = getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Habits!A1:D1005',
    });
    const rows = res.data.values || [];
    if (rows.length === 0) return;
    const headers = rows[0].map((h: string) => String(h).trim());
    const dateIdx = headers.indexOf('Date');
    const colIdx = headers.indexOf(habit);
    if (colIdx === -1) return;
    const colLetter = String.fromCharCode(65 + colIdx);

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][dateIdx]).trim() === todayStr) {
        rowIndex = i + 1;
        break;
      }
    }
    const valToSet = completed ? 'TRUE' : 'FALSE';
    if (rowIndex !== -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Habits!${colLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[valToSet]] },
      });
    } else {
      const newRow = [todayStr, 'FALSE', 'FALSE', 'FALSE'];
      newRow[colIdx] = valToSet;
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Habits!A:D',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
    }
  } catch (err) {
    console.warn('mirrorHabitToSheets warning (non-fatal):', err);
  }
}

interface HabitRecord {
  date: string;
  wake_up_on_time: boolean;
  gym_workout: boolean;
  journaling: boolean;
}

export async function GET() {
  try {
    const { dateStr: todayStr, year, month, monthName } = getProductivityDate();
    let records: HabitRecord[] = [];

    // 1. Primary: Load from Supabase (sub-20ms)
    const sb = supabaseAdmin || supabase;
    if (sb) {
      const { data, error } = await sb
        .from('habits')
        .select('date, wake_up_on_time, gym_workout, journaling')
        .order('date', { ascending: true });

      if (!error && data && data.length > 0) {
        records = data.map((r) => ({
          date: String(r.date).trim(),
          wake_up_on_time: Boolean(r.wake_up_on_time),
          gym_workout: Boolean(r.gym_workout),
          journaling: Boolean(r.journaling),
        }));
      }
    }

    // 2. Fallback to Google Sheets if Supabase had no records
    if (records.length === 0) {
      try {
        const sheets = getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Habits!A1:D1005',
        });
        const rows = res.data.values || [];
        if (rows.length > 1) {
          const headers = rows[0].map((h: string) => String(h).trim());
          const dateIdx = headers.indexOf('Date');
          const wakeIdx = headers.indexOf('Wake Up On Time');
          const gymIdx = headers.indexOf('Gym Workout');
          const journalIdx = headers.indexOf('Journaling');

          for (let i = 1; i < rows.length; i++) {
            const d = String(rows[i][dateIdx] || '').trim();
            if (!d) continue;
            records.push({
              date: d,
              wake_up_on_time: String(rows[i][wakeIdx] || '').trim().toUpperCase() === 'TRUE',
              gym_workout: String(rows[i][gymIdx] || '').trim().toUpperCase() === 'TRUE',
              journaling: String(rows[i][journalIdx] || '').trim().toUpperCase() === 'TRUE',
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
      };
      records.push(todayRecord);

      // Async write to Supabase
      if (sb) {
        sb.from('habits').upsert(todayRecord, { onConflict: 'date' }).then(() => {});
      }
      // Async write to Sheets
      mirrorHabitToSheets(todayStr, 'Wake Up On Time', false);
    }

    // 4. Cross-tab automation: If today's Gym Workout is FALSE, check if a workout task was completed in Supabase
    if (sb && !todayRecord.gym_workout) {
      try {
        const { data: gymTasks } = await sb
          .from('tasks')
          .select('id, title')
          .eq('due_date', todayStr)
          .eq('is_completed', true);

        const hasCompletedWorkout = (gymTasks || []).some((t) => {
          const lower = (t.title || '').toLowerCase();
          return lower.includes('workout') || lower.includes('gym') || lower.includes('soccer');
        });

        if (hasCompletedWorkout) {
          todayRecord.gym_workout = true;
          await sb.from('habits').upsert(
            { date: todayStr, gym_workout: true, updated_at: new Date().toISOString() },
            { onConflict: 'date' }
          );
          mirrorHabitToSheets(todayStr, 'Gym Workout', true);
        }
      } catch (gymErr) {
        console.warn('Cross-tab gym habit sync warning:', gymErr);
      }
    }

    // 5. Build rawHistory dictionary across all dates
    const rawHistory: Record<string, { 'Wake Up On Time': boolean; 'Gym Workout': boolean; 'Journaling': boolean; total: number }> = {};
    for (const rec of records) {
      const total = (rec.wake_up_on_time ? 1 : 0) + (rec.gym_workout ? 1 : 0) + (rec.journaling ? 1 : 0);
      rawHistory[rec.date] = {
        'Wake Up On Time': rec.wake_up_on_time,
        'Gym Workout': rec.gym_workout,
        'Journaling': rec.journaling,
        total,
      };
    }

    // 6. Build 30-Day Completeness Velocity
    const velocity30Days: Array<{ date: string; dayLabel: string; wake: boolean; gym: boolean; journal: boolean; total: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - i);
      const dStr = pastDate.toISOString().split('T')[0];
      const rec = rawHistory[dStr] || { 'Wake Up On Time': false, 'Gym Workout': false, 'Journaling': false, total: 0 };
      velocity30Days.push({
        date: dStr,
        dayLabel: pastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        wake: rec['Wake Up On Time'],
        gym: rec['Gym Workout'],
        journal: rec['Journaling'],
        total: rec.total,
      });
    }

    // 7. Days in current month & weekday calculation
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon = 0 ... Sun = 6

    const habitsData = HABITS_LIST.map((habitName) => {
      const dbCol = HABIT_DB_MAP[habitName] as keyof HabitRecord;
      let streak = 0;
      let totalDays = 0;
      let totalCompleted = 0;

      const completionMap: Record<string, boolean> = {};

      for (const rec of records) {
        const isDone = Boolean(rec[dbCol]);
        completionMap[rec.date] = isDone;
        totalDays++;
        if (isDone) totalCompleted++;
      }

      // Calculate streak backwards from today
      const sortedDates = Object.keys(completionMap).sort();
      for (let i = sortedDates.length - 1; i >= 0; i--) {
        const d = sortedDates[i];
        if (completionMap[d]) {
          streak++;
        } else {
          if (d === todayStr) {
            continue; // Today hasn't ended yet
          }
          break;
        }
      }

      const consistencyRate = totalDays > 0 ? Math.round((totalCompleted / totalDays) * 100) : 0;
      const completedToday = Boolean(todayRecord && todayRecord[dbCol]);

      // Build days array for current month grid
      const days = [];
      for (let i = 0; i < firstDayWeekday; i++) {
        days.push({ dayNumber: 0, dateStr: '', completed: false, isToday: false, isFuture: false });
      }

      for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        const dStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const isToday = dStr === todayStr;
        const isFuture = dStr > todayStr;
        const completed = Boolean(completionMap[dStr]);

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
        icon: habitName.includes('Wake') ? '⏰' : habitName.includes('Gym') ? '💪' : '✍️',
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
    const { habit, completed } = body;

    if (!habit || typeof completed !== 'boolean') {
      return NextResponse.json({ error: 'Missing habit name or completed boolean' }, { status: 400 });
    }

    const dbCol = HABIT_DB_MAP[habit];
    if (!dbCol) {
      return NextResponse.json({ error: `Unknown habit '${habit}'` }, { status: 400 });
    }

    const { dateStr: todayStr } = getProductivityDate();

    // 1. Primary: Save to Supabase (immediate sub-20ms response)
    const sb = supabaseAdmin || supabase;
    if (sb) {
      const { data: existing } = await sb.from('habits').select('*').eq('date', todayStr).single();
      if (existing) {
        await sb.from('habits').update({
          [dbCol]: completed,
          updated_at: new Date().toISOString(),
        }).eq('date', todayStr);
      } else {
        await sb.from('habits').insert({
          date: todayStr,
          wake_up_on_time: false,
          gym_workout: false,
          journaling: false,
          [dbCol]: completed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    // 2. Background mirror to Google Sheets (non-blocking)
    mirrorHabitToSheets(todayStr, habit, completed).catch((e) => {
      console.warn('Background Sheets sync failed:', e);
    });

    return NextResponse.json({
      success: true,
      habit,
      completed,
      date: todayStr,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in habits POST:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
