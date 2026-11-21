import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { mirrorHabitToSheets } from '@/lib/google-sheets';
import { addDaysToDateStr, getProductivityDateStr, getTodayDateStr } from '@/lib/date-utils';
import {
  AnkiCard,
  AnkiDailyStats,
  AnkiForecastPoint,
  BiometricRetentionPoint,
  BiometricsRetentionInsights,
  ExamPacingProjection,
  ExamTarget,
  StagedCardMatchRef,
} from '@/types/anki';

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'have', 'are', 'was',
  'were', 'been', 'will', 'would', 'could', 'should', 'about', 'after', 'before', 'between',
  'which', 'their', 'there', 'these', 'those', 'what', 'when', 'where', 'how', 'why', 'who',
  'approach', 'module', 'lecture', 'review', 'optional', 'flag', 'week', 'min', 'mins', 'part',
  'introduction', 'overview', 'clinical', 'case', 'patient', 'patients', 'disease', 'syndrome',
  'study', 'notes', 'summary', 'concept', 'concepts', 'most', 'common', 'causes', 'treatment',
  'diagnosis', 'management', 'also', 'more', 'than', 'only', 'such', 'other', 'used', 'using',
]);

export function computeAnkiBridgeToken(): string {
  const explicit = process.env.ANKI_BRIDGE_SECRET?.trim();
  if (explicit) return explicit;
  const seed =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.GOOGLE_PRIVATE_KEY?.trim() ||
    'kevin-os-local-anki-bridge';
  return crypto.createHash('sha256').update(`kevin-os-anki-bridge-v1:${seed}`).digest('hex');
}

export function verifyAnkiBridgeRequest(req: NextRequest): boolean {
  const headerToken =
    req.headers.get('x-anki-bridge-token')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  if (!headerToken) return false;

  const expected = computeAnkiBridgeToken();
  const a = Buffer.from(headerToken, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;

  const explicit = process.env.ANKI_BRIDGE_SECRET?.trim();
  if (explicit) {
    const c = Buffer.from(explicit, 'utf8');
    if (a.length === c.length && crypto.timingSafeEqual(a, c)) return true;
  }
  return false;
}

export function isMissingAnkiTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  const msg = String(e.message || '');
  return (
    e.code === '42P01' ||
    e.code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('Could not find the table') ||
    msg.includes('schema cache')
  );
}

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripClozeMarkup(text: string): string {
  if (!text) return '';
  return text.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1');
}

export function isClozeText(text: string): boolean {
  return /\{\{c\d+::[\s\S]+?\}\}/.test(text || '');
}

/**
 * Renders Anki cloze markup for question side (blanks active cloze `ord + 1`, reveals others)
 * or answer side (highlights active cloze `ord + 1`).
 */
export function renderClozeSide(
  rawText: string,
  ord: number,
  side: 'question' | 'answer'
): string {
  const activeNum = Math.max(1, (ord || 0) + 1);
  return (rawText || '').replace(
    /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g,
    (_match, numStr: string, answer: string, hint?: string) => {
      const n = parseInt(numStr, 10);
      if (n !== activeNum) return answer;
      if (side === 'question') {
        return hint && hint.trim() ? `[ ${hint.trim()} ]` : '[ ... ]';
      }
      return `【${answer}】`;
    }
  );
}

/**
 * Computes recommended Anki review block duration(s) for today based on remaining due cards
 * and Kevin's real average seconds/card. Rounds cleanly up to 15-minute increments, and
 * splits heavy days (>45 mins) into 2 sessions when `allowSplit` is true.
 */
