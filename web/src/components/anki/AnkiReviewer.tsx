'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookmarkPlus,
  Bot,
  Check,
  CheckCircle2,
  Eye,
  Keyboard,
  Layers,
  PauseCircle,
  RefreshCw,
  Send,
  Sparkles,
  X,
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

  // In-App AI Card Tutor state
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorLoading, setTutorLoading] = useState(false);
  const [tutorInput, setTutorInput] = useState('');
  const [tutorMessages, setTutorMessages] = useState<
    Array<{ role: 'user' | 'assistant'; text: string; concisePearl?: string; saved?: boolean }>
  >([]);
  const [savingPearlIdx, setSavingPearlIdx] = useState<number | null>(null);
  const [tutorNotice, setTutorNotice] = useState<string | null>(null);

  const resetTutorForNextCard = useCallback(() => {
    setTutorMessages([]);
    setTutorInput('');
    setTutorNotice(null);
  }, []);

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
        resetTutorForNextCard();
        cardShownAtRef.current = Date.now();
      }
    } finally {
      setLoading(false);
    }
  }, [resetTutorForNextCard]);

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
        resetTutorForNextCard();
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
    [currentCard, submitting, onReviewSubmitted, resetTutorForNextCard]
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
      resetTutorForNextCard();
      cardShownAtRef.current = Date.now();
      onReviewSubmitted(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAskTutor = async (
    mode: 'hint' | 'explain' | 'differentials' | 'vignette' | 'mnemonic' | 'chat',
    customQuestion?: string
  ) => {
    if (!currentCard || tutorLoading) return;
    const questionText = (customQuestion ?? tutorInput).trim();
    if (mode === 'chat' && !questionText) return;

    setTutorOpen(true);
    setTutorLoading(true);
    setTutorNotice(null);

    const userLabel =
      mode === 'chat'
        ? questionText
        : mode === 'hint'
        ? 'Give me a non-spoiler hint'
        : mode === 'explain'
        ? 'Explain the mechanism & clinical context'
        : mode === 'differentials'
        ? 'Compare commonly confused differentials'
        : mode === 'vignette'
        ? 'Give me a quick clinical vignette'
        : 'Give me a memorable mnemonic';

    const nextHistory = [...tutorMessages, { role: 'user' as const, text: userLabel }];
    setTutorMessages(nextHistory);
    if (mode === 'chat') setTutorInput('');

    try {
      const res = await fetch('/api/anki/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          revealed,
          question: mode === 'chat' ? questionText : undefined,
          history: tutorMessages.map((m) => ({ role: m.role, text: m.text })),
          card: {
            deck_name: currentCard.deck_name,
            model_name: currentCard.model_name,
            front_text: currentCard.front_text,
            back_text: currentCard.back_text,
            extra_text: currentCard.extra_text,
            tags: currentCard.tags,
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.reply) {
        setTutorMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: data.reply,
            concisePearl: data.concisePearl || data.reply,
          },
        ]);
      } else {
        setTutorNotice(data.error || 'Could not reach Gemini AI Tutor right now.');
      }
    } catch {
      setTutorNotice('Network error contacting Gemini AI Tutor.');
    } finally {
      setTutorLoading(false);
    }
  };

  const handleSavePearlToExtra = async (msgIdx: number, pearlText: string) => {
    if (!currentCard || !pearlText.trim()) return;
    setSavingPearlIdx(msgIdx);
    setTutorNotice(null);
    try {
      const res = await fetch('/api/anki/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'append_extra',
          cardId: currentCard.card_id,
          noteId: currentCard.note_id,
          appendText: pearlText.trim(),
          source: 'kevin_os_ui',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTutorMessages((prev) =>
          prev.map((m, idx) => (idx === msgIdx ? { ...m, saved: true } : m))
        );
        // Update live card extra_text immediately so it displays on screen
        setQueue((prev) =>
          prev.map((c, idx) =>
            idx === 0
              ? {
                  ...c,
                  extra_text: c.extra_text
                    ? `${c.extra_text}\n\nAI Pearl: ${pearlText.trim()}`
                    : `AI Pearl: ${pearlText.trim()}`,
                }
              : c
          )
        );
        setTutorNotice('Saved to card Extra field — syncing to Anki Desktop & AnkiWeb!');
      } else {
        setTutorNotice(data.error || 'Could not save to card Extra field.');
      }
    } finally {
      setSavingPearlIdx(null);
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

            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span>Reps: {currentCard.reps}</span>
              <span>Lapses: {currentCard.lapses}</span>
              <button
                onClick={() => setTutorOpen((v) => !v)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md border transition cursor-pointer font-medium ${
                  tutorOpen
                    ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50'
                    : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                }`}
                title="Ask Gemini AI Tutor about this card"
              >
                <Sparkles className="h-3.5 w-3.5" /> Ask AI Tutor
              </button>
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

          {/* In-App Gemini AI Card Tutor Drawer */}
          {tutorOpen && (
            <div className="px-5 py-4 border-t border-indigo-500/30 bg-gradient-to-b from-[#131425] to-[#0D0F18] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-200">
                  <Bot className="h-4 w-4 text-cyan-400" />
                  <span>Gemini AI Card Tutor</span>
                  <span className="text-[10px] font-normal text-zinc-400">
                    {revealed ? 'Full context & follow-up Q&A' : 'Non-spoiler hint mode'}
                  </span>
                </div>
                <button
                  onClick={() => setTutorOpen(false)}
                  className="text-zinc-500 hover:text-white cursor-pointer"
                  title="Close AI Tutor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 1-Click Medical Tutor Pills */}
              <div className="flex flex-wrap gap-1.5">
                {!revealed ? (
                  <button
                    onClick={() => handleAskTutor('hint')}
                    disabled={tutorLoading}
                    className="px-3 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/35 text-[11px] font-medium transition cursor-pointer"
                  >
                    💡 Non-Spoiler Hint
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => handleAskTutor('explain')}
                      disabled={tutorLoading}
                      className="px-3 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/30 text-[11px] font-medium transition cursor-pointer"
                    >
                      🧬 Explain Mechanism
                    </button>
                    <button
                      onClick={() => handleAskTutor('differentials')}
                      disabled={tutorLoading}
                      className="px-3 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/30 text-[11px] font-medium transition cursor-pointer"
                    >
                      ⚖️ Compare Differentials
                    </button>
                    <button
                      onClick={() => handleAskTutor('vignette')}
                      disabled={tutorLoading}
                      className="px-3 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/30 text-[11px] font-medium transition cursor-pointer"
                    >
                      🩺 Clinical Vignette
                    </button>
                    <button
                      onClick={() => handleAskTutor('mnemonic')}
                      disabled={tutorLoading}
                      className="px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/30 text-[11px] font-medium transition cursor-pointer"
                    >
                      🧠 Mnemonic
                    </button>
                  </>
                )}
              </div>

              {/* Conversation Thread */}
              {tutorMessages.length > 0 && (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {tutorMessages.map((m, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl text-xs leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-zinc-900/90 border border-zinc-800 text-zinc-300 ml-8'
                          : 'bg-[#101624] border border-cyan-500/25 text-zinc-100 space-y-2'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      {m.role === 'assistant' && m.concisePearl && (
                        <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-zinc-400 line-clamp-1 flex-1">
                            Pearl: {m.concisePearl}
                          </span>
                          <button
                            onClick={() => handleSavePearlToExtra(idx, m.concisePearl!)}
                            disabled={m.saved || savingPearlIdx === idx}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 cursor-pointer ${
                              m.saved
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-500/35'
                            }`}
                          >
                            {m.saved ? (
                              <>
                                <Check className="h-3 w-3" /> Saved to Extra
                              </>
                            ) : (
                              <>
                                <BookmarkPlus className="h-3 w-3" />
                                {savingPearlIdx === idx ? 'Saving...' : 'Save to Card Extra'}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {tutorLoading && (
                    <div className="p-2.5 rounded-xl bg-[#101624] border border-zinc-800 text-xs text-cyan-300 flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Gemini is thinking...</span>
                    </div>
                  )}
                </div>
              )}

              {tutorNotice && (
                <div className="text-[11px] text-cyan-200 bg-cyan-500/10 border border-cyan-500/25 rounded-lg px-3 py-1.5">
                  ✨ {tutorNotice}
                </div>
              )}

              {/* Follow-up Question Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAskTutor('chat');
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={tutorInput}
                  onChange={(e) => setTutorInput(e.target.value)}
                  placeholder="Ask a follow-up question about this card (e.g. 'Why does this cause hyperkalemia?')..."
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  disabled={tutorLoading || !tutorInput.trim()}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Ask</span>
                </button>
              </form>
            </div>
          )}

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
