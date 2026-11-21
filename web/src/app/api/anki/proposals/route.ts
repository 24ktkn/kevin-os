import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { isMissingAnkiTableError, stripHtml } from '@/lib/anki-utils';
import { AnkiProposal, StagedNewCardDraft } from '@/types/anki';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const status = req.nextUrl.searchParams.get('status') || 'all';
    let q = sb
      .from('anki_staged_proposals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);

    if (status !== 'all') {
      q = q.eq('status', status);
    }

    const { data, error } = await q;
    if (error) {
      if (isMissingAnkiTableError(error)) {
        return NextResponse.json({ success: true, needsMigration: true, proposals: [] });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      needsMigration: false,
      proposals: (data || []) as AnkiProposal[],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load proposals';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      decision?: 'approve' | 'reject';
      selectedCardIds?: number[];
      editedCards?: StagedNewCardDraft[];
    };

    if (!body.id || !body.decision) {
      return NextResponse.json(
        { success: false, error: 'id and decision (approve|reject) are required.' },
        { status: 400 }
      );
    }

    const { data: proposal, error: pErr } = await sb
      .from('anki_staged_proposals')
      .select('*')
      .eq('id', body.id)
      .single();

    if (pErr || !proposal) {
      return NextResponse.json({ success: false, error: 'Proposal not found.' }, { status: 404 });
    }

    const typed = proposal as AnkiProposal;
    const nowIso = new Date().toISOString();

    if (body.decision === 'reject') {
      await sb
        .from('anki_staged_proposals')
        .update({ status: 'rejected', reviewed_at: nowIso })
        .eq('id', typed.id);
      return NextResponse.json({ success: true, status: 'rejected' });
    }

    // APPROVE -> Enqueue into anki_action_queue + optimistically update anki_cards
    let queuedCount = 0;

    if (typed.proposal_type === 'new_cards') {
      const cardsToAdd =
        Array.isArray(body.editedCards) && body.editedCards.length > 0
          ? body.editedCards
          : typed.payload?.cards || [];

      for (const card of cardsToAdd) {
        if (!card.front?.trim()) continue;
        const deckName = card.deckName || typed.deck_name || 'Schulich';
        const modelName = card.modelName || (/\{\{c\d+::/.test(card.front) ? 'Cloze' : 'Basic');
        const tags = Array.isArray(card.tags) ? card.tags : [];

        await sb.from('anki_action_queue').insert({
          action_type: 'add_note',
          payload: {
            deckName,
            modelName,
            front: card.front,
            back: card.back || '',
            extra: card.extra || '',
            tags,
          },
          status: 'pending',
          source: 'approval_inbox',
        });

        const tempId = -(Math.floor(Date.now() % 1_000_000_000) + queuedCount + 1);
        await sb.from('anki_cards').upsert(
          {
            card_id: tempId,
            note_id: tempId,
            deck_name: deckName,
            model_name: modelName,
            ord: 0,
            front_html: card.front,
            back_html: card.back || card.extra || '',
            front_text: stripHtml(card.front),
            back_text: stripHtml(card.back || card.extra || ''),
            extra_text: stripHtml(card.extra || ''),
            fields_json: {
              Text: card.front,
              Front: card.front,
              Back: card.back || '',
              Extra: card.extra || '',
            },
            tags: [...tags, 'pending_anki_sync'],
            suspended: false,
            buried: false,
            queue: 0,
            card_type: 0,
            updated_at: nowIso,
          },
          { onConflict: 'card_id' }
        );
        queuedCount += 1;
      }
    } else if (
      typed.proposal_type === 'unsuspend_cards' ||
      typed.proposal_type === 'suspend_cards'
    ) {
      const ids =
        Array.isArray(body.selectedCardIds) && body.selectedCardIds.length > 0
          ? body.selectedCardIds
          : typed.payload?.cardIds ||
            (typed.payload?.matches || []).map((m) => m.cardId);
      const validIds = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);

      if (validIds.length > 0) {
        const isSuspending = typed.proposal_type === 'suspend_cards';
        await sb.from('anki_action_queue').insert({
          action_type: typed.proposal_type,
          payload: { cardIds: validIds },
          status: 'pending',
          source: 'approval_inbox',
        });

        await sb
          .from('anki_cards')
          .update({
            suspended: isSuspending,
            queue: isSuspending ? -1 : 0,
            updated_at: nowIso,
          })
          .in('card_id', validIds);

        queuedCount = validIds.length;
      }
    }

    await sb
      .from('anki_staged_proposals')
      .update({ status: 'approved', reviewed_at: nowIso })
      .eq('id', typed.id);

    return NextResponse.json({
      success: true,
      status: 'approved',
      queuedCount,
      message: `Approved and queued ${queuedCount} item(s) to sync to Anki Desktop & AnkiWeb.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Proposal review error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