export function computeAnkiStudyPlan(params: {
  reviewDueRemaining: number;
  learningRemaining: number;
  newRemaining?: number;
  includeNewCards?: boolean;
  avgSecsPerCard?: number;
  allowSplit?: boolean;
}): {
  targetCards: number;
  rawEstimatedMins: number;
  totalBlockMins: number;
  blocks: Array<{ label: string; durationMins: number; estimatedCards: number }>;
} {
  const baseDue = Math.max(0, (params.reviewDueRemaining || 0) + (params.learningRemaining || 0));
  const extraNew = params.includeNewCards ? Math.max(0, params.newRemaining || 0) : 0;
  const targetCards = baseDue + extraNew;
  const secsPerCard = Math.min(45, Math.max(3, Number(params.avgSecsPerCard) || 8.5));

  if (targetCards === 0) {
    return {
      targetCards: 0,
      rawEstimatedMins: 0,
      totalBlockMins: 0,
      blocks: [],
    };
  }

  const rawEstimatedMins = Math.max(5, Math.ceil((targetCards * secsPerCard) / 60));
  // Round up to nearest 15 mins (minimum 15 mins)
  const totalBlockMins = Math.max(15, Math.ceil(rawEstimatedMins / 15) * 15);

  if (params.allowSplit !== false && totalBlockMins > 45) {
    const firstHalfMins = Math.ceil(totalBlockMins / 2 / 15) * 15;
    const secondHalfMins = Math.max(15, totalBlockMins - firstHalfMins);
    const firstCards = Math.round((targetCards * firstHalfMins) / (firstHalfMins + secondHalfMins));
    const secondCards = Math.max(1, targetCards - firstCards);
    return {
      targetCards,
      rawEstimatedMins,
      totalBlockMins: firstHalfMins + secondHalfMins,
      blocks: [
        {
          label: `Anki Reviews Part 1 (${firstCards} cards)`,
          durationMins: firstHalfMins,
          estimatedCards: firstCards,
        },
        {
          label: `Anki Reviews Part 2 (${secondCards} cards)`,
          durationMins: secondHalfMins,
          estimatedCards: secondCards,
        },
      ],
    };
  }

  return {
    targetCards,
    rawEstimatedMins,
    totalBlockMins,
    blocks: [
      {
        label: `Anki Reviews (${targetCards} cards)`,
        durationMins: totalBlockMins,
        estimatedCards: targetCards,
      },
    ],
  };
}

/**
 * Automatically checks off Kevin's daily 'Anki' habit in Supabase + Google Sheets
 * once today's review + learning cards due reach 0 (after at least 1 review completed),
 * or meets custom min_reviews threshold if configured.
 */
export async function maybeAutoCompleteAnkiHabit(stats: {
  date?: string;
  reviews_today: number;
  review_due_remaining: number;
  learning_remaining: number;
}): Promise<{ checkedOff: boolean; reason: string }> {
  const sb = supabaseAdmin || supabase;
  if (!sb) return { checkedOff: false, reason: 'Supabase unavailable' };

  const todayStr = stats.date || getProductivityDateStr();
  let rule: 'zero_review_learning' | 'min_reviews' = 'zero_review_learning';
  let minReviews = 50;

  try {
    const { data: stateRow } = await sb
      .from('anki_sync_state')
      .select('auto_habit_rule, auto_habit_min_reviews')
      .eq('id', 'default')
      .maybeSingle();
    if (stateRow?.auto_habit_rule === 'min_reviews') {
      rule = 'min_reviews';
      minReviews = Math.max(1, Number(stateRow.auto_habit_min_reviews) || 50);
    }
  } catch {
    // Use default zero_review_learning
  }

  const meetsRule =
    rule === 'min_reviews'
      ? stats.reviews_today >= minReviews
      : stats.reviews_today > 0 &&
        stats.review_due_remaining === 0 &&
        stats.learning_remaining === 0;

  if (!meetsRule) {
    return {
      checkedOff: false,
      reason:
        rule === 'min_reviews'
          ? `Reviewed ${stats.reviews_today}/${minReviews} cards.`
          : `Remaining due: ${stats.review_due_remaining} reviews + ${stats.learning_remaining} learning.`,
    };
  }

  try {
    const { data: existingHabit } = await sb
      .from('habits')
      .select('date, wake_up_on_time, gym_workout, journaling, anki')
      .eq('date', todayStr)
      .maybeSingle();

    if (existingHabit?.anki === true) {
      return { checkedOff: true, reason: 'Already checked off for today.' };
    }

    const updatedRow = {
      date: todayStr,
      wake_up_on_time: Boolean(existingHabit?.wake_up_on_time),
      gym_workout: Boolean(existingHabit?.gym_workout),
      journaling: Boolean(existingHabit?.journaling),
      anki: true,
    };

    const { error: upsertErr } = await sb.from('habits').upsert(updatedRow, { onConflict: 'date' });
    if (upsertErr) {
      return { checkedOff: false, reason: `Habit upsert failed: ${upsertErr.message}` };
    }

    mirrorHabitToSheets(todayStr, 'Anki', true).catch((e) =>
      console.warn('Anki auto-habit Sheets mirror failed:', e)
    );

    return {
      checkedOff: true,
      reason: `Auto-checked Anki habit for ${todayStr} (${stats.reviews_today} reviews done, 0 review+learning due).`,
    };
  } catch (err) {
    return {
      checkedOff: false,
      reason: err instanceof Error ? err.message : 'Auto-habit check error',
    };
  }
}

