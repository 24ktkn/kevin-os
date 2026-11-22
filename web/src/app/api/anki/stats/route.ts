import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  computeAnkiStudyPlan,
  computeBiometricsRetentionInsights,
  computeExamPacing,
  fetchAllAnkiCards,
  isMissingAnkiTableError,
} from '@/lib/anki-utils';
import { detectedExamToTarget, getDetectedElentraExams } from '@/lib/elentra-exams';
import { getOsSettings } from '@/lib/habit-automations';
import { getProductivityDateStr, getTodayDateStr } from '@/lib/date-utils';
import { AnkiCard, AnkiDailyStats, AnkiSyncState, ExamTarget } from '@/types/anki';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json(
        { success: false, error: 'Supabase not configured' },
        { status: 500 }
      );
    }

    const todayStr = getProductivityDateStr();
    const calTodayStr = getTodayDateStr();

    const osSettings = await getOsSettings();

    const [
      statsRes,
      stateRes,
      pendingQueueRes,
      pendingProposalsRes,
      habitRes,
      healthRes,
      cardsSummaryRes,
      taperStatus,
    ] = await Promise.all([
      sb.from('anki_daily_stats').select('*').order('date', { ascending: false }).limit(120),
      sb.from('anki_sync_state').select('*').eq('id', 'default').maybeSingle(),
      sb
        .from('anki_action_queue')
        .select('id, action_type, status, source, created_at, error_message')
        .in('status', ['pending', 'failed'])
        .order('created_at', { ascending: false })
        .limit(30),
      sb
        .from('anki_staged_proposals')
        .select('id')
        .eq('status', 'pending'),
      sb.from('habits').select('date, anki').eq('date', todayStr).maybeSingle(),
      sb
        .from('biometrics')
        .select('date, sleep_hours, hrv, rhr, steps')
        .order('date', { ascending: false })
        .limit(120),
      fetchAllAnkiCards<
        Pick<AnkiCard, 'deck_name' | 'tags' | 'suspended' | 'queue' | 'due_date' | 'interval_days'>
      >('deck_name, tags, suspended, queue, due_date, interval_days'),
      getDetectedElentraExams(osSettings.exam_taper_days),
    ]);

    if (statsRes.error && isMissingAnkiTableError(statsRes.error)) {
      return NextResponse.json({
        success: true,
        needsMigration: true,
        today: null,
        history: [],
        syncState: null,
        bridgeOnline: false,
        habitCompletedToday: Boolean(habitRes.data?.anki),
        pendingActionsCount: 0,
        pendingActions: [],
        pendingProposalsCount: 0,
        studyPlan: computeAnkiStudyPlan({ reviewDueRemaining: 0, learningRemaining: 0 }),
        biometricsInsights: computeBiometricsRetentionInsights([], []),
        examProjections: [],
      });
    }

    const history = ((statsRes.data || []) as AnkiDailyStats[]).reverse();
    const todayStats =
      history.find((h) => h.date === todayStr) ||
      history[history.length - 1] || {
        date: todayStr,
        reviews_today: 0,
        new_done_today: 0,
        review_due_remaining: 0,
        learning_remaining: 0,
        new_remaining: 0,
        total_due_remaining: 0,
        study_time_secs: 0,
        avg_secs_per_card: 8.5,
        retention_pct: 0,
        mature_retention_pct: 0,
        again_count: 0,
        hard_count: 0,
        good_count: 0,
        easy_count: 0,
        streak_days: 0,
        total_cards: 0,
        active_cards: 0,
        suspended_cards: 0,
        mature_cards: 0,
        leech_cards: 0,
        deck_breakdown: [],
        forecast_30d: [],
      };

    const syncState = (stateRes.data || {
      id: 'default',
      last_heartbeat_at: null,
      last_full_sync_at: null,
      last_ankiweb_sync_at: null,
      bridge_version: '1.0.0',
      auto_habit_rule: 'zero_review_learning',
      auto_habit_min_reviews: 50,
      default_deck: 'Schulich',
      default_model: 'Cloze',
      exam_targets: [],
    }) as AnkiSyncState;

    const heartbeatMs = syncState.last_heartbeat_at
      ? new Date(syncState.last_heartbeat_at).getTime()
      : 0;
    const bridgeOnline = heartbeatMs > 0 && Date.now() - heartbeatMs < 5 * 60_000;

    const studyPlan = computeAnkiStudyPlan({
      reviewDueRemaining: todayStats.review_due_remaining,
      learningRemaining: todayStats.learning_remaining,
      newRemaining: todayStats.new_remaining,
      includeNewCards: false,
      avgSecsPerCard: todayStats.avg_secs_per_card,
      allowSplit: true,
    });

    const biometricsInsights = computeBiometricsRetentionInsights(
      history,
      (healthRes.data || []) as Array<{
        date: string;
        sleep_hours?: number | null;
        hrv?: number | null;
        rhr?: number | null;
        steps?: number | null;
      }>
    );

    const cardsSlim = (cardsSummaryRes.data || []) as Pick<
      AnkiCard,
      'deck_name' | 'tags' | 'suspended' | 'queue' | 'due_date' | 'interval_days'
    >[];

    const manualTargets: ExamTarget[] = Array.isArray(syncState.exam_targets)
      ? syncState.exam_targets
      : [];

    // Merge auto-detected upcoming Schulich Elentra major exams (+ next 2 weekly quizzes) with manual exam targets
    const autoTargets: ExamTarget[] = [
      ...taperStatus.upcomingMajorExams.slice(0, 6).map(detectedExamToTarget),
      ...taperStatus.upcomingQuizzes.slice(0, 2).map(detectedExamToTarget),
    ];

    const mergedTargets: ExamTarget[] = [...manualTargets];
    for (const at of autoTargets) {
      const dup = mergedTargets.some(
        (m) =>
          m.id === at.id ||
          (m.examDate === at.examDate &&
            m.name.toLowerCase().trim() === at.name.toLowerCase().trim())
      );
      if (!dup) mergedTargets.push(at);
    }

    const examProjections = mergedTargets
      .filter((t) => t && t.examDate && t.examDate >= calTodayStr)
      .sort((a, b) => a.examDate.localeCompare(b.examDate))
      .map((target) =>
        computeExamPacing({
          target,
          cards: cardsSlim,
          baselineForecast: todayStats.forecast_30d,
          todayStr: calTodayStr,
        })
      );

    const pendingActions = (pendingQueueRes.data || []).filter((a) => a.status === 'pending');

    return NextResponse.json({
      success: true,
      needsMigration: false,
      today: todayStats,
      history,
      syncState,
      bridgeOnline,
      habitCompletedToday: Boolean(habitRes.data?.anki),
      pendingActionsCount: pendingActions.length,
      pendingActions: pendingQueueRes.data || [],
      pendingProposalsCount: (pendingProposalsRes.data || []).length,
      studyPlan,
      biometricsInsights,
      examProjections,
      taperStatus,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load Anki stats';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<AnkiSyncState>;
    const patch: Record<string, unknown> = {
      id: 'default',
      updated_at: new Date().toISOString(),
    };

    if (body.auto_habit_rule === 'zero_review_learning' || body.auto_habit_rule === 'min_reviews') {
      patch.auto_habit_rule = body.auto_habit_rule;
    }
    if (typeof body.auto_habit_min_reviews === 'number' && body.auto_habit_min_reviews > 0) {
      patch.auto_habit_min_reviews = Math.round(body.auto_habit_min_reviews);
    }
    if (typeof body.default_deck === 'string' && body.default_deck.trim()) {
      patch.default_deck = body.default_deck.trim();
    }
    if (typeof body.default_model === 'string' && body.default_model.trim()) {
      patch.default_model = body.default_model.trim();
    }
    if (Array.isArray(body.exam_targets)) {
      patch.exam_targets = body.exam_targets;
    }

    const { data, error } = await sb
      .from('anki_sync_state')
      .upsert(patch, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, syncState: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update Anki settings';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
