import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  fetchAllAnkiCards,
  findPotentialDuplicateCard,
  isMissingAnkiTableError,
  maybeAutoCompleteAnkiHabit,
  stripClozeMarkup,
  stripHtml,
} from '@/lib/anki-utils';
import { getProductivityDateStr, getTodayDateStr } from '@/lib/date-utils';
import { AnkiCard } from '@/types/anki';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') || '').trim().toLowerCase();
    const deck = (sp.get('deck') || '').trim();
    const status = (sp.get('status') || 'all').toLowerCase(); // all | due | active | suspended | leech | new
    const tag = (sp.get('tag') || '').trim().toLowerCase();
    const dueQueue = sp.get('dueQueue') === 'true';
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '60', 10) || 60));
    const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);
    const todayStr = getTodayDateStr();

    const filters: Parameters<typeof fetchAllAnkiCards>[1] = {};
    if (deck && deck !== 'ALL') filters.deckPrefix = deck;
    if (status === 'suspended') {
      filters.suspended = true;
    } else if (status === 'active') {
      filters.suspended = false;
    } else if (status === 'leech') {
      filters.minLapses = 4;
    } else if (status === 'new') {
      filters.suspended = false;
      filters.queues = [0];
    } else if (status === 'due' || dueQueue) {
      filters.suspended = false;
      filters.buried = false;
      filters.queues = [1, 2, 3];
    }

    const { data, error } = await fetchAllAnkiCards<AnkiCard>('*', filters);
    if (error) {
      if (isMissingAnkiTableError(error)) {
        return NextResponse.json({
          success: true,
          needsMigration: true,
          total: 0,
          decks: [],
          cards: [],
        });
      }
      const errMsg = error instanceof Error ? error.message : String((error as { message?: string })?.message || 'Query error');
      return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
    }

    let list = data;

    // Filter due cards strictly to today or overdue when dueQueue/status=due
    if (status === 'due' || dueQueue) {
      list = list.filter(
        (c) =>
          c.queue === 1 ||
          c.queue === 3 ||
          (c.queue === 2 && (!c.due_date || c.due_date <= todayStr))
      );
      // Order learning cards first, then overdue/due reviews
      list.sort((a, b) => {
        const aLearn = a.queue === 1 || a.queue === 3 ? 0 : 1;
        const bLearn = b.queue === 1 || b.queue === 3 ? 0 : 1;
        if (aLearn !== bLearn) return aLearn - bLearn;
        return (a.due_date || '').localeCompare(b.due_date || '');
      });
    } else if (status === 'leech') {
      list.sort((a, b) => b.lapses - a.lapses || b.reps - a.reps);
    } else {
      list.sort((a, b) => b.card_id - a.card_id);
    }

    if (tag) {
      list = list.filter((c) => (c.tags || []).some((t) => t.toLowerCase().includes(tag)));
    }

    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      list = list.filter((c) => {
        const hay = `${c.deck_name} ${stripClozeMarkup(c.front_text)} ${c.back_text} ${c.extra_text} ${(c.tags || []).join(' ')}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    const decksSet = new Set<string>();
    for (const c of data || []) {
      if (c.deck_name) decksSet.add(String(c.deck_name));
    }

    const total = list.length;
    const paged = list.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      needsMigration: false,
      total,
      decks: Array.from(decksSet).sort(),
      cards: paged,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch Anki cards';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      action?:
        | 'add_note'
        | 'unsuspend'
        | 'suspend'
        | 'answer_card'
        | 'update_tags'
        | 'trigger_sync';
      // add_note
      deckName?: string;
      modelName?: string;
      front?: string;
      back?: string;
      extra?: string;
      tags?: string[];
      // suspend / unsuspend
      cardIds?: number[];
      // answer_card
      cardId?: number;
      ease?: 1 | 2 | 3 | 4;
      durationSecs?: number;
      // update_tags
      noteIds?: number[];
      addTags?: string;
      removeTags?: string;
      source?: string;
    };

    const source = body.source || 'kevin_os_ui';

    if (body.action === 'add_note') {
      const front = (body.front || '').trim();
      const back = (body.back || '').trim();
      const extra = (body.extra || '').trim();
      const deckName = (body.deckName || 'Schulich').trim();
      const modelName = (body.modelName || (/\{\{c\d+::/.test(front) ? 'Cloze' : 'Basic')).trim();
      const tags = Array.isArray(body.tags)
        ? body.tags.map((t) => t.trim().replace(/\s+/g, '_')).filter(Boolean)
        : [];

      if (!front) {
        return NextResponse.json({ success: false, error: 'Card front/text is required.' }, { status: 400 });
      }

      // Check for potential duplicate across all cards
      const { data: existingCards } = await fetchAllAnkiCards<
        Pick<AnkiCard, 'card_id' | 'front_text' | 'deck_name'>
      >('card_id, front_text, deck_name');
      const dupWarning = findPotentialDuplicateCard(front, existingCards);

      const { data: queued, error: qErr } = await sb
        .from('anki_action_queue')
        .insert({
          action_type: 'add_note',
          payload: { deckName, modelName, front, back, extra, tags },
          status: 'pending',
          source,
        })
        .select('*')
        .single();

      if (qErr) {
        return NextResponse.json({ success: false, error: qErr.message }, { status: 500 });
      }

      // Optimistic negative ID card so it shows immediately in Kevin-OS until next Anki bridge sync
      const tempId = -Math.floor(Date.now() % 1_000_000_000);
      await sb.from('anki_cards').upsert(
        {
          card_id: tempId,
          note_id: tempId,
          deck_name: deckName,
          model_name: modelName,
          ord: 0,
          front_html: front,
          back_html: back || extra,
          front_text: stripHtml(front),
          back_text: stripHtml(back || extra),
          extra_text: stripHtml(extra),
          fields_json: { Text: front, Front: front, Back: back, Extra: extra },
          tags: [...tags, 'pending_anki_sync'],
          suspended: false,
          buried: false,
          queue: 0,
          card_type: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'card_id' }
      );

      return NextResponse.json({
        success: true,
        queuedAction: queued,
        duplicateWarning: dupWarning,
        message: 'Queued card to sync into Anki Desktop & AnkiWeb.',
      });
    }

    if (body.action === 'unsuspend' || body.action === 'suspend') {
      const cardIds = (body.cardIds || []).map(Number).filter((n) => Number.isFinite(n) && n !== 0);
      if (cardIds.length === 0) {
        return NextResponse.json({ success: false, error: 'No cardIds provided.' }, { status: 400 });
      }
      const isSuspending = body.action === 'suspend';
      const actionType = isSuspending ? 'suspend_cards' : 'unsuspend_cards';

      const { data: queued, error: qErr } = await sb
        .from('anki_action_queue')
        .insert({
          action_type: actionType,
          payload: { cardIds },
          status: 'pending',
          source,
        })
        .select('*')
        .single();

      if (qErr) {
        return NextResponse.json({ success: false, error: qErr.message }, { status: 500 });
      }

      // Optimistically update mirror so UI and Gemini see the change immediately
      await sb
        .from('anki_cards')
        .update({
          suspended: isSuspending,
          queue: isSuspending ? -1 : 0,
          updated_at: new Date().toISOString(),
        })
        .in('card_id', cardIds);

      return NextResponse.json({
        success: true,
        count: cardIds.length,
        queuedAction: queued,
        message: `${isSuspending ? 'Suspended' : 'Unsuspended'} ${cardIds.length} card(s) (queued for Anki Desktop sync).`,
      });
    }

    if (body.action === 'answer_card') {
      const cardId = Number(body.cardId);
      const ease = (Math.min(4, Math.max(1, Number(body.ease) || 3)) as 1 | 2 | 3 | 4);
      const durationSecs = Math.min(120, Math.max(1, Number(body.durationSecs) || 8));
      if (!Number.isFinite(cardId) || cardId <= 0) {
        return NextResponse.json({ success: false, error: 'Valid positive cardId required.' }, { status: 400 });
      }

      const { data: queued, error: qErr } = await sb
        .from('anki_action_queue')
        .insert({
          action_type: 'answer_card',
          payload: { cardId, ease },
          status: 'pending',
          source,
        })
        .select('*')
        .single();

      if (qErr) {
        return NextResponse.json({ success: false, error: qErr.message }, { status: 500 });
      }

      // Optimistically update today's stats & card queue so reviewer + Home progress update immediately
      const todayStr = getProductivityDateStr();
      const { data: cardRow } = await sb
        .from('anki_cards')
        .select('queue, lapses, reps')
        .eq('card_id', cardId)
        .maybeSingle();

      const wasLearning = cardRow?.queue === 1 || cardRow?.queue === 3;
      const wasReview = cardRow?.queue === 2;

      if (ease >= 2) {
        await sb
          .from('anki_cards')
          .update({
            queue: 2,
            due_date: '2099-01-01', // Cleared from today's due list until next bridge sync writes real FSRS due_date
            reps: (cardRow?.reps || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('card_id', cardId);
      } else {
        await sb
          .from('anki_cards')
          .update({
            queue: 1,
            lapses: (cardRow?.lapses || 0) + 1,
            reps: (cardRow?.reps || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('card_id', cardId);
      }

      let habitAutoChecked = false;
      const { data: todayRow } = await sb
        .from('anki_daily_stats')
        .select('*')
        .eq('date', todayStr)
        .maybeSingle();

      if (todayRow) {
        const nextReviews = (todayRow.reviews_today || 0) + 1;
        const nextStudySecs = (todayRow.study_time_secs || 0) + durationSecs;
        const nextReviewRem =
          ease >= 2 && wasReview
            ? Math.max(0, (todayRow.review_due_remaining || 0) - 1)
            : todayRow.review_due_remaining || 0;
        const nextLearnRem =
          ease >= 2 && wasLearning
            ? Math.max(0, (todayRow.learning_remaining || 0) - 1)
            : ease === 1 && !wasLearning
            ? (todayRow.learning_remaining || 0) + 1
            : todayRow.learning_remaining || 0;

        const nextAgain = (todayRow.again_count || 0) + (ease === 1 ? 1 : 0);
        const nextHard = (todayRow.hard_count || 0) + (ease === 2 ? 1 : 0);
        const nextGood = (todayRow.good_count || 0) + (ease === 3 ? 1 : 0);
        const nextEasy = (todayRow.easy_count || 0) + (ease === 4 ? 1 : 0);
        const totalRated = nextAgain + nextHard + nextGood + nextEasy;
        const nextRetention =
          totalRated > 0
            ? Math.round(((nextHard + nextGood + nextEasy) / totalRated) * 1000) / 10
            : todayRow.retention_pct || 0;

        await sb
          .from('anki_daily_stats')
          .update({
            reviews_today: nextReviews,
            review_due_remaining: nextReviewRem,
            learning_remaining: nextLearnRem,
            total_due_remaining: nextReviewRem + nextLearnRem,
            study_time_secs: nextStudySecs,
            avg_secs_per_card: Math.round((nextStudySecs / nextReviews) * 10) / 10,
            again_count: nextAgain,
            hard_count: nextHard,
            good_count: nextGood,
            easy_count: nextEasy,
            retention_pct: nextRetention,
            updated_at: new Date().toISOString(),
          })
          .eq('date', todayStr);

        const habitRes = await maybeAutoCompleteAnkiHabit({
          date: todayStr,
          reviews_today: nextReviews,
          review_due_remaining: nextReviewRem,
          learning_remaining: nextLearnRem,
        });
        habitAutoChecked = habitRes.checkedOff;
      }

      return NextResponse.json({
        success: true,
        queuedAction: queued,
        habitAutoChecked,
      });
    }

    if (body.action === 'update_tags') {
      const noteIds = (body.noteIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (noteIds.length === 0) {
        return NextResponse.json({ success: false, error: 'noteIds required.' }, { status: 400 });
      }
      const { data: queued, error: qErr } = await sb
        .from('anki_action_queue')
        .insert({
          action_type: 'update_tags',
          payload: {
            noteIds,
            addTags: body.addTags || '',
            removeTags: body.removeTags || '',
          },
          status: 'pending',
          source,
        })
        .select('*')
        .single();

      if (qErr) {
        return NextResponse.json({ success: false, error: qErr.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, queuedAction: queued });
    }

    if (body.action === 'trigger_sync') {
      const { data: queued, error: qErr } = await sb
        .from('anki_action_queue')
        .insert({
          action_type: 'trigger_sync',
          payload: {},
          status: 'pending',
          source,
        })
        .select('*')
        .single();
      if (qErr) {
        return NextResponse.json({ success: false, error: qErr.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, queuedAction: queued });
    }

    return NextResponse.json({ success: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Anki card action error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