export function extractKeywords(text: string): string[] {
  const clean = stripClozeMarkup(stripHtml(text || ''))
    .toLowerCase()
    .replace(/\(\s*\d+\s*(?:mins?|minutes?)\s*\)/gi, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ');

  const rawTokens = clean.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const counts = new Map<string, number>();
  for (const tok of rawTokens) {
    counts.set(tok, (counts.get(tok) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word)
    .slice(0, 40);
}

/**
 * Calls Gemini Flash Lite quickly (6s timeout) to expand a lecture title or NotebookLM summary
 * into high-signal medical keywords, drug names, organisms, pathways, and synonyms.
 */
export async function expandMedicalConceptsWithAI(
  sourceText: string
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !sourceText.trim()) return [];

  const truncated = sourceText.slice(0, 8000);
  const prompt = `You are a medical school Anki card matcher for a Western University (Schulich) medical student.
Extract 12 to 25 specific, high-yield medical search terms, diseases, mechanisms, biomarkers, drug names/classes, organisms, and close synonyms from this lecture title or study notes so we can match existing suspended Anki cards.
Avoid generic words like "approach", "patient", "treatment", "diagnosis", "module", "clinical".
Return ONLY a raw JSON array of lowercase strings (1-3 words each).

CONTENT:
${truncated}`;

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
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
      if (Array.isArray(parsed)) {
        return parsed
          .map((s) => String(s || '').trim().toLowerCase())
          .filter((s) => s.length >= 3 && !STOPWORDS.has(s))
          .slice(0, 28);
      }
    } catch {
      // Try next model
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

/**
 * Scores suspended (or all) Anki cards against a source lecture / NotebookLM summary / concept list.
 * Fast in-memory scoring handles 3,000-5,000 cards in <25ms.
 */
export function rankMatchingCards(params: {
  cards: AnkiCard[];
  queryText: string;
  explicitConcepts?: string[];
  expandedConcepts?: string[];
  onlySuspended?: boolean;
  deckFilter?: string;
  tagFilter?: string;
  limit?: number;
}): {
  usedTerms: string[];
  matches: StagedCardMatchRef[];
} {
  const limit = Math.min(80, Math.max(1, params.limit || 25));
  const baseKeywords = extractKeywords(params.queryText);
  const allTermsSet = new Set<string>();

  for (const c of params.explicitConcepts || []) {
    const norm = c.trim().toLowerCase();
    if (norm.length >= 3 && !STOPWORDS.has(norm)) allTermsSet.add(norm);
  }
  for (const c of params.expandedConcepts || []) {
    const norm = c.trim().toLowerCase();
    if (norm.length >= 3 && !STOPWORDS.has(norm)) allTermsSet.add(norm);
  }
  for (const k of baseKeywords) {
    allTermsSet.add(k);
  }

  const usedTerms = Array.from(allTermsSet).slice(0, 45);
  if (usedTerms.length === 0) {
    return { usedTerms: [], matches: [] };
  }

  const deckFilterLower = (params.deckFilter || '').trim().toLowerCase();
  const tagFilterLower = (params.tagFilter || '').trim().toLowerCase();

  const scored: Array<{ card: AnkiCard; score: number; matchedTerms: string[] }> = [];

  for (const card of params.cards) {
    if (params.onlySuspended !== false && !card.suspended) continue;
    if (deckFilterLower && !card.deck_name.toLowerCase().includes(deckFilterLower)) continue;
    if (
      tagFilterLower &&
      !(card.tags || []).some((t) => t.toLowerCase().includes(tagFilterLower))
    ) {
      continue;
    }

    const frontLower = stripClozeMarkup(card.front_text || '').toLowerCase();
    const backLower = stripClozeMarkup(card.back_text || '').toLowerCase();
    const extraLower = stripClozeMarkup(card.extra_text || '').toLowerCase();
    const tagsLower = (card.tags || []).join(' ').toLowerCase();
    const deckLower = (card.deck_name || '').toLowerCase();

    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of usedTerms) {
      const isPhrase = term.includes(' ');
      const weight = isPhrase ? 3.2 : term.length >= 7 ? 2.0 : 1.3;
      let hit = false;

      if (frontLower.includes(term)) {
        score += weight * 2.2;
        hit = true;
      } else if (backLower.includes(term)) {
        score += weight * 1.6;
        hit = true;
      } else if (extraLower.includes(term)) {
        score += weight * 1.0;
        hit = true;
      }

      if (tagsLower.includes(term) || deckLower.includes(term)) {
        score += weight * 1.4;
        hit = true;
      }

      if (hit) matchedTerms.push(term);
    }

    if (matchedTerms.length === 0) continue;
    // Bonus for hitting multiple distinct concepts
    if (matchedTerms.length >= 2) score += matchedTerms.length * 1.5;

    scored.push({ card, score, matchedTerms: matchedTerms.slice(0, 8) });
  }

  scored.sort((a, b) => b.score - a.score || b.matchedTerms.length - a.matchedTerms.length);

  const maxScore = scored[0]?.score || 1;
  const matches: StagedCardMatchRef[] = scored.slice(0, limit).map(({ card, score, matchedTerms }) => {
    const snippetSource = stripClozeMarkup(card.front_text || card.back_text || '').trim();
    return {
      cardId: card.card_id,
      noteId: card.note_id,
      deckName: card.deck_name,
      frontSnippet: snippetSource.length > 180 ? `${snippetSource.slice(0, 177)}...` : snippetSource,
      tags: card.tags || [],
      matchScore: Math.min(99, Math.max(15, Math.round((score / maxScore) * 100))),
      matchedTerms,
    };
  });

  return { usedTerms, matches };
}

/**
 * Checks whether a draft card closely duplicates an existing card in Kevin's collection.
 */
export function findPotentialDuplicateCard(
  draftFront: string,
  existingCards: Pick<AnkiCard, 'card_id' | 'front_text' | 'deck_name'>[]
): string | null {
  const draftTokens = new Set(extractKeywords(draftFront));
  if (draftTokens.size < 3) return null;

  for (const card of existingCards) {
    const existingTokens = extractKeywords(card.front_text);
    if (existingTokens.length < 3) continue;
    let overlap = 0;
    for (const t of existingTokens) {
      if (draftTokens.has(t)) overlap += 1;
    }
    const jaccard = overlap / (draftTokens.size + existingTokens.length - overlap);
    if (jaccard >= 0.62) {
      const preview = stripClozeMarkup(card.front_text).slice(0, 90);
      return `Possible duplicate in "${card.deck_name}": "${preview}..."`;
    }
  }
  return null;
}

/**
 * Computes Exam Countdown, Daily New-Card Pacing, and a 30-day Projected Review Burden Curve
 * combining real due dates from active cards + simulated FSRS/SM-2 follow-up reviews from
 * introducing `recommendedNewPerDay` new cards each day.
 */
export function computeExamPacing(params: {
  target: ExamTarget;
  cards: Pick<AnkiCard, 'deck_name' | 'tags' | 'suspended' | 'queue' | 'due_date' | 'interval_days'>[];
  baselineForecast?: AnkiForecastPoint[];
  todayStr?: string;
}): ExamPacingProjection {
  const todayStr = params.todayStr || getTodayDateStr();
  const bufferDays = Math.max(0, Math.min(14, params.target.bufferDays ?? 3));

  const todayMs = new Date(`${todayStr}T12:00:00Z`).getTime();
  const examMs = new Date(`${params.target.examDate}T12:00:00Z`).getTime();
  const daysUntilExam = Math.max(0, Math.round((examMs - todayMs) / 86_400_000));
  const studyDaysLeft = Math.max(1, daysUntilExam - bufferDays);

  const deckNeedle = (params.target.deckFilter || '').trim().toLowerCase();
  const tagNeedle = (params.target.tagFilter || '').trim().toLowerCase();

  const matching = params.cards.filter((c) => {
    if (deckNeedle && !c.deck_name.toLowerCase().includes(deckNeedle)) return false;
    if (tagNeedle && !(c.tags || []).some((t) => t.toLowerCase().includes(tagNeedle))) return false;
    return true;
  });

  let suspendedCards = 0;
  let newCards = 0;
  let activeCards = 0;
  let matureCards = 0;

  const dueByOffset = new Map<number, number>();

  for (const c of matching) {
    if (c.suspended || c.queue === -1) {
      suspendedCards += 1;
    } else if (c.queue === 0) {
      newCards += 1;
    } else {
      activeCards += 1;
      if ((c.interval_days || 0) >= 21) matureCards += 1;
      if (c.due_date) {
        const dMs = new Date(`${c.due_date}T12:00:00Z`).getTime();
        const offset = Math.max(0, Math.round((dMs - todayMs) / 86_400_000));
        if (offset < 30) {
          dueByOffset.set(offset, (dueByOffset.get(offset) || 0) + 1);
        }
      }
    }
  }

  // Fallback to collection forecast_30d when unfiltered and card due_dates aren't populated yet
  if (dueByOffset.size === 0 && !deckNeedle && !tagNeedle && params.baselineForecast) {
    for (const pt of params.baselineForecast) {
      if (pt.dayOffset >= 0 && pt.dayOffset < 30) {
        dueByOffset.set(pt.dayOffset, pt.dueCount);
      }
    }
  }

  const cardsToUnlock = suspendedCards + newCards;
  const recommendedNewPerDay =
    cardsToUnlock > 0 ? Math.ceil(cardsToUnlock / studyDaysLeft) : 0;

  // Simulate 30-day review burden curve
  // Typical FSRS/SM-2 re-appearance offsets for each newly introduced card: +1d, +3d, +7d, +15d, +28d
  const followUpOffsets = [1, 3, 7, 15, 28];
  const simulatedFollowUps = new Array<number>(30).fill(0);
  const newIntroducedPerDay = new Array<number>(30).fill(0);

  let remainingNew = cardsToUnlock;
  const maxIntroduceDay = Math.min(30, studyDaysLeft);
  for (let d = 0; d < maxIntroduceDay; d++) {
    const todayIntro = Math.min(remainingNew, recommendedNewPerDay);
    newIntroducedPerDay[d] = todayIntro;
    remainingNew -= todayIntro;
    for (const step of followUpOffsets) {
      const targetDay = d + step;
      if (targetDay < 30) {
        // Account for ~10% lapse re-review multiplier
        simulatedFollowUps[targetDay] += Math.round(todayIntro * 1.08);
      }
    }
  }

  let peakDailyReviews = 0;
  const burdenCurve = [];
  for (let d = 0; d < 30; d++) {
    const baselineDue = dueByOffset.get(d) || 0;
    const projectedNewReviews = simulatedFollowUps[d] || 0;
    const newIntroduced = newIntroducedPerDay[d] || 0;
    const totalProjected = baselineDue + projectedNewReviews + newIntroduced;
    if (totalProjected > peakDailyReviews) peakDailyReviews = totalProjected;

    burdenCurve.push({
      dayOffset: d,
      date: addDaysToDateStr(todayStr, d),
      baselineDue,
      projectedNewReviews,
      newIntroduced,
      totalProjected,
    });
  }

  return {
    target: params.target,
    daysUntilExam,
    studyDaysLeft,
    totalMatchingCards: matching.length,
    suspendedCards,
    newCards,
    activeCards,
    matureCards,
    cardsToUnlock,
    recommendedNewPerDay,
    peakDailyReviews,
    burdenCurve,
  };
}

/**
 * Joins Anki daily retention/speed stats with Kevin-OS health_metrics (Sleep hours, HRV, RHR, Steps)
 * to surface actionable cognitive-performance insights on /anki.
 */
export function computeBiometricsRetentionInsights(
  ankiRows: Array<Pick<AnkiDailyStats, 'date' | 'retention_pct' | 'avg_secs_per_card' | 'reviews_today'>>,
  healthRows: Array<{
    date: string;
    sleep_hours?: number | null;
    hrv?: number | null;
    rhr?: number | null;
    steps?: number | null;
  }>
): BiometricsRetentionInsights {
  const healthByDate = new Map(healthRows.map((h) => [String(h.date).slice(0, 10), h]));
  const points: BiometricRetentionPoint[] = [];

  for (const a of ankiRows) {
    if (!a.reviews_today || a.reviews_today < 10) continue;
    const h = healthByDate.get(String(a.date).slice(0, 10));
    if (!h) continue;
    const sleepHours = h.sleep_hours && Number(h.sleep_hours) > 0 ? Number(h.sleep_hours) : null;
    const hrv = h.hrv && Number(h.hrv) > 0 ? Number(h.hrv) : null;
    const rhr = h.rhr && Number(h.rhr) > 0 ? Number(h.rhr) : null;
    const steps = h.steps && Number(h.steps) > 0 ? Number(h.steps) : null;
    if (sleepHours === null && hrv === null) continue;

    points.push({
      date: a.date,
      retentionPct: Math.round(Number(a.retention_pct || 0) * 10) / 10,
      avgSecsPerCard: Math.round(Number(a.avg_secs_per_card || 8.5) * 10) / 10,
      reviewsToday: a.reviews_today,
      sleepHours,
      hrv,
      rhr,
      steps,
    });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));

  const avg = (nums: number[]) =>
    nums.length > 0 ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10 : null;

  const goodSleep = points.filter((p) => p.sleepHours !== null && p.sleepHours >= 7.0);
  const lowSleep = points.filter((p) => p.sleepHours !== null && p.sleepHours < 7.0);

  const avgRetentionGoodSleep = avg(goodSleep.map((p) => p.retentionPct));
  const avgRetentionLowSleep = avg(lowSleep.map((p) => p.retentionPct));
  const avgSpeedGoodSleep = avg(goodSleep.map((p) => p.avgSecsPerCard));
  const avgSpeedLowSleep = avg(lowSleep.map((p) => p.avgSecsPerCard));

  const hrvValues = points
    .map((p) => p.hrv)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const medianHrv = hrvValues.length > 0 ? hrvValues[Math.floor(hrvValues.length / 2)] : null;

  const highHrv = medianHrv !== null ? points.filter((p) => p.hrv !== null && p.hrv >= medianHrv) : [];
  const lowHrv = medianHrv !== null ? points.filter((p) => p.hrv !== null && p.hrv < medianHrv) : [];

  const avgRetentionHighHrv = avg(highHrv.map((p) => p.retentionPct));
  const avgRetentionLowHrv = avg(lowHrv.map((p) => p.retentionPct));

  const takeaways: string[] = [];
  if (avgRetentionGoodSleep !== null && avgRetentionLowSleep !== null) {
    const diff = Math.round((avgRetentionGoodSleep - avgRetentionLowSleep) * 10) / 10;
    takeaways.push(
      diff >= 0
        ? `Sleep >= 7h boosts retention by +${diff}% (${avgRetentionGoodSleep}% vs ${avgRetentionLowSleep}% on <7h sleep).`
        : `Retention stayed resilient across sleep ranges (${avgRetentionGoodSleep}% on >=7h vs ${avgRetentionLowSleep}% on <7h).`
    );
  }
  if (avgSpeedGoodSleep !== null && avgSpeedLowSleep !== null) {
    const speedDiff = Math.round((avgSpeedLowSleep - avgSpeedGoodSleep) * 10) / 10;
    if (speedDiff > 0.3) {
      takeaways.push(
        `You review ${speedDiff}s/card faster after >=7h sleep (${avgSpeedGoodSleep}s vs ${avgSpeedLowSleep}s/card).`
      );
    }
  }
  if (avgRetentionHighHrv !== null && avgRetentionLowHrv !== null && medianHrv !== null) {
    const hrvDiff = Math.round((avgRetentionHighHrv - avgRetentionLowHrv) * 10) / 10;
    takeaways.push(
      `High-HRV days (>=${medianHrv}ms) average ${avgRetentionHighHrv}% retention vs ${avgRetentionLowHrv}% on lower-HRV days (${hrvDiff >= 0 ? '+' : ''}${hrvDiff}%).`
    );
  }
  if (takeaways.length === 0) {
    takeaways.push(
      'Sync at least 2–3 days of Anki reviews alongside your Health Tracker data to unlock Sleep & HRV retention correlations.'
    );
  }

  return {
    pairedDays: points.length,
    points,
    avgRetentionGoodSleep,
    avgRetentionLowSleep,
    avgSpeedGoodSleep,
    avgSpeedLowSleep,
    avgRetentionHighHrv,
    avgRetentionLowHrv,
    medianHrv,
    takeaways,
  };
}
