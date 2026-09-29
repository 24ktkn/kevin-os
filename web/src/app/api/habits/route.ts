import { NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const HABITS_LIST = ['Wake Up On Time', 'Gym Workout', 'Journaling'];

// Night owl rollover: if before 2 AM EDT, count as previous day
function getProductivityDate(): { dateStr: string; year: number; month: number; monthName: string } {
  const now = new Date();
  // Get time in EDT (America/New_York)
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
    // subtract 1 day
    const prev = new Date(year, month - 1, day - 1);
    year = prev.getFullYear();
    month = prev.getMonth() + 1;
    day = prev.getDate();
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });

  return { dateStr, year, month, monthName };
}

export async function GET() {
  try {
    const sheets = getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Habits!A1:D1005',
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
      return NextResponse.json({ success: true, habits: [] });
    }

    const headers = rows[0].map((h: string) => String(h).trim());
    const dateIdx = headers.indexOf('Date');
    const wakeIdx = headers.indexOf('Wake Up On Time');
    const gymIdx = headers.indexOf('Gym Workout');
    const journalIdx = headers.indexOf('Journaling');

    const habitColMap: Record<string, number> = {
      'Wake Up On Time': wakeIdx,
      'Gym Workout': gymIdx,
      'Journaling': journalIdx,
    };

    const { dateStr: todayStr, year, month, monthName } = getProductivityDate();

    // Parse all rows
    const dataRows = rows.slice(1).filter((r) => r[dateIdx] && String(r[dateIdx]).trim() !== '');

    // Check if today exists, if not create/append
    let todayRow = dataRows.find((r) => String(r[dateIdx]).trim() === todayStr);
    if (!todayRow) {
      const newRow = [todayStr, 'FALSE', 'FALSE', 'FALSE'];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Habits!A:D',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
      dataRows.push(newRow);
      todayRow = newRow;
    }

    // Cross-tab automation: If today's Gym Workout is FALSE, check if a workout was completed today in tasks
    if (supabase && todayRow && String(todayRow[gymIdx] || '').trim().toUpperCase() !== 'TRUE') {
      try {
        const { data: gymTasks } = await supabase
          .from('tasks')
          .select('id')
          .eq('due_date', todayStr)
          .eq('is_completed', true);

        const hasCompletedWorkout = (gymTasks || []).some(() => true);
        if (hasCompletedWorkout) {
          todayRow[gymIdx] = 'TRUE';
          const rowIndex = rows.findIndex((r) => String(r[dateIdx]).trim() === todayStr) + 1;
          if (rowIndex > 0) {
            const colLetter = String.fromCharCode(65 + gymIdx);
            await sheets.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `Habits!${colLetter}${rowIndex}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [['TRUE']] },
            });
          }
        }
      } catch (gymErr) {
        console.warn('Cross-tab gym habit sync warning:', gymErr);
      }
    }

    // Days in current month
    const daysInMonth = new Date(year, month, 0).getDate();
    // Weekday of 1st day of month (0 = Sun, 1 = Mon, ..., 6 = Sat) -> convert to Mon = 0 .. Sun = 6
    const firstDayWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;

    // Build rawHistory dictionary across all dates
    const rawHistory: Record<string, { 'Wake Up On Time': boolean; 'Gym Workout': boolean; 'Journaling': boolean; total: number }> = {};
    for (const row of dataRows) {
      const d = String(row[dateIdx]).trim();
      if (!d) continue;
      const wake = String(row[wakeIdx] || '').trim().toUpperCase() === 'TRUE';
      const gym = String(row[gymIdx] || '').trim().toUpperCase() === 'TRUE';
      const journal = String(row[journalIdx] || '').trim().toUpperCase() === 'TRUE';
      const total = (wake ? 1 : 0) + (gym ? 1 : 0) + (journal ? 1 : 0);
      rawHistory[d] = {
        'Wake Up On Time': wake,
        'Gym Workout': gym,
        'Journaling': journal,
        total,
      };
    }

    // Build 30-Day Completeness Velocity
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

    const habitsData = HABITS_LIST.map((habitName) => {
      const colIdx = habitColMap[habitName];
      let streak = 0;
      let totalDays = 0;
      let totalCompleted = 0;

      const completionMap: Record<string, boolean> = {};

      for (const row of dataRows) {
        const d = String(row[dateIdx]).trim();
        const val = String(row[colIdx] || '').trim().toUpperCase();
        const isDone = val === 'TRUE';
        completionMap[d] = isDone;

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
            continue;
          }
          break;
        }
      }

      const consistencyRate = totalDays > 0 ? Math.round((totalCompleted / totalDays) * 100) : 0;
      const completedToday = Boolean(todayRow && String(todayRow[colIdx] || '').trim().toUpperCase() === 'TRUE');

      // Build days array for current month
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

    const { dateStr: todayStr } = getProductivityDate();
    const sheets = getGoogleSheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Habits!A1:D1005',
    });

    const rows = res.data.values || [];
    if (rows.length < 1) {
      return NextResponse.json({ error: 'Habits sheet is empty' }, { status: 500 });
    }

    const headers = rows[0].map((h: string) => String(h).trim());
    const dateIdx = headers.indexOf('Date');
    const colIdx = headers.indexOf(habit);

    if (colIdx === -1) {
      return NextResponse.json({ error: `Habit column '${habit}' not found` }, { status: 404 });
    }

    // Convert colIdx to letter: 0=A, 1=B, 2=C, 3=D
    const colLetter = String.fromCharCode(65 + colIdx);

    // Find row index (1-based for Sheets API)
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][dateIdx]).trim() === todayStr) {
        rowIndex = i + 1; // 1-indexed
        break;
      }
    }

    const valToSet = completed ? 'TRUE' : 'FALSE';

    if (rowIndex !== -1) {
      // Update cell
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Habits!${colLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[valToSet]] },
      });
    } else {
      // Append new row for today
      const newRow = [todayStr, 'FALSE', 'FALSE', 'FALSE'];
      newRow[colIdx] = valToSet;
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Habits!A:D',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
    }

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
