'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  Eye,
  Keyboard,
  Layers,
  PauseCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { AnkiCard } from '@/types/anki';

interface AnkiReviewerProps {
  availableDecks: string[];
  initialDeck?: string;
  bridgeOnline: boolean;
  onReviewSubmitted: (habitAutoChecked?: boolean) => void;
}

function renderClozeLocal(text: string, ord: number, showAnswer: boolean): React.ReactNode {
  const activeNum = Math.max(1, (ord || 0) + 1);
  const regex = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text || '')) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }
    const num = parseInt(match[1], 10);
    const ans = match[2];
    const hint = match[3];
    if (num === activeNum) {
      if (showAnswer) {
        parts.push(
          <span
            key={key++}
            className="px-1.5 py-0.5 mx-0.5 rounded bg-cyan-500/25 text-cyan-200 border border-cyan-400/50 font-semibold"
          >
            {ans}
          </span>
        );
      } else {
        parts.push(
          <span
            key={key++}
            className="px-2 py-0.5 mx-0.5 rounded bg-indigo-500/25 text-indigo-200 border border-indigo-400/50 font-mono text-sm"
          >
            {hint && hint.trim() ? `[ ${hint.trim()} ]` : '[ ... ]'}
          </span>
        );
      }
    } else {
      parts.push(<span key={key++}>{ans}</span>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < (text || '').length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

export default function AnkiReviewer({
  availableDecks,
  initialDeck = 'ALL',
  bridgeOnline,
  onReviewSubmitted,
}: AnkiReviewerProps) {
  const [selectedDeck, setSelectedDeck] = useState<string>(initialDeck);
  const [queue, setQueue] = useState<AnkiCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);
  const [habitToast, setHabitToast] = useState(false);
  const cardShownAtRef = useRef<number>(0);

  const loadDueQueue = useCallback(async (deckName: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ dueQueue: 'true', limit: '100' });
      if (deckName && deckName !== 'ALL') qs.set('deck', deckName);
      const res = await fetch(`/api/anki/cards?${qs.toString()}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.cards)) {
        setQueue(data.cards);
        setRevealed(false);
        cardShownAtRef.current = Date.now();
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadDueQueue(selectedDeck);
    }, 0);
    return () => clearTimeout(t);
  }, [selectedDeck, loadDueQueue]);

  const currentCard = queue[0] || null;
  const isCloze = Boolean(
    currentCard &&
      (currentCard.model_name.toLowerCase().includes('cloze') ||
        /\{\{c\d+::/.test(currentCard.front_text || ''))
  );

  const handleAnswer = useCallback(
    async (ease: 1 | 2 | 3 | 4) => {
      if (!currentCard || submitting) return;
      setSubmitting(true);
      const elapsedSecs = Math.max(
        1,
        Math.min(120, Math.round((Date.now() - (cardShownAtRef.current || Date.now())) / 1000))
      );

      try {
        const res = await fetch('/api/anki/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'answer_card',
            cardId: currentCard.card_id,
            ease,
            durationSecs: elapsedSecs,
            source: 'kevin_os_ui',
          }),
        });
        const data = await res.json();

        setQueue((prev) => {
          const rest = prev.slice(1);
          // Re-queue "Again" cards in this session just like Anki!
          return ease === 1 ? [...rest, currentCard] : rest;
        });
        setRevealed(false);
        setSessionDone((n) => n + 1);
        cardShownAtRef.current = Date.now();

        if (data.habitAutoChecked) {
          setHabitToast(true);
        }
        onReviewSubmitted(Boolean(data.habitAutoChecked));
      } finally {
        setSubmitting(false);
      }
    },
    [currentCard, submitting, onReviewSubmitted]
  );

  const handleSuspendCurrent = async () => {
    if (!currentCard || submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/anki/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suspend',
          cardIds: [currentCard.card_id],
          source: 'kevin_os_ui',
        }),
      });
      setQueue((prev) => prev.slice(1));
      setRevealed(false);
      cardShownAtRef.current = Date.now();
      onReviewSubmitted(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard shortcuts: Space to reveal, 1/2/3/4 to rate
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!currentCard) return;

      if (e.code === 'Space' && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        handleAnswer(parseInt(e.key, 10) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentCard, revealed, handleAnswer]);

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-[#121218] border border-zinc-800/90">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Layers className="h-4 w-4 text-cyan-400" />
            <span>Deck:</span>
          </div>
          <select
            value={selectedDeck}
            onChange={(e) => setSelectedDeck(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">All Due Decks ({queue.length} loaded)</option>
            {availableDecks.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <span className="text-xs font-mono text-emerald-300 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25">
            {sessionDone} done this session · {queue.length} left
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <span
            className={`px-2 py-0.5 rounded-full border ${
              bridgeOnline
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
            }`}
          >
            {bridgeOnline ? 'Live Sync via AnkiConnect' : 'Offline Queue Mode (syncs when PC wakes)'}
          </span>
          <button
            onClick={() => loadDueQueue(selectedDeck)}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 cursor-pointer"
            title="Refresh due queue"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {habitToast && (
        <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 text-xs flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            All scheduled Review + Learning cards due today are complete! Your daily <strong>Anki</strong> habit has been automatically checked off.
          </span>
        </div>
      )}

      {/* Study Stage */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 rounded-2xl bg-[#121218] border border-zinc-800/90">
          <RefreshCw className="h-7 w-7 text-cyan-400 animate-spin" />
          <p className="text-xs text-zinc-400">Loading due cards from Kevin-OS mirror...</p>
        </div>
      ) : !currentCard ? (
        <div className="py-20 text-center rounded-2xl bg-[#121218] border border-dashed border-emerald-500/30 space-y-2">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
          <h3 className="text-base font-semibold text-white">Deck Caught Up!</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            No due Review or Learning cards remaining in this filter. Great work!
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-800 bg-[#121218] overflow-hidden shadow-xl">
          {/* Card Header */}
          <div className="px-5 py-3 border-b border-zinc-800/80 bg-[#0F0F15] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono text-[10px]">
                {currentCard.model_name}
              </span>
              <span className="text-zinc-300 font-medium truncate">{currentCard.deck_name}</span>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-zinc-500">
              <span>Reps: {currentCard.reps}</span>
              <span>Lapses: {currentCard.lapses}</span>
              <button
                onClick={handleSuspendCurrent}
                disabled={submitting}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-zinc-400 hover:text-amber-300 hover:bg-amber-500/10 border border-zinc-800 transition cursor-pointer"
                title="Suspend this card"
              >
                <PauseCircle className="h-3.5 w-3.5" /> Suspend
              </button>
            </div>
          </div>

          {/* Card Body */}
          <div className="p-6 sm:p-10 min-h-[260px] flex flex-col justify-center space-y-6">
            <div className="text-base sm:text-lg leading-relaxed text-white whitespace-pre-wrap">
              {isCloze
                ? renderClozeLocal(currentCard.front_text, currentCard.ord, revealed)
                : currentCard.front_text}
            </div>

            {revealed && (
              <div className="pt-5 border-t border-zinc-800 space-y-4 animate-fadeIn">
                {!isCloze && currentCard.back_text && (
                  <div className="text-base leading-relaxed text-cyan-100 whitespace-pre-wrap">
                    {currentCard.back_text}
                  </div>
                )}
                {currentCard.extra_text && (
                  <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-xs sm:text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-300 mb-1">
                      Extra / Clinical Pearl
                    </div>
                    {currentCard.extra_text}
                  </div>
                )}
                {currentCard.tags && currentCard.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {currentCard.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-900 text-zinc-400 border border-zinc-800"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="px-5 py-4 border-t border-zinc-800/80 bg-[#0F0F15] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-[11px] text-zinc-500 flex items-center gap-1.5">
              <Keyboard className="h-3.5 w-3.5" />
              <span>Shortcuts: Space = Reveal · 1 Again · 2 Hard · 3 Good · 4 Easy</span>
            </div>

            {!revealed ? (
              <button
                onClick={() => setRevealed(true)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-md shadow-cyan-500/20 transition cursor-pointer"
              >
                <Eye className="h-4 w-4" />
                <span>Show Answer (Space)</span>
              </button>
            ) : (
              <div className="w-full sm:w-auto grid grid-cols-4 gap-2">
                <button
                  onClick={() => handleAnswer(1)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold transition cursor-pointer"
                >
                  1 · Again
                </button>
                <button
                  onClick={() => handleAnswer(2)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition cursor-pointer"
                >
                  2 · Hard
                </button>
                <button
                  onClick={() => handleAnswer(3)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition cursor-pointer"
                >
                  3 · Good
                </button>
                <button
                  onClick={() => handleAnswer(4)}
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold transition cursor-pointer"
                >
                  4 · Easy
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
