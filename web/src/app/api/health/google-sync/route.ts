import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  fetchGoogleHealthDailyRecords,
  getGoogleHealthAccessTokenAsync,
} from '@/lib/google-health';
import {
  mirrorBiometricsToSheets,
  processBiometricRecord,
} from '@/app/api/health/sync/route';

export const dynamic = 'force-dynamic';

async function handleGoogleHealthSync(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const daysParam = parseInt(searchParams.get('days') || '7', 10);
    const daysBack = Math.min(90, Math.max(1, isNaN(daysParam) ? 7 : daysParam));

    const { accessToken, authUrl, error } = await getGoogleHealthAccessTokenAsync();
    if (!accessToken) {
      return NextResponse.json({
        success: false,
        connected: false,
        authUrl,
        error: error || 'Google Health is not connected yet.',
      });
    }

    const { records, diagnostics } = await fetchGoogleHealthDailyRecords(daysBack);
    const sb = supabaseAdmin || supabase;

    const syncedMetrics = [];
    let lastProcessed: { sheetsRow: string[]; targetDate: string } | null = null;

    for (const rec of records) {
      const { mergedRecord, sheetsRow, targetDate } = await processBiometricRecord(
        {
          date: rec.date,
          steps: rec.steps,
          rhr: rec.rhr,
          hrv: rec.hrv,
          weight: rec.weight,
          sleep: rec.sleep,
          sleepTime: rec.sleepTime,
          wakeTime: rec.wakeTime,
          workoutCalories: rec.workoutCalories,
          workoutDuration: rec.workoutDuration,
          timezone: 'America/New_York',
        },
        sb,
        records.length > 1
      );
      syncedMetrics.push(mergedRecord);
      lastProcessed = { sheetsRow, targetDate };
    }

    if (records.length > 1 && lastProcessed) {
      mirrorBiometricsToSheets(lastProcessed.sheetsRow, lastProcessed.targetDate).catch(
        () => {}
      );
    }

    return NextResponse.json({
      success: true,
      connected: true,
      daysBack,
      syncedCount: syncedMetrics.length,
      metrics: syncedMetrics,
      diagnostics,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error in Google Health sync:', msg);
    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: msg,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleGoogleHealthSync(req);
}

export async function POST(req: NextRequest) {
  return handleGoogleHealthSync(req);
}
