import { NextRequest, NextResponse } from 'next/server';
import { SchoolEvent, SchoolCategory } from '@/types/school';

const DEFAULT_ICAL_URL =
  'https://elentra.schulich.uwo.ca/calendars/private-75254bda7546b960cf7cafa6c97f213b/knguy69.ics';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url') || DEFAULT_ICAL_URL;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KevinOS/2.0',
      },
      next: { revalidate: 300 }, // Cache on edge for 5 minutes
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch calendar: HTTP ${res.status}` },
        { status: res.status }
      );
    }

    const rawText = await res.text();
    const normalized = rawText.replace(/\r\n /g, '').replace(/\n /g, '');
    const lines = normalized.split(/\r?\n/);

    const events: SchoolEvent[] = [];
    let currentEvent: Record<string, string> = {};
    let inEvent = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line === 'BEGIN:VEVENT') {
        inEvent = true;
        currentEvent = {};
      } else if (line === 'END:VEVENT') {
        inEvent = false;
        if (currentEvent['DTSTART']) {
          const val = currentEvent['DTSTART'];
          let isAllDay = false;
          let dateObj: Date;

          if (val.length === 8) {
            isAllDay = true;
            const year = parseInt(val.substring(0, 4), 10);
            const month = parseInt(val.substring(4, 6), 10) - 1;
            const day = parseInt(val.substring(6, 8), 10);
            dateObj = new Date(year, month, day);
          } else if (val.length >= 15) {
            isAllDay = false;
            const cleanVal = val.replace('Z', '');
            const year = parseInt(cleanVal.substring(0, 4), 10);
            const month = parseInt(cleanVal.substring(4, 6), 10) - 1;
            const day = parseInt(cleanVal.substring(6, 8), 10);
            const hours = parseInt(cleanVal.substring(9, 11), 10);
            const mins = parseInt(cleanVal.substring(11, 13), 10);
            const secs = parseInt(cleanVal.substring(13, 15), 10);
            dateObj = new Date(year, month, day, hours, mins, secs);
          } else {
            dateObj = new Date();
          }

          const summary = currentEvent['SUMMARY'] || 'Untitled Event';
          const description = (currentEvent['DESCRIPTION'] || '').replace(/\\n/g, '\n');
          const summaryLower = summary.toLowerCase();

          // Duration & Category determination
          const moduleMatch = summaryLower.match(/\((\d+)\s*mins?\)/);
          let duration = 60;
          let category: SchoolCategory = 'class';

          if (moduleMatch) {
            duration = parseInt(moduleMatch[1], 10);
            category = 'module';
          } else if (summaryLower.includes('assignment') || summaryLower.includes('due')) {
            category = 'assignment';
          } else {
            category = 'class';
          }

          events.push({
            uid: currentEvent['UID'] || summary + dateObj.toISOString(),
            summary,
            description,
            location: currentEvent['LOCATION'] || '',
            dateStr: dateObj.toISOString(),
            isAllDay,
            dateObj: dateObj.toISOString(),
            duration,
            category,
          });
        }
      } else if (inEvent) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > -1) {
          const key = line.substring(0, colonIndex).split(';')[0];
          const value = line.substring(colonIndex + 1);
          currentEvent[key] = value;
        }
      }
    }

    // Keep events from yesterday onward and sort chronologically
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const filteredEvents = events.filter(
      (e) => new Date(e.dateObj).getTime() >= yesterday.getTime()
    );
    filteredEvents.sort(
      (a, b) => new Date(a.dateObj).getTime() - new Date(b.dateObj).getTime()
    );

    return NextResponse.json({
      events: filteredEvents,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
