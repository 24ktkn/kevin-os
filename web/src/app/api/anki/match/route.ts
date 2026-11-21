import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  expandMedicalConceptsWithAI,
  findPotentialDuplicateCard,
  isMissingAnkiTableError,
  rankMatchingCards,
  stripClozeMarkup,
} from '@/lib/anki-utils';
import { AnkiCard, StagedNewCardDraft } from '@/types/anki';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

async function generateGapCardsWithAI(params: {
  sourceTitle: string;
  sourceText: string;
  deckName: string;
  modelName: 'Cloze' | 'Basic';
  existingSnippets: string[];
  maxCards: number;
  tags: string[];
}): Promise<StagedNewCardDraft[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const existingSummary =
    params.existingSnippets.length > 0
      ? params.existingSnippets.slice(0, 35).map((s, i) => `${i + 1}. ${s}`).join('\n')
      : 'None found yet.';

  const prompt = `You are a medical education specialist crafting high-yield Anki cards for a Western University (Schulich) medical student.

SOURCE TITLE: ${params.sourceTitle}
TARGET DECK: ${params.deckName}
CARD TYPE: ${params.modelName}
MAX CARDS TO CREATE: ${params.maxCards}

EXISTING ANKI CARDS ALREADY COVERING THIS TOPIC (DO NOT DUPLICATE THESE):
${existingSummary}

LECTURE / NOTEBOOKLM SOURCE CONTENT:
${params.sourceText.slice(0, 14000)}

RULES FOR HIGH-YIELD MED SCHOOL CARDS:
1. Only create cards for testable, high-yield clinical/mechanism/pharmacology/pathology facts NOT already covered in the Existing Anki Cards list.
2. Keep every card atomic (1 core testable fact per card).
3. ${
    params.modelName === 'Cloze'
      ? 'Use Anki Cloze syntax strictly: {{c1::key term}} (and optionally {{c2::second term}} when closely paired). Put concise mechanism/clinical pearl/differentials in "extra".'
      : 'Write a crisp clinical/conceptual question in "front", a concise direct answer in "back", and clinical context/pearl in "extra".'
  }
4. Return ONLY a raw JSON array matching this exact schema:
[
  {
    "front": "Cloze text with {{c1::...}} OR concise Basic question",
    "back": "Leave empty for Cloze OR concise answer for Basic",
    "extra": "Brief high-yield clinical pearl, mechanism, or distinction",
    "tags": ["snake_case_tag_1", "snake_case_tag_2"]
  }
]`;

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
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) continue;

      return parsed
        .filter((item) => item && typeof item.front === 'string' && item.front.trim().length > 5)
        .slice(0, params.maxCards)
        .map((item) => {
          const itemTags = Array.isArray(item.tags)
            ? item.tags.map((t: unknown) => String(t).trim().replace(/\s+/g, '_')).filter(Boolean)
            : [];
          return {
            deckName: params.deckName,
            modelName: params.modelName,
            front: String(item.front).trim(),
            back: String(item.back || '').trim(),
            extra: String(item.extra || '').trim(),
            tags: Array.from(new Set([...params.tags, ...itemTags])),
          };
        });
    } catch {
      // Try next model
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      mode?: 'match_suspended' | 'generate_cards' | 'both';
      sourceTitle?: string;
      sourceText?: string;
      concepts?: string[];
      deckFilter?: string;
      tagFilter?: string;
      targetDeck?: string;
      modelName?: 'Cloze' | 'Basic';
      maxMatches?: number;
      maxCards?: number;
      useAiExpansion?: boolean;
    };

    const mode = body.mode || 'match_suspended';
    const combinedText = `${body.sourceTitle || ''}\n${body.sourceText || ''}`.trim();
    if (!combinedText && (!body.concepts || body.concepts.length === 0)) {
      return NextResponse.json(
        { success: false, error: 'Provide sourceTitle, sourceText, or concepts.' },
        { status: 400 }
      );
    }

    const { data: cardsData, error: cErr } = await sb
      .from('anki_cards')
      .select('*')
      .limit(5500);

    if (cErr) {
      if (isMissingAnkiTableError(cErr)) {
        return NextResponse.json({
          success: true,
          needsMigration: true,
          usedTerms: [],
          matches: [],
          draftCards: [],
        });
      }
      return NextResponse.json({ success: false, error: cErr.message }, { status: 500 });
    }

    const allCards = (cardsData || []) as AnkiCard[];
    const expandedConcepts =
      body.useAiExpansion !== false ? await expandMedicalConceptsWithAI(combinedText) : [];

    // 1. Match suspended cards
    const suspendedMatchRes = rankMatchingCards({
      cards: allCards,
      queryText: combinedText,
      explicitConcepts: body.concepts,
      expandedConcepts,
      onlySuspended: true,
      deckFilter: body.deckFilter,
      tagFilter: body.tagFilter,
      limit: body.maxMatches || 25,
    });

    // 2. Also find active matching cards so gap-card generation avoids duplicating already-active cards
    let draftCards: StagedNewCardDraft[] = [];
    if (mode === 'generate_cards' || mode === 'both') {
      const activeMatchRes = rankMatchingCards({
        cards: allCards,
        queryText: combinedText,
        explicitConcepts: body.concepts,
        expandedConcepts,
        onlySuspended: false,
        deckFilter: body.deckFilter,
        limit: 30,
      });

      const existingSnippets = activeMatchRes.matches.map((m) => m.frontSnippet);
      const targetDeck = (body.targetDeck || body.deckFilter || 'Schulich').trim();
      const modelName: 'Cloze' | 'Basic' = body.modelName === 'Basic' ? 'Basic' : 'Cloze';
      const baseSlug = (body.sourceTitle || 'notebooklm')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32);

      const rawDrafts = await generateGapCardsWithAI({
        sourceTitle: body.sourceTitle || 'NotebookLM / Schulich Notes',
        sourceText: body.sourceText || body.sourceTitle || '',
        deckName: targetDeck,
        modelName,
        existingSnippets,
        maxCards: Math.min(20, Math.max(1, body.maxCards || 8)),
        tags: ['source::notebooklm', ...(baseSlug ? [`topic::${baseSlug}`] : [])],
      });

      draftCards = rawDrafts.map((draft) => ({
        ...draft,
        duplicateWarning: findPotentialDuplicateCard(
          stripClozeMarkup(draft.front),
          allCards
        ),
      }));
    }

    return NextResponse.json({
      success: true,
      needsMigration: false,
      totalIndexedCards: allCards.length,
      usedTerms: suspendedMatchRes.usedTerms,
      matches: suspendedMatchRes.matches,
      draftCards,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Anki match failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
