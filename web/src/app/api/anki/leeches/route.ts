import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { isMissingAnkiTableError, stripClozeMarkup } from '@/lib/anki-utils';
import { AnkiCard, AnkiLeechGroup } from '@/types/anki';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

function pickTopicLabel(card: AnkiCard): string {
  const cleanTags = (card.tags || []).filter(
    (t) =>
      t &&
      !['leech', 'marked', 'pending_anki_sync', 'source::notebooklm'].includes(t.toLowerCase())
  );
  if (cleanTags.length > 0) {
    const parts = cleanTags[0].split('::');
    return parts[parts.length - 1].replace(/[_-]+/g, ' ');
  }
  const deckParts = (card.deck_name || 'General').split('::');
  return deckParts[deckParts.length - 1];
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const minLapses = Math.max(
      2,
      parseInt(req.nextUrl.searchParams.get('minLapses') || '4', 10) || 4
    );

    const { data, error } = await sb
      .from('anki_cards')
      .select('card_id, note_id, deck_name, front_text, back_text, extra_text, lapses, reps, tags, suspended')
      .eq('suspended', false)
      .gte('lapses', minLapses)
      .order('lapses', { ascending: false })
      .limit(200);

    if (error) {
      if (isMissingAnkiTableError(error)) {
        return NextResponse.json({
          success: true,
          needsMigration: true,
          totalLeeches: 0,
          groups: [],
        });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const cards = (data || []) as AnkiCard[];
    const groupMap = new Map<string, AnkiLeechGroup>();

    for (const c of cards) {
      const topic = pickTopicLabel(c);
      const key = `${c.deck_name}::${topic.toLowerCase()}`;
      let grp = groupMap.get(key);
      if (!grp) {
        grp = {
          topic,
          deckName: c.deck_name,
          cardCount: 0,
          avgLapses: 0,
          totalLapses: 0,
          cards: [],
        };
        groupMap.set(key, grp);
      }
      grp.cardCount += 1;
      grp.totalLapses += c.lapses || 0;
      grp.cards.push({
        card_id: c.card_id,
        note_id: c.note_id,
        deck_name: c.deck_name,
        front_text: stripClozeMarkup(c.front_text || ''),
        back_text: stripClozeMarkup(c.back_text || ''),
        extra_text: stripClozeMarkup(c.extra_text || ''),
        lapses: c.lapses || 0,
        reps: c.reps || 0,
        tags: c.tags || [],
      });
    }

    const groups = Array.from(groupMap.values())
      .map((g) => ({
        ...g,
        avgLapses: Math.round((g.totalLapses / Math.max(1, g.cardCount)) * 10) / 10,
      }))
      .sort((a, b) => b.totalLapses - a.totalLapses || b.cardCount - a.cardCount);

    return NextResponse.json({
      success: true,
      needsMigration: false,
      minLapses,
      totalLeeches: cards.length,
      groups,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load Anki leeches';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      topic?: string;
      cards?: Array<{ front_text: string; back_text?: string; extra_text?: string; lapses?: number }>;
    };

    const topic = (body.topic || 'Weak Anki Concepts').trim();
    const cards = Array.isArray(body.cards) ? body.cards.slice(0, 18) : [];
    if (cards.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Provide at least 1 leech card to remediate.' },
        { status: 400 }
      );
    }

    const cardListText = cards
      .map(
        (c, i) =>
          `${i + 1}. (${c.lapses || 4} lapses) Front: ${c.front_text}${
            c.back_text ? ` | Back: ${c.back_text}` : ''
          }${c.extra_text ? ` | Extra: ${c.extra_text}` : ''}`
      )
      .join('\n');

    const notebookLmPrompt = `Using my uploaded Schulich lecture notes in NotebookLM, create a concise high-yield comparison table and clinical differentiation guide specifically addressing these concepts I repeatedly miss in Anki (${topic}):\n\n${cards
      .slice(0, 10)
      .map((c, i) => `${i + 1}. ${c.front_text.slice(0, 150)}`)
      .join('\n')}`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: true,
        topic,
        guideMarkdown:
          'GEMINI_API_KEY not configured. Copy the NotebookLM prompt below to remediate these leeches.',
        notebookLmPrompt,
      });
    }

    const prompt = `You are a medical school tutor helping a Schulich medical student fix recurring Anki "leech" cards in "${topic}".
Analyze these frequently missed cards and write a crisp, ultra-high-yield Markdown remediation sheet with:
1. **Why These Keep Slipping (Root Confusion Patterns)** — 2-3 bullet points
2. **Side-by-Side Comparison Table** — distinguishing easily confused drugs, diseases, mechanisms, or lab findings
3. **Memory Hooks & Clinical Anchors** — short, punchy mnemonics or pathophysiology links
4. **2 Rapid-Fire Self-Test Vignettes** (with answers hidden below)

LEECH CARDS:
${cardListText}`;

    let guideMarkdown = '';
    for (const model of GEMINI_MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14_000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.25 },
            }),
            signal: controller.signal,
          }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (txt.trim()) {
          guideMarkdown = txt.trim();
          break;
        }
      } catch {
        // Fallback to next model
      } finally {
        clearTimeout(timer);
      }
    }

    return NextResponse.json({
      success: true,
      topic,
      guideMarkdown:
        guideMarkdown || 'Could not generate AI guide right now — use the NotebookLM prompt below.',
      notebookLmPrompt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to generate remediation guide';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
