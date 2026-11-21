'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { AnkiCard } from '@/types/anki';

interface AnkiCardBrowserProps {
  availableDecks: string[];
  defaultDeck: string;
  onCardsMutated: () => void;
}

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'due', label: 'Due Today' },
  { key: 'active', label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'new', label: 'New' },
  { key: 'leech', label: 'Leeches (4+)' },
] as const;

export default function AnkiCardBrowser({
  availableDecks,
  defaultDeck,
  onCardsMutated,
}: AnkiCardBrowserProps) {
  const [search, setSearch] = useState('');
  const [deck, setDeck] = useState('ALL');
  const [status, setStatus] = useState<string>('all');
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Add Card Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDeck, setNewDeck] = useState(defaultDeck || 'Schulich');
  const [newModel, setNewModel] = useState<'Cloze' | 'Basic'>('Cloze');
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [newExtra, setNewExtra] = useState('');
  const [newTags, setNewTags] = useState('schulich');
  const [addingCard, setAddingCard] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status, limit: '60' });
      if (search.trim()) qs.set('q', search.trim());
      if (deck !== 'ALL') qs.set('deck', deck);
      const res = await fetch(`/api/anki/cards?${qs.toString()}`);
      const data = await res.json();
      if (data.success) {
        setCards(data.cards || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [search, deck, status]);

  useEffect(() => {
    const t = setTimeout(fetchCards, 180);
    return () => clearTimeout(t);
  }, [fetchCards]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (action: 'unsuspend' | 'suspend', ids?: number[]) => {
    const targetIds = ids || Array.from(selectedIds);
    if (targetIds.length === 0) return;
    setBulkBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/anki/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, cardIds: targetIds, source: 'kevin_os_ui' }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback(data.message || `Updated ${targetIds.length} card(s).`);
        setSelectedIds(new Set());
        await fetchCards();
        onCardsMutated();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFront.trim()) return;
    setAddingCard(true);
    setDupWarning(null);
    try {
      const res = await fetch('/api/anki/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_note',
          deckName: newDeck.trim() || 'Schulich',
          modelName: newModel,
          front: newFront.trim(),
          back: newBack.trim(),
          extra: newExtra.trim(),
          tags: newTags
            .split(/[,\s]+/)
            .map((t) => t.trim())
            .filter(Boolean),
          source: 'kevin_os_ui',
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.duplicateWarning) setDupWarning(data.duplicateWarning);
        setFeedback(data.message || 'Queued new card to sync to Anki!');
        setNewFront('');
        setNewBack('');
        setNewExtra('');
        setShowAddModal(false);
        await fetchCards();
        onCardsMutated();
      }
    } finally {
      setAddingCard(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-[#121218] border border-zinc-800/90 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search across all 3,000–5,000 Schulich cards, drugs, tags, or mechanisms..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0D0E14] border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/60"
            />
          </div>

          <select
            value={deck}
            onChange={(e) => setDeck(e.target.value)}
            className="bg-[#0D0E14] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/60"
          >
            <option value="ALL">All Decks</option>
            {availableDecks.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-500/15 transition cursor-pointer shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add New Card</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setStatus(t.key);
                  setSelectedIds(new Set());
                }}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                  status === t.key
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-zinc-900/70 text-zinc-400 border-zinc-800 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={() => handleBulkAction('unsuspend')}
                  disabled={bulkBusy}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/35 text-[11px] font-semibold cursor-pointer"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  Unsuspend ({selectedIds.size})
                </button>
                <button
                  onClick={() => handleBulkAction('suspend')}
                  disabled={bulkBusy}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/35 text-[11px] font-semibold cursor-pointer"
                >
                  <PauseCircle className="h-3.5 w-3.5" />
                  Suspend ({selectedIds.size})
                </button>
              </>
            )}
            <span className="text-[11px] font-mono text-zinc-500">
              Showing {cards.length} of {total}
            </span>
          </div>
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            {feedback}
          </span>
          <button onClick={() => setFeedback(null)} className="text-emerald-400 hover:text-white cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {dupWarning && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>{dupWarning}</span>
        </div>
      )}

      {/* Cards List */}
      {loading ? (
        <div className="py-16 text-center text-xs text-zinc-400">
          <RefreshCw className="h-6 w-6 text-cyan-400 animate-spin mx-auto mb-2" />
          Searching Anki card mirror...
        </div>
      ) : cards.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-zinc-800 bg-[#121218]/40 text-xs text-zinc-500">
          No cards match this search/filter yet.
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => {
            const isSelected = selectedIds.has(card.card_id);
            return (
              <div
                key={card.card_id}
                className={`p-4 rounded-xl border bg-[#121218] transition ${
                  isSelected
                    ? 'border-cyan-500/50 bg-cyan-950/15'
                    : card.suspended
                    ? 'border-amber-500/20 opacity-85'
                    : 'border-zinc-800/90 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(card.card_id)}
                    className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 cursor-pointer"
                  />

                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">
                        {card.deck_name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-mono">
                        {card.model_name}
                      </span>
                      {card.suspended ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                          Suspended
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                          Active · ivl {card.interval_days}d
                        </span>
                      )}
                      {card.lapses >= 4 && (
                        <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold">
                          Leech ({card.lapses} lapses)
                        </span>
                      )}
                    </div>

                    <div className="text-xs sm:text-sm text-white leading-relaxed line-clamp-3">
                      {card.front_text}
                    </div>

                    {card.extra_text && (
                      <div className="text-[11px] text-zinc-400 line-clamp-2">
                        Extra: {card.extra_text}
                      </div>
                    )}

                    {card.tags && card.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {card.tags.slice(0, 6).map((t) => (
                          <span
                            key={t}
                            className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() =>
                      handleBulkAction(card.suspended ? 'unsuspend' : 'suspend', [card.card_id])
                    }
                    disabled={bulkBusy}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition shrink-0 cursor-pointer ${
                      card.suspended
                        ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                        : 'bg-zinc-900 hover:bg-amber-500/15 text-zinc-400 hover:text-amber-300 border-zinc-800'
                    }`}
                  >
                    {card.suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Card Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAddCard}
            className="w-full max-w-xl rounded-2xl bg-[#121218] border border-zinc-700 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Add New Anki Card</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-zinc-400 block mb-1">Target Deck</label>
                <input
                  list="add-card-decks"
                  value={newDeck}
                  onChange={(e) => setNewDeck(e.target.value)}
                  placeholder="Schulich::Block"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                />
                <datalist id="add-card-decks">
                  {availableDecks.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Note Type</label>
                <select
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value as 'Cloze' | 'Basic')}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                >
                  <option value="Cloze">Cloze (&#123;&#123;c1::...&#125;&#125;)</option>
                  <option value="Basic">Basic (Front / Back)</option>
                </select>
              </div>
            </div>

            <div className="text-xs">
              <label className="text-zinc-400 block mb-1">
                {newModel === 'Cloze'
                  ? 'Cloze Text (use {{c1::answer}} syntax)'
                  : 'Front / Question'}
              </label>
              <textarea
                rows={3}
                required
                value={newFront}
                onChange={(e) => setNewFront(e.target.value)}
                placeholder={
                  newModel === 'Cloze'
                    ? 'Vancomycin inhibits cell wall synthesis by binding {{c1::D-Ala-D-Ala}} on peptidoglycan precursors.'
                    : 'What is the mechanism of action of Vancomycin?'
                }
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            {newModel === 'Basic' && (
              <div className="text-xs">
                <label className="text-zinc-400 block mb-1">Back / Answer</label>
                <textarea
                  rows={2}
                  value={newBack}
                  onChange={(e) => setNewBack(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"
                />
              </div>
            )}

            <div className="text-xs">
              <label className="text-zinc-400 block mb-1">Extra / Clinical Pearl (Optional)</label>
              <textarea
                rows={2}
                value={newExtra}
                onChange={(e) => setNewExtra(e.target.value)}
                placeholder="Resistance in VRE occurs via D-Ala-D-Lac mutation."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="text-xs">
              <label className="text-zinc-400 block mb-1">Tags (comma or space separated)</label>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addingCard}
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-semibold cursor-pointer"
              >
                {addingCard ? 'Queueing...' : 'Add & Sync to Anki'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
