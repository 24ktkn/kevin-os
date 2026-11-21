#!/usr/bin/env node
/**
 * Kevin-OS Windows Anki Background Sync Bridge
 * Zero-dependency Node.js daemon connecting local Anki Desktop (AnkiConnect :8765)
 * with Kevin-OS Cloud (https://kevin-os-xr4m.vercel.app/api/anki/sync).
 *
 * Usage:
 *   node sync.mjs              # Runs continuously in background (polls every 20s)
 *   node sync.mjs --once       # Single full sync & queue drain, then exits
 *   node sync.mjs --local      # Targets http://localhost:3000 instead of production Vercel
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ANKICONNECT_URL = process.env.ANKICONNECT_URL || 'http://127.0.0.1:8765';
const POLL_INTERVAL_MS = 20_000;
const FULL_CARD_SYNC_INTERVAL_MS = 3 * 60_000;
const ANKIWEB_SYNC_INTERVAL_MS = 5 * 60_000;
const BRIDGE_VERSION = '1.0.0';
const TIMEZONE = 'America/New_York';

const args = new Set(process.argv.slice(2));
const RUN_ONCE = args.has('--once');
const USE_LOCAL = args.has('--local');

function loadEnvFile(filePath) {
  const env = {};
  try {
    if (!fs.existsSync(filePath)) return env;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch {
    // ignore
  }
  return env;
}

const webEnv = loadEnvFile(path.resolve(__dirname, '../web/.env.local'));
const bridgeEnv = loadEnvFile(path.resolve(__dirname, '.env'));

function getConfig(key, fallback = '') {
  return process.env[key] || bridgeEnv[key] || webEnv[key] || fallback;
}

const KEVIN_OS_URL = (
  USE_LOCAL
    ? 'http://127.0.0.1:3000'
    : getConfig('KEVIN_OS_URL', 'https://kevin-os-xr4m.vercel.app')
).replace(/\/$/, '');

function computeBridgeToken() {
  const explicit = getConfig('ANKI_BRIDGE_SECRET').trim();
  if (explicit) return explicit;
  const seed =
    getConfig('SUPABASE_SERVICE_ROLE_KEY').trim() ||
    getConfig('GOOGLE_PRIVATE_KEY').trim() ||
    'kevin-os-local-anki-bridge';
  return crypto.createHash('sha256').update(`kevin-os-anki-bridge-v1:${seed}`).digest('hex');
}

const BRIDGE_TOKEN = computeBridgeToken();

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${ts}] [AnkiBridge] ${msg}`);
}

function getProductivityDateStr(now = new Date()) {
  const shifted = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
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

async function ankiInvoke(action, params = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANKICONNECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`AnkiConnect ${action}: ${data.error}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function postToKevinOs(body) {
  const res = await fetch(`${KEVIN_OS_URL}/api/anki/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-anki-bridge-token': BRIDGE_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Kevin-OS sync HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Kevin-OS sync HTTP ${res.status}: ${json.error || text.slice(0, 200)}`);
  }
  return json;
}

function computeStreakFromByDay(byDayRows, todayStr) {
  if (!Array.isArray(byDayRows) || byDayRows.length === 0) return 0;
  const activeDates = new Set();
  for (const row of byDayRows) {
    if (Array.isArray(row) && row[0] && Number(row[1]) > 0) {
      activeDates.add(String(row[0]).slice(0, 10));
    }
  }
  let streak = 0;
  let cursor = activeDates.has(todayStr) ? todayStr : addDays(todayStr, -1);
  while (activeDates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function extractFieldMap(fieldsObj) {
  const out = {};
  if (!fieldsObj || typeof fieldsObj !== 'object') return out;
  for (const [k, v] of Object.entries(fieldsObj)) {
    out[k] = typeof v === 'object' && v !== null && 'value' in v ? String(v.value || '') : String(v || '');
  }
  return out;
}

function computeDueDateForCard(card, todayStr, colTodayDay) {
  // queue === 2 -> review card; due is integer day relative to collection creation day
  if (card.queue === 2 && typeof card.due === 'number' && typeof colTodayDay === 'number') {
    const delta = card.due - colTodayDay;
    if (delta >= -3650 && delta <= 3650) {
      return addDays(todayStr, Math.max(0, delta));
    }
  }
  // queue === 1 or 3 -> learning/relearning (due today)
  if (card.queue === 1 || card.queue === 3) return todayStr;
  return null;
}

async function fetchDeckAndCollectionSnapshot(includeFullCards) {
  const todayStr = getProductivityDateStr();
  const [deckMapObj, reviewsTodayRaw, byDayRaw] = await Promise.all([
    ankiInvoke('deckNamesAndIds', {}, 15_000),
    ankiInvoke('getNumCardsReviewedToday').catch(() => 0),
    ankiInvoke('getNumCardsReviewedByDay').catch(() => []),
  ]);

  const deckEntries = Object.entries(deckMapObj || {});
  const topDecks = deckEntries.map(([name]) => name);
  const idToFullDeckName = new Map();
  for (const [fullName, deckId] of deckEntries) {
    idToFullDeckName.set(String(deckId), fullName);
  }

  // Fetch getDeckStats in chunks of 60 decks so large nested deck trees (180+ decks) never time out
  const deckStatsMap = {};
  for (let i = 0; i < topDecks.length; i += 60) {
    const chunk = topDecks.slice(i, i + 60);
    const partial = await ankiInvoke('getDeckStats', { decks: chunk }, 25_000).catch(() => ({}));
    Object.assign(deckStatsMap, partial || {});
  }

  // AnkiConnect getDeckStats returns short basename in statObj.name — resolve FULL hierarchical name via deck_id!
  const leafDecks = new Set(
    topDecks.filter(
      (d) => !topDecks.some((other) => other !== d && other.startsWith(`${d}::`))
    )
  );
  const deckRowsByName = new Map();
  let reviewDueRemaining = 0;
  let learningRemaining = 0;
  let newRemaining = 0;

  for (const [keyId, statObj] of Object.entries(deckStatsMap || {})) {
    if (!statObj) continue;
    const fullName =
      idToFullDeckName.get(String(statObj.deck_id ?? keyId)) ||
      String(statObj.name || '');
    if (!fullName) continue;

    const nr = Number(statObj.new_count) || 0;
    const lr = Number(statObj.learn_count) || 0;
    const rr = Number(statObj.review_count) || 0;
    deckRowsByName.set(fullName, {
      deck: fullName,
      newRemaining: nr,
      learningRemaining: lr,
      reviewRemaining: rr,
      totalCards: Number(statObj.total_in_deck) || 0,
      suspendedCards: 0,
      matureCards: 0,
      leechCards: 0,
    });

    // Sum only root-level decks (no "::") because Anki's getDeckStats on parent decks already rolls up children accurately
    // (respecting parent deck daily limits!). Fallback to leaf decks if needed.
    if (!fullName.includes('::')) {
      newRemaining += nr;
      learningRemaining += lr;
      reviewDueRemaining += rr;
    }
  }

  // Fetch today's reviewed card ratings to compute real retention % and avg secs/card
  let againCount = 0;
  let hardCount = 0;
  let goodCount = 0;
  let easyCount = 0;
  let matureTotal = 0;
  let maturePassed = 0;
  let studyTimeSecs = 0;
  let newDoneToday = 0;

  try {
    const ratedTodayIds = await ankiInvoke('findCards', { query: 'rated:1' });
    if (Array.isArray(ratedTodayIds) && ratedTodayIds.length > 0) {
      const startOfProdDayMs = Date.now() - 24 * 60 * 60 * 1000;
      const slice = ratedTodayIds.slice(0, 600);
      const revMap = await ankiInvoke('getReviewsOfCards', { cards: slice }, 20_000).catch(() => ({}));
      const seenReviewIds = new Set();

      for (const revList of Object.values(revMap || {})) {
        if (!Array.isArray(revList)) continue;
        for (const r of revList) {
          if (!r || !r.id || seenReviewIds.has(r.id)) continue;
          // Anki review id is epoch ms; filter to today's productivity date
          if (r.id < startOfProdDayMs) continue;
          if (getProductivityDateStr(new Date(r.id)) !== todayStr) continue;
          seenReviewIds.add(r.id);

          const ease = Number(r.ease) || 0;
          const durMs = Math.min(120_000, Math.max(0, Number(r.time) || 0));
          studyTimeSecs += Math.round(durMs / 1000);

          if (ease === 1) againCount += 1;
          else if (ease === 2) hardCount += 1;
          else if (ease === 3) goodCount += 1;
          else if (ease === 4) easyCount += 1;

          if (Number(r.type) === 0) newDoneToday += 1;
          if (Number(r.lastIvl) >= 21) {
            matureTotal += 1;
            if (ease >= 2) maturePassed += 1;
          }
        }
      }
    }
  } catch (err) {
    log(`Warning computing today review ratings: ${err.message}`);
  }

  const totalRated = againCount + hardCount + goodCount + easyCount;
  const reviewsToday = Math.max(Number(reviewsTodayRaw) || 0, totalRated);
  const retentionPct =
    totalRated > 0
      ? Math.round(((hardCount + goodCount + easyCount) / totalRated) * 1000) / 10
      : 0;
  const matureRetentionPct =
    matureTotal > 0 ? Math.round((maturePassed / matureTotal) * 1000) / 10 : retentionPct;
  const avgSecsPerCard =
    reviewsToday > 0 && studyTimeSecs > 0
      ? Math.round((studyTimeSecs / reviewsToday) * 10) / 10
      : 8.5;

  const streakDays = computeStreakFromByDay(byDayRaw, todayStr);

  // Full card mirror + 30-day forecast (3,000-5,000 cards runs in ~1-3 seconds locally!)
  let cards = null;
  let totalCards = 0;
  let activeCards = 0;
  let suspendedCards = 0;
  let matureCards = 0;
  let leechCards = 0;
  const forecastMap = new Map();

  if (includeFullCards) {
    const allCardIds = await ankiInvoke('findCards', { query: 'deck:*' }, 25_000);
    const dueTodayCardIds = await ankiInvoke('findCards', { query: 'is:due -is:suspended' }, 15_000).catch(() => []);
    const dueSet = new Set(Array.isArray(dueTodayCardIds) ? dueTodayCardIds : []);

    const allCardsInfo = [];
    for (let i = 0; i < allCardIds.length; i += 500) {
      const chunk = allCardIds.slice(i, i + 500);
      const info = await ankiInvoke('cardsInfo', { cards: chunk }, 30_000);
      if (Array.isArray(info)) allCardsInfo.push(...info);
    }

    // Estimate collection's current day integer from due review cards
    let colTodayDay = null;
    for (const c of allCardsInfo) {
      if (c.queue === 2 && dueSet.has(c.cardId) && typeof c.due === 'number') {
        if (colTodayDay === null || c.due > colTodayDay) {
          colTodayDay = c.due;
        }
      }
    }

    // Fetch note tags in batches so tags are always 100% accurate
    const uniqueNoteIds = Array.from(new Set(allCardsInfo.map((c) => c.note).filter(Boolean)));
    const noteTagsMap = new Map();
    for (let i = 0; i < uniqueNoteIds.length; i += 500) {
      const chunk = uniqueNoteIds.slice(i, i + 500);
      const notes = await ankiInvoke('notesInfo', { notes: chunk }, 30_000).catch(() => []);
      for (const n of notes || []) {
        if (n && n.noteId) {
          noteTagsMap.set(n.noteId, Array.isArray(n.tags) ? n.tags : []);
        }
      }
    }

    cards = [];
    for (const c of allCardsInfo) {
      totalCards += 1;
      const isSuspended = c.queue === -1;
      const isBuried = c.queue === -2 || c.queue === -3;
      const ivl = Number(c.interval) || 0;
      const lapses = Number(c.lapses) || 0;
      const isMature = !isSuspended && ivl >= 21;
      const isLeech = lapses >= 4;

      if (isSuspended) suspendedCards += 1;
      else activeCards += 1;
      if (isMature) matureCards += 1;
      if (isLeech) leechCards += 1;

      const dRow = deckRowsByName.get(c.deckName);
      if (dRow) {
        if (isSuspended) dRow.suspendedCards += 1;
        if (isMature) dRow.matureCards += 1;
        if (isLeech) dRow.leechCards += 1;
      }

      const dueDate = computeDueDateForCard(c, todayStr, colTodayDay);
      if (!isSuspended && !isBuried && dueDate) {
        const diffDays = Math.round(
          (new Date(`${dueDate}T12:00:00Z`).getTime() - new Date(`${todayStr}T12:00:00Z`).getTime()) /
            86_400_000
        );
        if (diffDays >= 0 && diffDays < 30) {
          forecastMap.set(diffDays, (forecastMap.get(diffDays) || 0) + 1);
        }
      }

      const fieldsMap = extractFieldMap(c.fields);
      const fieldValues = Object.values(fieldsMap);
      const primaryFront =
        fieldsMap.Text ||
        fieldsMap.Front ||
        fieldValues[0] ||
        c.question ||
        '';
      const primaryBack =
        fieldsMap.Back ||
        fieldsMap['Back Extra'] ||
        fieldsMap.Extra ||
        fieldValues[1] ||
        c.answer ||
        '';
      const extraRaw =
        fieldsMap['Back Extra'] ||
        fieldsMap.Extra ||
        fieldsMap.Notes ||
        fieldsMap['Lecture Notes'] ||
        '';

      cards.push({
        card_id: Number(c.cardId),
        note_id: Number(c.note),
        deck_name: String(c.deckName || 'Default'),
        model_name: String(c.modelName || 'Cloze'),
        ord: Number(c.ord) || 0,
        front_html: String(primaryFront),
        back_html: String(primaryBack),
        front_text: stripHtml(primaryFront),
        back_text: stripHtml(primaryBack),
        extra_text: stripHtml(extraRaw),
        fields_json: fieldsMap,
        tags: noteTagsMap.get(c.note) || [],
        suspended: isSuspended,
        buried: isBuried,
        queue: Number(c.queue) || 0,
        card_type: Number(c.type) || 0,
        due_value: Number(c.due) || 0,
        due_date: dueDate,
        interval_days: ivl,
        ease_factor: Number(c.factor) || 2500,
        reps: Number(c.reps) || 0,
        lapses,
      });
    }
  } else {
    for (const [fullName, row] of deckRowsByName.entries()) {
      if (leafDecks.has(fullName)) totalCards += row.totalCards;
    }
  }

  const forecast30d = [];
  for (let offset = 0; offset < 30; offset += 1) {
    forecast30d.push({
      dayOffset: offset,
      date: addDays(todayStr, offset),
      dueCount:
        offset === 0
          ? reviewDueRemaining + learningRemaining
          : forecastMap.get(offset) || 0,
    });
  }

  const deckBreakdown = Array.from(leafDecks)
    .map((name) => deckRowsByName.get(name))
    .filter((d) => d && (d.totalCards > 0 || d.reviewRemaining > 0 || d.learningRemaining > 0 || d.newRemaining > 0))
    .sort(
      (a, b) =>
        b.reviewRemaining + b.learningRemaining - (a.reviewRemaining + a.learningRemaining) ||
        b.totalCards - a.totalCards
    );

  // Build historical 90-day review counts from Anki's getNumCardsReviewedByDay for the Heatmap
  const cutoffDate = addDays(todayStr, -95);
  const historyDays = Array.isArray(byDayRaw)
    ? byDayRaw
        .filter((row) => Array.isArray(row) && row[0] && String(row[0]).slice(0, 10) >= cutoffDate && String(row[0]).slice(0, 10) < todayStr)
        .map((row) => ({
          date: String(row[0]).slice(0, 10),
          reviews_today: Number(row[1]) || 0,
        }))
    : [];

  return {
    stats: {
      date: todayStr,
      reviews_today: reviewsToday,
      new_done_today: newDoneToday,
      review_due_remaining: reviewDueRemaining,
      learning_remaining: learningRemaining,
      new_remaining: newRemaining,
      total_due_remaining: reviewDueRemaining + learningRemaining,
      study_time_secs: studyTimeSecs,
      avg_secs_per_card: avgSecsPerCard,
      retention_pct: retentionPct,
      mature_retention_pct: matureRetentionPct,
      again_count: againCount,
      hard_count: hardCount,
      good_count: goodCount,
      easy_count: easyCount,
      streak_days: streakDays,
      total_cards: totalCards,
      active_cards: activeCards,
      suspended_cards: suspendedCards,
      mature_cards: matureCards,
      leech_cards: leechCards,
      deck_breakdown: deckBreakdown,
      forecast_30d: includeFullCards ? forecast30d : undefined,
    },
    historyDays: includeFullCards ? historyDays : undefined,
    cards,
  };
}

async function resolveModelAndFields(requestedModel, payload) {
  const models = await ankiInvoke('modelNames').catch(() => ['Cloze', 'Basic']);
  const isCloze =
    String(requestedModel || '').toLowerCase().includes('cloze') ||
    /\{\{c\d+::/.test(String(payload.front || payload.text || ''));

  let chosenModel = models.find((m) => m.toLowerCase() === String(requestedModel || '').toLowerCase());
  if (!chosenModel) {
    chosenModel = isCloze
      ? models.find((m) => m.toLowerCase().includes('cloze')) || 'Cloze'
      : models.find((m) => m.toLowerCase() === 'basic') || models[0] || 'Basic';
  }

  const fieldNames = await ankiInvoke('modelFieldNames', { modelName: chosenModel }).catch(() =>
    isCloze ? ['Text', 'Back Extra'] : ['Front', 'Back']
  );

  const fields = {};
  const frontVal = String(payload.front || payload.text || '');
  const backVal = String(payload.back || payload.extra || '');
  const extraVal = String(payload.extra || payload.back || '');

  if (fieldNames.length > 0) {
    if (isCloze) {
      const textField = fieldNames.find((f) => /text|front/i.test(f)) || fieldNames[0];
      const extraField = fieldNames.find((f) => /extra|back/i.test(f) && f !== textField) || fieldNames[1];
      fields[textField] = frontVal;
      if (extraField) fields[extraField] = extraVal;
    } else {
      const frontField = fieldNames.find((f) => /front|question/i.test(f)) || fieldNames[0];
      const backField = fieldNames.find((f) => /back|answer/i.test(f) && f !== frontField) || fieldNames[1];
      const extraField = fieldNames.find((f) => /extra|notes/i.test(f) && f !== frontField && f !== backField);
      fields[frontField] = frontVal;
      if (backField) fields[backField] = backVal;
      if (extraField && payload.extra) fields[extraField] = String(payload.extra);
    }
  }

  return { modelName: chosenModel, fields };
}

async function executeQueuedAction(action) {
  const { action_type: type, payload = {} } = action;

  if (type === 'add_note') {
    const deckName = String(payload.deckName || 'Schulich');
    await ankiInvoke('createDeck', { deck: deckName });
    const { modelName, fields } = await resolveModelAndFields(payload.modelName, payload);
    const tags = Array.isArray(payload.tags) ? payload.tags.map(String) : [];
    const noteId = await ankiInvoke('addNote', {
      note: {
        deckName,
        modelName,
        fields,
        options: { allowDuplicate: false, duplicateScope: 'deck' },
        tags,
      },
    });
    return { noteId, deckName, modelName };
  }

  if (type === 'unsuspend_cards') {
    const cardIds = (Array.isArray(payload.cardIds) ? payload.cardIds : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (cardIds.length === 0) return { unsuspended: 0 };
    await ankiInvoke('unsuspend', { cards: cardIds });
    return { unsuspended: cardIds.length };
  }

  if (type === 'suspend_cards') {
    const cardIds = (Array.isArray(payload.cardIds) ? payload.cardIds : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (cardIds.length === 0) return { suspended: 0 };
    await ankiInvoke('suspend', { cards: cardIds });
    return { suspended: cardIds.length };
  }

  if (type === 'answer_card') {
    const cardId = Number(payload.cardId);
    const ease = Math.min(4, Math.max(1, Number(payload.ease) || 3));
    if (!Number.isFinite(cardId) || cardId <= 0) throw new Error('Invalid cardId');
    await ankiInvoke('answerCards', { answers: [{ cardId, ease }] });
    return { cardId, ease };
  }

  if (type === 'update_tags') {
    const noteIds = (Array.isArray(payload.noteIds) ? payload.noteIds : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (noteIds.length > 0) {
      if (payload.addTags) {
        await ankiInvoke('addTags', { notes: noteIds, tags: String(payload.addTags) });
      }
      if (payload.removeTags) {
        await ankiInvoke('removeTags', { notes: noteIds, tags: String(payload.removeTags) });
      }
    }
    return { updatedNotes: noteIds.length };
  }

  if (type === 'edit_note') {
    const noteId = Number(payload.noteId);
    if (!Number.isFinite(noteId) || noteId <= 0) throw new Error('Invalid noteId');
    await ankiInvoke('updateNoteFields', {
      note: { id: noteId, fields: payload.fields || {} },
    });
    return { noteId };
  }

  if (type === 'trigger_sync') {
    await ankiInvoke('sync', {}, 30_000);
    return { synced: true };
  }

  throw new Error(`Unsupported action_type: ${type}`);
}

let lastFullCardSyncMs = 0;
let lastAnkiWebSyncMs = 0;
let ankiWasOffline = false;

async function runSyncCycle(forceFull = false) {
  // 1. Check AnkiConnect availability
  try {
    await ankiInvoke('version', {}, 4000);
    if (ankiWasOffline) {
      log('Anki Desktop reconnected! Resuming cloud sync.');
      ankiWasOffline = false;
    }
  } catch {
    if (!ankiWasOffline) {
      log('Anki Desktop / AnkiConnect (:8765) is not open — waiting quietly...');
      ankiWasOffline = true;
    }
    return;
  }

  const nowMs = Date.now();

  // 2. Periodic official AnkiWeb sync (pulls iPhone AnkiMobile reviews down!)
  let didAnkiWebSync = false;
  if (forceFull || nowMs - lastAnkiWebSyncMs >= ANKIWEB_SYNC_INTERVAL_MS) {
    try {
      await ankiInvoke('sync', {}, 30_000);
      lastAnkiWebSyncMs = Date.now();
      didAnkiWebSync = true;
    } catch (err) {
      log(`AnkiWeb sync skipped/warning: ${err.message}`);
    }
  }

  // 3. Collect stats (+ full card index every 3 min)
  const doFullCards = forceFull || nowMs - lastFullCardSyncMs >= FULL_CARD_SYNC_INTERVAL_MS;
  const snapshot = await fetchDeckAndCollectionSnapshot(doFullCards);

  // 4. Push stats + historical heatmap days and pull pending cloud actions
  let syncRes = await postToKevinOs({
    bridgeVersion: BRIDGE_VERSION,
    ankiWebSynced: didAnkiWebSync,
    stats: snapshot.stats,
    ...(snapshot.historyDays ? { historyDays: snapshot.historyDays } : {}),
  });

  if (doFullCards && Array.isArray(snapshot.cards)) {
    const CHUNK_SIZE = 400;
    const allIds = snapshot.cards.map((c) => c.card_id);
    for (let i = 0; i < snapshot.cards.length; i += CHUNK_SIZE) {
      const slice = snapshot.cards.slice(i, i + CHUNK_SIZE);
      const isLast = i + CHUNK_SIZE >= snapshot.cards.length;
      await postToKevinOs({
        bridgeVersion: BRIDGE_VERSION,
        cards: slice,
        ...(isLast ? { pruneExceptCardIds: allIds, fullSyncComplete: true } : {}),
      });
    }
    lastFullCardSyncMs = Date.now();
    log(
      `Full mirror synced: ${snapshot.cards.length} cards | today=${snapshot.stats.reviews_today} rev, ${snapshot.stats.total_due_remaining} due, ${snapshot.stats.retention_pct}% ret${syncRes.habitAutoChecked ? ' | Anki Habit AUTO-CHECKED ✅' : ''}`
    );
  } else {
    log(
      `Stats heartbeat: today=${snapshot.stats.reviews_today} rev, ${snapshot.stats.total_due_remaining} due remaining${syncRes.habitAutoChecked ? ' | Anki Habit AUTO-CHECKED ✅' : ''}`
    );
  }

  // 5. Execute any pending cloud actions from Gemini MCP or Kevin-OS /anki UI
  const pending = Array.isArray(syncRes.pendingActions) ? syncRes.pendingActions : [];
  if (pending.length > 0) {
    log(`Applying ${pending.length} queued cloud action(s) to Anki...`);
    const results = [];
    for (const act of pending) {
      try {
        const resObj = await executeQueuedAction(act);
        results.push({ id: act.id, status: 'applied', result: resObj });
        log(`  ✓ ${act.action_type} (${act.id.slice(0, 8)})`);
      } catch (err) {
        results.push({ id: act.id, status: 'failed', error: err.message });
        log(`  ✗ ${act.action_type} (${act.id.slice(0, 8)}): ${err.message}`);
      }
    }

    // Trigger official AnkiWeb sync so iPhone AnkiMobile receives the new/unsuspended cards immediately
    try {
      await ankiInvoke('sync', {}, 30_000);
      lastAnkiWebSyncMs = Date.now();
    } catch (err) {
      log(`Post-action AnkiWeb sync warning: ${err.message}`);
    }

    // Refresh stats & report action statuses back to Kevin-OS
    const postSnap = await fetchDeckAndCollectionSnapshot(false);
    syncRes = await postToKevinOs({
      bridgeVersion: BRIDGE_VERSION,
      ankiWebSynced: true,
      stats: postSnap.stats,
      actionResults: results,
    });
    // Force full card refresh on next cycle to mirror newly added note IDs/card IDs cleanly
    lastFullCardSyncMs = 0;
  }
}

async function main() {
  log(`Starting Kevin-OS Anki Bridge v${BRIDGE_VERSION}`);
  log(`Target Kevin-OS: ${KEVIN_OS_URL}`);
  log(`Local AnkiConnect: ${ANKICONNECT_URL}`);

  if (RUN_ONCE) {
    await runSyncCycle(true);
    return;
  }

  // Continuous loop
  while (true) {
    try {
      await runSyncCycle(false);
    } catch (err) {
      log(`Sync cycle error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('[AnkiBridge] Fatal error:', err);
  process.exit(1);
});
