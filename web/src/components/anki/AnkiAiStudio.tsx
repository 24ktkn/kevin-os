'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Inbox,
  PlayCircle,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import {
  AnkiProposal,
  StagedCardMatchRef,
  StagedNewCardDraft,
} from '@/types/anki';

interface AnkiAiStudioProps {
  availableDecks: string[];
  defaultDeck: string;
  onInboxChanged: () => void;
}

export default function AnkiAiStudio({
  availableDecks,
  defaultDeck,
  onInboxChanged,
}: AnkiAiStudioProps) {
  const [proposals, setProposals] = useState<AnkiProposal[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [selectedProposalCards, setSelectedProposalCards] = useState<Record<string, Set<number>>>({});
  const [inboxMsg, setInboxMsg] = useState<string | null>(null);

  // Direct NotebookLM / Lecture Matcher & Gap Card Generator state
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [targetDeck, setTargetDeck] = useState(defaultDeck || 'Schulich');
  const [modelName, setModelName] = useState<'Cloze' | 'Basic'>('Cloze');
  const [runningMatch, setRunningMatch] = useState(false);
  const [matchedSuspended, setMatchedSuspended] = useState<StagedCardMatchRef[]>([]);
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());
  const [generatedCards, setGeneratedCards] = useState<StagedNewCardDraft[]>([]);
  const [studioMsg, setStudioMsg] = useState<string | null>(null);
  const [applyingStudio, setApplyingStudio] = useState(false);

  const loadProposals = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const res = await fetch('/api/anki/proposals?status=pending');
      const data = await res.json();
      if (data.success && Array.isArray(data.proposals)) {
        const list = data.proposals as AnkiProposal[];
        setProposals(list);
        const initSelections: Record<string, Set<number>> = {};
        for (const p of list) {
          const ids =
            p.payload?.cardIds ||
            (p.payload?.matches || []).map((m) => m.cardId);
          initSelections[p.id] = new Set(ids);
        }
        setSelectedProposalCards(initSelections);
      }
    } finally {
      setLoadingInbox(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadProposals();
    }, 0);
    return () => clearTimeout(t);
  }, [loadProposals]);

  const handleProposalDecision = async (proposal: AnkiProposal, decision: 'approve' | 'reject') => {
    setBusyProposalId(proposal.id);
    setInboxMsg(null);
    try {
      const body: Record<string, unknown> = { id: proposal.id, decision };
      if (
        decision === 'approve' &&
        (proposal.proposal_type === 'unsuspend_cards' || proposal.proposal_type === 'suspend_cards')
      ) {
        body.selectedCardIds = Array.from(selectedProposalCards[proposal.id] || []);
      }
      const res = await fetch('/api/anki/proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setInboxMsg(
          decision === 'approve'
            ? data.message || 'Approved and queued for Anki sync!'
            : `Dismissed proposal "${proposal.title}".`
        );
        await loadProposals();
        onInboxChanged();
      }
    } finally {
      setBusyProposalId(null);
    }
  };

  const handleRunMatcher = async (mode: 'match_suspended' | 'both') => {
    if (!sourceTitle.trim() && !sourceText.trim()) return;
    setRunningMatch(true);
    setStudioMsg(null);
    try {
      const res = await fetch('/api/anki/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          sourceTitle: sourceTitle.trim(),
          sourceText: sourceText.trim(),
          targetDeck: targetDeck.trim() || 'Schulich',
          modelName,
          maxMatches: 25,
          maxCards: 8,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const matches = (data.matches || []) as StagedCardMatchRef[];
        setMatchedSuspended(matches);
        setSelectedMatchIds(
          new Set(matches.filter((m) => (m.matchScore || 0) >= 40).map((m) => m.cardId))
        );
        setGeneratedCards((data.draftCards || []) as StagedNewCardDraft[]);
        setStudioMsg(
          `Found ${matches.length} matching suspended card(s)${
            mode === 'both' ? ` and drafted ${(data.draftCards || []).length} gap card(s)` : ''
          }.`
        );
      }
    } finally {
      setRunningMatch(false);
    }
  };

  const handleUnsuspendStudioMatches = async () => {
    const ids = Array.from(selectedMatchIds);
    if (ids.length === 0) return;
    setApplyingStudio(true);
    try {
      const res = await fetch('/api/anki/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unsuspend', cardIds: ids, source: 'kevin_os_ui' }),
      });
      const data = await res.json();
      if (data.success) {
        setStudioMsg(`Unsuspended ${ids.length} matching card(s) and queued AnkiWeb sync!`);
        setMatchedSuspended((prev) => prev.filter((m) => !selectedMatchIds.has(m.cardId)));
        setSelectedMatchIds(new Set());
        onInboxChanged();
      }
    } finally {
      setApplyingStudio(false);
    }
  };

  const handleAddGeneratedCards = async (cardsToAdd: StagedNewCardDraft[]) => {
    if (cardsToAdd.length === 0) return;
    setApplyingStudio(true);
    try {
      for (const c of cardsToAdd) {
        await fetch('/api/anki/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add_note',
            deckName: c.deckName || targetDeck || 'Schulich',
            modelName: c.modelName || modelName,
            front: c.front,
            back: c.back,
            extra: c.extra,
            tags: c.tags || ['source::notebooklm'],
            source: 'kevin_os_ui',
          }),
        });
      }
      setStudioMsg(`Queued ${cardsToAdd.length} new card(s) to sync into Anki Desktop & AnkiWeb!`);
      setGeneratedCards((prev) => prev.filter((g) => !cardsToAdd.includes(g)));
      onInboxChanged();
    } finally {
      setApplyingStudio(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* SECTION 1: 1-Click Approval Inbox (Gemini / NotebookLM Staged Proposals) */}
      <div className="rounded-2xl border border-indigo-500/35 bg-gradient-to-br from-[#141425] via-[#121218] to-[#0E131D] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/20 border border-indigo-500/35 flex items-center justify-center">
              <Inbox className="h-4.5 w-4.5 text-indigo-300" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                1-Click Approval Inbox
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/35">
                  {proposals.length} pending
                </span>
              </h3>
              <p className="text-xs text-zinc-400">
                Cards &amp; unsuspend batches proposed by Gemini (`@Gemini Notebook` + Kevin-OS MCP) land here first unless you explicitly tell Gemini to commit immediately.
              </p>
            </div>
          </div>

          <button
            onClick={loadProposals}
            className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 cursor-pointer"
            title="Refresh Approval Inbox"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingInbox ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>

        {inboxMsg && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between">
            <span>✅ {inboxMsg}</span>
            <button onClick={() => setInboxMsg(null)} className="cursor-pointer">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {loadingInbox ? (
          <div className="py-10 text-center text-xs text-zinc-400">Loading staged proposals...</div>
        ) : proposals.length === 0 ? (
          <div className="py-10 text-center rounded-xl border border-dashed border-zinc-800 bg-[#0D0E15]/60 space-y-1.5">
            <CheckCircle2 className="h-7 w-7 text-emerald-400/70 mx-auto" />
            <div className="text-xs font-medium text-zinc-300">Approval Inbox is clear</div>
            <p className="text-[11px] text-zinc-500 max-w-lg mx-auto">
              Ask Gemini with <span className="text-cyan-300 font-mono">@Gemini Notebook</span> to match suspended Anki cards or draft new Cloze cards — they will appear here for 1-click approval.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map((prop) => {
              const isBusy = busyProposalId === prop.id;
              const selSet = selectedProposalCards[prop.id] || new Set<number>();
              return (
                <div
                  key={prop.id}
                  className="p-4 rounded-xl bg-[#0F1019] border border-indigo-500/25 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          {prop.proposal_type.replace('_', ' ')}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-400">
                          {prop.source_label}
                        </span>
                        {prop.deck_name && (
                          <span className="text-[11px] font-mono text-indigo-300">
                            → {prop.deck_name}
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-semibold text-white">{prop.title}</h4>
                      {prop.reasoning && (
                        <p className="text-xs text-zinc-400 leading-relaxed">{prop.reasoning}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleProposalDecision(prop, 'approve')}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-semibold transition cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{isBusy ? 'Syncing...' : 'Approve & Sync'}</span>
                      </button>
                      <button
                        onClick={() => handleProposalDecision(prop, 'reject')}
                        disabled={isBusy}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-rose-500/15 text-zinc-400 hover:text-rose-300 border border-zinc-800 text-xs transition cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {/* Preview items inside proposal */}
                  {prop.proposal_type === 'new_cards' && Array.isArray(prop.payload?.cards) && (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {prop.payload.cards.map((c, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-[#141622] border border-zinc-800 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                            <span className="font-mono text-cyan-300">
                              {c.modelName} · {c.deckName}
                            </span>
                            {c.tags && c.tags.length > 0 && (
                              <span className="font-mono text-zinc-500">
                                {c.tags.map((t) => `#${t}`).join(' ')}
                              </span>
                            )}
                          </div>
                          <div className="text-white">{c.front}</div>
                          {c.back && <div className="text-cyan-200">Back: {c.back}</div>}
                          {c.extra && <div className="text-zinc-400">Extra: {c.extra}</div>}
                          {c.duplicateWarning && (
                            <div className="text-amber-300 flex items-center gap-1 text-[11px] pt-0.5">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span>{c.duplicateWarning}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {(prop.proposal_type === 'unsuspend_cards' ||
                    prop.proposal_type === 'suspend_cards') &&
                    Array.isArray(prop.payload?.matches) && (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                        {prop.payload.matches.map((m) => (
                          <label
                            key={m.cardId}
                            className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#141622] border border-zinc-800 text-xs cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selSet.has(m.cardId)}
                              onChange={() => {
                                setSelectedProposalCards((prev) => {
                                  const nextSet = new Set(prev[prop.id] || []);
                                  if (nextSet.has(m.cardId)) nextSet.delete(m.cardId);
                                  else nextSet.add(m.cardId);
                                  return { ...prev, [prop.id]: nextSet };
                                });
                              }}
                              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-white leading-snug">{m.frontSnippet}</div>
                              <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                                {m.deckName}
                                {m.tags?.length ? ` · ${m.tags.slice(0, 4).map((t) => `#${t}`).join(' ')}` : ''}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: Direct NotebookLM / Lecture Suspended-Card Matcher & Cloze Card Studio */}
      <div className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Bot className="h-5 w-5 text-cyan-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">
              Direct NotebookLM / Lecture Matcher &amp; Gap-Card Studio
            </h3>
            <p className="text-xs text-zinc-400">
              Paste a NotebookLM study guide or Schulich lecture summary to match suspended cards AND draft missing Cloze/Basic cards directly here.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="text-zinc-400 block mb-1">Lecture / Source Title</label>
            <input
              type="text"
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="e.g. Infection Foundations: Antibiotics"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
            />
          </div>
          <div>
            <label className="text-zinc-400 block mb-1">Target Deck for New Cards</label>
            <input
              list="studio-decks-list"
              value={targetDeck}
              onChange={(e) => setTargetDeck(e.target.value)}
              placeholder="Schulich::Block"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
            />
            <datalist id="studio-decks-list">
              {availableDecks.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-zinc-400 block mb-1">New Card Style</label>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value as 'Cloze' | 'Basic')}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
            >
              <option value="Cloze">Cloze (&#123;&#123;c1::...&#125;&#125;)</option>
              <option value="Basic">Basic (Front / Back)</option>
            </select>
          </div>
        </div>

        <div className="text-xs">
          <label className="text-zinc-400 block mb-1">
            Paste NotebookLM Summary, Key Concepts, or Lecture Outline
          </label>
          <textarea
            rows={5}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Paste high-yield takeaways or study guide notes from NotebookLM..."
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleRunMatcher('match_suspended')}
            disabled={runningMatch || (!sourceTitle.trim() && !sourceText.trim())}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/35 text-xs font-semibold disabled:opacity-50 transition cursor-pointer"
          >
            {runningMatch ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            <span>Find Matching Suspended Cards</span>
          </button>

          <button
            onClick={() => handleRunMatcher('both')}
            disabled={runningMatch || (!sourceTitle.trim() && !sourceText.trim())}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold disabled:opacity-50 transition cursor-pointer"
          >
            {runningMatch ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span>Match Suspended + Draft Missing Cards</span>
          </button>
        </div>

        {studioMsg && (
          <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-200 text-xs">
            ✨ {studioMsg}
          </div>
        )}

        {/* Matched Suspended Cards Results */}
        {matchedSuspended.length > 0 && (
          <div className="space-y-2.5 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-300">
                Matching Suspended Cards ({matchedSuspended.length})
              </span>
              <button
                onClick={handleUnsuspendStudioMatches}
                disabled={applyingStudio || selectedMatchIds.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                <PlayCircle className="h-3.5 w-3.5" />
                Unsuspend Selected ({selectedMatchIds.size})
              </button>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {matchedSuspended.map((m) => (
                <label
                  key={m.cardId}
                  className="flex items-start gap-2.5 p-3 rounded-xl bg-[#0F1017] border border-zinc-800 hover:border-indigo-500/35 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedMatchIds.has(m.cardId)}
                    onChange={() => {
                      setSelectedMatchIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.cardId)) next.delete(m.cardId);
                        else next.add(m.cardId);
                        return next;
                      });
                    }}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="text-white">{m.frontSnippet}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-mono">
                        {m.matchScore}% match
                      </span>
                      <span className="text-zinc-500 font-mono">{m.deckName}</span>
                      {m.matchedTerms && m.matchedTerms.length > 0 && (
                        <span className="text-cyan-400/80">
                          Matched: {m.matchedTerms.slice(0, 5).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Drafted Gap Cards Results */}
        {generatedCards.length > 0 && (
          <div className="space-y-2.5 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-300">
                Drafted Missing Cards ({generatedCards.length})
              </span>
              <button
                onClick={() => handleAddGeneratedCards(generatedCards)}
                disabled={applyingStudio}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-cyan-950 text-xs font-semibold cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add All ({generatedCards.length}) to Anki
              </button>
            </div>
            <div className="space-y-2">
              {generatedCards.map((c, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-[#0F1017] border border-cyan-500/25 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-cyan-300">
                      {c.modelName} → {c.deckName}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleAddGeneratedCards([c])}
                        disabled={applyingStudio}
                        className="px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold cursor-pointer"
                      >
                        Add Card
                      </button>
                      <button
                        onClick={() =>
                          setGeneratedCards((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="text-white">{c.front}</div>
                  {c.back && <div className="text-cyan-200">Back: {c.back}</div>}
                  {c.extra && <div className="text-zinc-400">Extra: {c.extra}</div>}
                  {c.duplicateWarning && (
                    <div className="text-amber-300 flex items-center gap-1 text-[11px]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>{c.duplicateWarning}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
