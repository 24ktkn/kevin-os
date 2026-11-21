import { NextRequest, NextResponse } from 'next/server';
import {
  recommendSingleSchoolModule,
  scheduleWeekModules,
} from '@/lib/kevin-os-tools';
import { CalendarName } from '@/types/task';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: 'single' | 'batch';
      // Single module parameters
      uid?: string;
      title?: string;
      rawSummary?: string;
      description?: string;
      rawDurationMins?: number;
      preferredDate?: string;
      searchDays?: number;
      calendar?: CalendarName;
      autoCommit?: boolean;
      // Batch / week parameters
      startDate?: string;
      endDate?: string;
      moduleTitles?: string[];
      includeOverdueModules?: boolean;
      maxModulesPerDay?: number;
      preferredStartHour?: number;
      commit?: boolean;
    };

    if (body.mode === 'single') {
      if (!body.title && !body.rawSummary) {
        return NextResponse.json(
          { success: false, error: 'Missing module title for single recommendation.' },
          { status: 400 }
        );
      }

      const rec = await recommendSingleSchoolModule({
        uid: body.uid,
        title: body.title || body.rawSummary || 'Online Module',
        rawSummary: body.rawSummary || body.title,
        description: body.description,
        rawDurationMins: body.rawDurationMins,
        preferredDate: body.preferredDate,
        searchDays: body.searchDays,
        calendar: body.calendar || 'School',
        autoCommit: Boolean(body.autoCommit),
      });

      return NextResponse.json(rec);
    }

    const batchRes = await scheduleWeekModules({
      startDate: body.startDate,
      endDate: body.endDate,
      moduleTitles: body.moduleTitles,
      includeOverdueModules: body.includeOverdueModules !== false,
      maxModulesPerDay: body.maxModulesPerDay || 3,
      preferredStartHour: body.preferredStartHour || 8,
      dryRun: !body.commit,
    });

    return NextResponse.json(batchRes);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to recommend module schedule';
    console.error('Error in /api/school/recommend:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
