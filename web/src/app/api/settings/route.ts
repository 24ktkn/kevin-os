import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getOsSettings, OsAutomationSettings } from '@/lib/habit-automations';
import { isMissingAnkiTableError } from '@/lib/anki-utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getOsSettings();
  const sb = supabaseAdmin || supabase;
  let needsMigration = false;
  if (sb) {
    const { error } = await sb.from('os_settings').select('id').eq('id', 'default').maybeSingle();
    if (error && isMissingAnkiTableError(error)) needsMigration = true;
  }
  return NextResponse.json({ success: true, needsMigration, settings });
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }
    const body = (await req.json().catch(() => ({}))) as Partial<OsAutomationSettings>;
    const patch: Record<string, unknown> = {
      id: 'default',
      updated_at: new Date().toISOString(),
    };

    if (typeof body.wake_cutoff_time === 'string' && /^\d{1,2}:\d{2}$/.test(body.wake_cutoff_time.trim())) {
      patch.wake_cutoff_time = body.wake_cutoff_time.trim();
    }
    if (typeof body.gym_min_duration_mins === 'number' && body.gym_min_duration_mins > 0) {
      patch.gym_min_duration_mins = Math.round(body.gym_min_duration_mins);
    }
    if (typeof body.gym_min_calories === 'number' && body.gym_min_calories > 0) {
      patch.gym_min_calories = Math.round(body.gym_min_calories);
    }
    if (typeof body.ntfy_topic === 'string') {
      patch.ntfy_topic = body.ntfy_topic.trim().replace(/^https?:\/\/[^/]+\//i, '');
    }
    if (typeof body.ntfy_server === 'string' && body.ntfy_server.trim().startsWith('http')) {
      patch.ntfy_server = body.ntfy_server.trim().replace(/\/$/, '');
    }
    if (typeof body.morning_brief_enabled === 'boolean') {
      patch.morning_brief_enabled = body.morning_brief_enabled;
    }
    if (typeof body.exam_taper_days === 'number' && body.exam_taper_days >= 1 && body.exam_taper_days <= 21) {
      patch.exam_taper_days = Math.round(body.exam_taper_days);
    }

    const { data, error } = await sb
      .from('os_settings')
      .upsert(patch, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      if (isMissingAnkiTableError(error)) {
        return NextResponse.json(
          {
            success: false,
            needsMigration: true,
            error: 'Run web/supabase_migrations/add_os_upgrades_tables.sql in Supabase first.',
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings: data });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
