import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function getProductivityDateString(tz = 'America/New_York'): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'America/New_York',
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

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function mirrorJournalToSheets(targetDate: string, entryText: string, photosArr: string[]) {
  try {
    const sheets = getGoogleSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'journal_entries!A1:C500',
    });

    const rows = res.data.values || [];
    let headers: string[] = [];
    if (rows.length > 0) {
      headers = rows[0].map((h: string) => String(h).trim());
    } else {
      headers = ['Date', 'Entry', 'Photos'];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'journal_entries!A:C',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] },
      });
      rows.push(headers);
    }

    const dateIdx = headers.indexOf('Date');
    let rowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][dateIdx] || '').trim() === targetDate) {
        rowIndex = i + 1;
        break;
      }
    }

    const photosJson = JSON.stringify(photosArr);
    const newRow = [targetDate, entryText, photosJson];

    if (rowIndex !== -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `journal_entries!A${rowIndex}:C${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'journal_entries!A:C',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
    }
  } catch (err) {
    console.warn('mirrorJournalToSheets warning (non-fatal):', err);
  }
}

async function mirrorJournalingHabitToSheets(targetDate: string) {
  try {
    const sheets = getGoogleSheetsClient();
    const habitsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Habits!A1:D1005',
    });
    const hRows = habitsRes.data.values || [];
    if (hRows.length > 0) {
      const hHeaders = hRows[0].map((h: string) => String(h).trim());
      const hDateIdx = hHeaders.indexOf('Date');
      const hJournalIdx = hHeaders.indexOf('Journaling');

      if (hJournalIdx !== -1) {
        const colLetter = String.fromCharCode(65 + hJournalIdx);
        let hRowIndex = -1;
        for (let j = 1; j < hRows.length; j++) {
          if (String(hRows[j][hDateIdx] || '').trim() === targetDate) {
            hRowIndex = j + 1;
            break;
          }
        }

        if (hRowIndex !== -1) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Habits!${colLetter}${hRowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['TRUE']] },
          });
        }
      }
    }
  } catch (habitSyncErr) {
    console.warn('mirrorJournalingHabitToSheets warning:', habitSyncErr);
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date')?.trim() || getProductivityDateString();

    let existingEntry = '';
    let photosList: string[] = [];

    // 1. Primary: Fetch Journal Entry from Supabase (sub-20ms)
    const sb = supabaseAdmin || supabase;
    if (sb) {
      try {
        const { data, error } = await sb
          .from('journal_entries')
          .select('entry, photos')
          .eq('date', dateParam)
          .maybeSingle();

        if (!error && data) {
          existingEntry = data.entry || '';
          if (Array.isArray(data.photos)) {
            photosList = data.photos;
          } else if (typeof data.photos === 'string') {
            try {
              photosList = JSON.parse(data.photos);
            } catch {
              photosList = data.photos.split(',').map((p: string) => p.trim()).filter(Boolean);
            }
          }
        }
      } catch (sbErr) {
        console.warn('Supabase journal fetch warning:', sbErr);
      }
    }

    // 2. Fallback to Google Sheets if Supabase had no entry
    if (!existingEntry) {
      try {
        const sheets = getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'journal_entries!A1:C500',
        });

        const rows = res.data.values || [];
        if (rows.length > 1) {
          const headers = rows[0].map((h: string) => String(h).trim().toLowerCase());
          const dateIdx = headers.indexOf('date');
          const entryIdx = headers.indexOf('entry');
          const photosIdx = headers.indexOf('photos');

          for (let i = rows.length - 1; i >= 1; i--) {
            const rowDate = String(rows[i][dateIdx] || '').trim();
            if (rowDate === dateParam) {
              existingEntry = String(rows[i][entryIdx] || '');
              const rawPhotos = String(rows[i][photosIdx] || '');
              if (rawPhotos) {
                try {
                  photosList = JSON.parse(rawPhotos);
                } catch {
                  photosList = rawPhotos.split(',').map((p) => p.trim()).filter(Boolean);
                }
              }
              break;
            }
          }
        }
      } catch (jErr) {
        console.warn('journal_entries sheets fallback warning:', jErr);
      }
    }

    // 3. Fetch Location logs for this date from Sheets (if available)
    const locations: Array<{ timestamp: string; time: string; name: string; lat: number; lng: number }> = [];
    try {
      const sheets = getGoogleSheetsClient();
      const locRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'location_log!A1:D1000',
      });
      const locRows = locRes.data.values || [];
      if (locRows.length > 1) {
        const headers = locRows[0].map((h: string) => String(h).trim().toLowerCase());
        const tsIdx = headers.indexOf('timestamp');
        const latIdx = headers.indexOf('latitude');
        const lngIdx = headers.indexOf('longitude');
        const nameIdx = headers.indexOf('location name');

        for (let i = 1; i < locRows.length; i++) {
          const rawTs = String(locRows[i][tsIdx] || '');
          if (rawTs.startsWith(dateParam)) {
            const lat = parseFloat(String(locRows[i][latIdx] || '0'));
            const lng = parseFloat(String(locRows[i][lngIdx] || '0'));
            const locName = String(locRows[i][nameIdx] || 'Location Checkpoint');
            let timeStr = '';
            try {
              timeStr = new Date(rawTs).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              });
            } catch {
              timeStr = rawTs.split('T')[1] || '';
            }

            locations.push({
              timestamp: rawTs,
              time: timeStr,
              name: locName.split(',')[0],
              lat,
              lng,
            });
          }
        }
      }
    } catch (locErr) {
      console.warn('location_log fetch warning:', locErr);
    }

    // 4. Synthesize Timeline from Supabase Tasks for this date
    const timelineItems: Array<{
      id: string;
      time: string;
      title: string;
      type: 'event' | 'task' | 'workout' | 'school' | 'location';
      category: string;
      is_completed: boolean;
    }> = [];

    if (sb) {
      const { data: dayTasks } = await sb
        .from('tasks')
        .select('*')
        .eq('due_date', dateParam)
        .order('due_time', { ascending: true });

      if (dayTasks) {
        for (const t of dayTasks) {
          const lower = (t.title || '').toLowerCase();
          const isWorkout = lower.includes('workout') || lower.includes('gym') || lower.includes('soccer');
          const isSchool = t.calendar_name === 'School' || lower.includes('min') || lower.includes('module');

          timelineItems.push({
            id: t.id,
            time: t.due_time || 'All Day',
            title: t.title,
            type: isWorkout ? 'workout' : isSchool ? 'school' : t.type === 'Event' ? 'event' : 'task',
            category: t.calendar_name || 'General',
            is_completed: t.is_completed,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      date: dateParam,
      entry: existingEntry,
      photos: photosList,
      locations,
      timeline: timelineItems,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in journal GET:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, entry, photos } = body;

    const targetDate = date ? String(date).trim() : getProductivityDateString();
    const entryText = typeof entry === 'string' ? entry : '';
    const photosArr = Array.isArray(photos) ? photos : [];

    const sb = supabaseAdmin || supabase;

    // 1. Primary: Save to Supabase (immediate sub-20ms response)
    if (sb) {
      await sb.from('journal_entries').upsert({
        date: targetDate,
        entry: entryText,
        photos: photosArr,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'date' });
    }

    // 2. Background mirror to Google Sheets (non-blocking)
    mirrorJournalToSheets(targetDate, entryText, photosArr).catch((e) => {
      console.warn('Background Sheets journal sync failed:', e);
    });

    // 3. Cross-tab automation: If journal has content (>10 chars), auto-complete "Journaling" in Supabase & Sheets
    if (entryText.trim().length > 10) {
      if (sb) {
        sb.from('habits').upsert({
          date: targetDate,
          journaling: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'date' }).then(() => {});
      }
      mirrorJournalingHabitToSheets(targetDate).catch((e) => {
        console.warn('Background Habits journal sync failed:', e);
      });
    }

    return NextResponse.json({
      success: true,
      date: targetDate,
      saved: true,
      photosCount: photosArr.length,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in journal POST:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
