import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  fetchAllAnkiCards,
  isMissingAnkiTableError,
  maybeAutoCompleteAnkiHabit,
  verifyAnkiBridgeRequest,
} from '@/lib/anki-utils';
import { getProductivityDateStr } from '@/lib/date-utils';
import { AnkiCard, AnkiDailyStats } from '@/types/anki';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    if (!verifyAnkiBridgeRequest(req)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized Anki bridge token.' },
        { status: 401 }
      );
    }

    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json(
        { success: false, error: 'Supabase not configured.' },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      bridgeVersion?: string;
      ankiWebSynced?: boolean;
      fullSyncComplete?: boolean;
      stats?: Partial<AnkiDailyStats>;
      historyDays?: Array<{ date: string; reviews_today: number }>;
      cards?: Array<Partial<AnkiCard>>;
      pruneExceptCardIds?: number[];
      actionResults?: Array<{
        id: string;
        status: 'applied' | 'failed';
        result?: Record<string, unknown>;
        error?: string;
      }>;
    };

    const nowIso = new Date().toISOString();
    const todayStr = body.stats?.date || getProductivityDateStr();
    let habitAutoChecked = false;
    let habitNote = '';

    // 1. Update daily stats snapshot (preserving existing forecast_30d/total_cards on lightweight heartbeats)
    if (body.stats) {
      const { data: existingToday, error: fetchErr } = await sb
        .from('anki_daily_stats')
        .select('*')
        .eq('date', todayStr)
        .maybeSingle();

      if (fetchErr && isMissingAnkiTableError(fetchErr)) {
        return NextResponse.json(
          {
            success: false,
            needsMigration: true,
            error:
              'Anki tables do not exist yet in Supabase. Please run web/supabase_migrations/add_anki_tables.sql first.',
          },
          { status: 400 }
        );
      }

      const mergedStats = {
        date: todayStr,
        reviews_today: body.stats.reviews_today ?? existingToday?.reviews_today ?? 0,
        new_done_today: body.stats.new_done_today ?? existingToday?.new_done_today ?? 0,
        review_due_remaining:
          body.stats.review_due_remaining ?? existingToday?.review_due_remaining ?? 0,
        learning_remaining:
          body.stats.learning_remaining ?? existingToday?.learning_remaining ?? 0,
        new_remaining: body.stats.new_remaining ?? existingToday?.new_remaining ?? 0,
        total_due_remaining:
          body.stats.total_due_remaining ??
          (body.stats.review_due_remaining ?? 0) + (body.stats.learning_remaining ?? 0),
        study_time_secs: body.stats.study_time_secs ?? existingToday?.study_time_secs ?? 0,
        avg_secs_per_card:
          body.stats.avg_secs_per_card ?? existingToday?.avg_secs_per_card ?? 8.5,
        retention_pct: body.stats.retention_pct ?? existingToday?.retention_pct ?? 0,
        mature_retention_pct:
          body.stats.mature_retention_pct ?? existingToday?.mature_retention_pct ?? 0,
        again_count: body.stats.again_count ?? existingToday?.again_count ?? 0,
        hard_count: body.stats.hard_count ?? existingToday?.hard_count ?? 0,
        good_count: body.stats.good_count ?? existingToday?.good_count ?? 0,
        easy_count: body.stats.easy_count ?? existingToday?.easy_count ?? 0,
        streak_days: body.stats.streak_days ?? existingToday?.streak_days ?? 0,
        total_cards:
          body.stats.total_cards && body.stats.total_cards > 0
            ? body.stats.total_cards
            : existingToday?.total_cards ?? 0,
        active_cards:
          body.stats.active_cards && body.stats.active_cards > 0
            ? body.stats.active_cards
            : existingToday?.active_cards ?? 0,
        suspended_cards:
          typeof body.stats.suspended_cards === 'number' &&
          (body.stats.active_cards || body.stats.suspended_cards)
            ? body.stats.suspended_cards
            : existingToday?.suspended_cards ?? 0,
        mature_cards:
          typeof body.stats.mature_cards === 'number' &&
          (body.stats.active_cards || body.stats.mature_cards)
            ? body.stats.mature_cards
            : existingToday?.mature_cards ?? 0,
        leech_cards:
          typeof body.stats.leech_cards === 'number' &&
          (body.stats.active_cards || body.stats.leech_cards)
            ? body.stats.leech_cards
            : existingToday?.leech_cards ?? 0,
        deck_breakdown:
          Array.isArray(body.stats.deck_breakdown) && body.stats.deck_breakdown.length > 0
            ? body.stats.deck_breakdown
            : existingToday?.deck_breakdown ?? [],
        forecast_30d:
          Array.isArray(body.stats.forecast_30d) && body.stats.forecast_30d.length > 0
            ? body.stats.forecast_30d
            : existingToday?.forecast_30d ?? [],
        synced_at: nowIso,
        updated_at: nowIso,
      };

      const { error: upsertErr } = await sb
        .from('anki_daily_stats')
        .upsert(mergedStats, { onConflict: 'date' });

      if (upsertErr) {
        return NextResponse.json(
          { success: false, error: `Failed to save anki_daily_stats: ${upsertErr.message}` },
          { status: 500 }
        );
      }

      // Auto-complete daily Anki habit when review + learning remaining == 0 (after >=1 review)
      const habitRes = await maybeAutoCompleteAnkiHabit({
        date: todayStr,
        reviews_today: mergedStats.reviews_today,
        review_due_remaining: mergedStats.review_due_remaining,
        learning_remaining: mergedStats.learning_remaining,
      });
      habitAutoChecked = habitRes.checkedOff;
      habitNote = habitRes.reason;
    }

    // 1b. Backfill historical review counts for the 84-day Heatmap (never overwrites existing richer rows)
    if (Array.isArray(body.historyDays) && body.historyDays.length > 0) {
      const validHistory = body.historyDays.filter(
        (h) => h && typeof h.date === 'string' && h.date.length === 10 && h.date < todayStr
      );
      if (validHistory.length > 0) {
        const { data: existingDates } = await sb
          .from('anki_daily_stats')
          .select('date, reviews_today')
          .in(
            'date',
            validHistory.map((h) => h.date)
          );
        const existingMap = new Map(
          (existingDates || []).map((r) => [String(r.date), Number(r.reviews_today) || 0])
        );
        const toInsert = validHistory
          .filter((h) => !existingMap.has(h.date) || existingMap.get(h.date)! < h.reviews_today)
          .map((h) => ({
            date: h.date,
            reviews_today: h.reviews_today,
            updated_at: nowIso,
          }));
        if (toInsert.length > 0) {
          await sb.from('anki_daily_stats').upsert(toInsert, { onConflict: 'date' });
        }
      }
    }

    // 2. Upsert card mirror chunks (3,000-5,000 cards)
    let upsertedCards = 0;
    if (Array.isArray(body.cards) && body.cards.length > 0) {
      const sanitized = body.cards
        .filter((c) => c && typeof c.card_id === 'number' && c.card_id > 0)
        .map((c) => ({
          card_id: c.card_id!,
          note_id: c.note_id || c.card_id!,
          deck_name: c.deck_name || 'Default',
          model_name: c.model_name || 'Cloze',
          ord: c.ord || 0,
          front_html: c.front_html || '',
          back_html: c.back_html || '',
          front_text: c.front_text || '',
          back_text: c.back_text || '',
          extra_text: c.extra_text || '',
          fields_json: c.fields_json || {},
          tags: Array.isArray(c.tags) ? c.tags : [],
          suspended: Boolean(c.suspended),
          buried: Boolean(c.buried),
          queue: typeof c.queue === 'number' ? c.queue : 0,
          card_type: typeof c.card_type === 'number' ? c.card_type : 0,
          due_value: typeof c.due_value === 'number' ? c.due_value : 0,
          due_date: c.due_date || null,
          interval_days: typeof c.interval_days === 'number' ? c.interval_days : 0,
          ease_factor: typeof c.ease_factor === 'number' ? c.ease_factor : 2500,
          reps: typeof c.reps === 'number' ? c.reps : 0,
          lapses: typeof c.lapses === 'number' ? c.lapses : 0,
          updated_at: nowIso,
        }));

      if (sanitized.length > 0) {
        const { error: cardErr } = await sb
          .from('anki_cards')
          .upsert(sanitized, { onConflict: 'card_id' });
        if (cardErr) {
          return NextResponse.json(
            { success: false, error: `Failed to upsert anki_cards: ${cardErr.message}` },
            { status: 500 }
          );
        }
        upsertedCards = sanitized.length;
      }
    }

    // Remove deleted/temp optimistic negative card IDs after a complete mirror push
    let prunedCardsCount = 0;
    if (body.fullSyncComplete && Array.isArray(body.pruneExceptCardIds)) {
      const keepSet = new Set(body.pruneExceptCardIds.map(Number));
      const { data: existingIds } = await fetchAllAnkiCards<{ card_id: number }>('card_id');
      const toDelete = existingIds
        .map((r) => Number(r.card_id))
        .filter((id) => !keepSet.has(id));
      for (let i = 0; i < toDelete.length; i += 200) {
        await sb.from('anki_cards').delete().in('card_id', toDelete.slice(i, i + 200));
      }
      prunedCardsCount = toDelete.length;

      // Also clean any pending Approval Inbox proposals referencing deleted cards so they never reappear
      if (toDelete.length > 0) {
        const deletedSet = new Set(toDelete);
        const { data: pendingProps } = await sb
          .from('anki_staged_proposals')
          .select('id, proposal_type, payload')
          .eq('status', 'pending')
          .in('proposal_type', ['unsuspend_cards', 'suspend_cards']);

        for (const prop of pendingProps || []) {
          const payload = (prop.payload || {}) as {
            cardIds?: number[];
            matches?: Array<{ cardId: number }>;
          };
          const origIds = Array.isArray(payload.cardIds) ? payload.cardIds : [];
          const origMatches = Array.isArray(payload.matches) ? payload.matches : [];
          const nextIds = origIds.filter((id) => !deletedSet.has(Number(id)));
          const nextMatches = origMatches.filter((m) => !deletedSet.has(Number(m.cardId)));

          if (nextIds.length !== origIds.length || nextMatches.length !== origMatches.length) {
            if (nextIds.length === 0 && nextMatches.length === 0) {
              await sb
                .from('anki_staged_proposals')
                .update({ status: 'rejected', reviewed_at: nowIso })
                .eq('id', prop.id);
            } else {
              await sb
                .from('anki_staged_proposals')
                .update({ payload: { ...payload, cardIds: nextIds, matches: nextMatches } })
                .eq('id', prop.id);
            }
          }
        }
      }
    }

    // 3. Apply action results reported by the bridge
    if (Array.isArray(body.actionResults) && body.actionResults.length > 0) {
      for (const r of body.actionResults) {
        if (!r.id) continue;
        await sb
          .from('anki_action_queue')
          .update({
            status: r.status,
            result_json: r.result || null,
            error_message: r.error || null,
            applied_at: nowIso,
          })
          .eq('id', r.id);
      }
    }

    // 4. Update bridge heartbeat & sync state
    const statePatch: Record<string, unknown> = {
      id: 'default',
      last_heartbeat_at: nowIso,
      bridge_version: body.bridgeVersion || '1.0.0',
      updated_at: nowIso,
    };
    if (body.fullSyncComplete) statePatch.last_full_sync_at = nowIso;
    if (body.ankiWebSynced) statePatch.last_ankiweb_sync_at = nowIso;

    await sb.from('anki_sync_state').upsert(statePatch, { onConflict: 'id' });

    // 5. Fetch pending cloud actions for the bridge to execute immediately
    const { data: pendingActions } = await sb
      .from('anki_action_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

    return NextResponse.json({
      success: true,
      syncedAt: nowIso,
      upsertedCards,
      prunedCardsCount,
      habitAutoChecked,
      habitNote,
      pendingActions: pendingActions || [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Anki sync error';
    console.error('Error in POST /api/anki/sync:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
