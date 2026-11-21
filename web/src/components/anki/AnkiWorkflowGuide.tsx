'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Inbox,
  Sparkles,
} from 'lucide-react';

interface AnkiWorkflowGuideProps {
  open: boolean;
  onToggle: () => void;
  onOpenAiInbox: () => void;
  totalCards?: number;
  suspendedCards?: number;
}

const EXAMPLE_PROMPTS = [
  {
    id: 'stage',
    label: 'Match Suspended + Create Missing Cards (Approval Inbox)',
    badge: 'Recommended Default',
    text: 'Read my newest lecture source in @Gemini Notebook. Use Kevin-OS to find matching suspended Anki cards and stage them to unsuspend. Then check my existing Anki cards for any high-yield testable facts not covered yet, and stage new Cloze cards in FoM::Block 3::Week 12.',
  },
  {
    id: 'immediate',
    label: 'Bypass Inbox & Commit Immediately (Explicit Override)',
    badge: 'Instant Queue',
    text: 'Read my newest lecture source in @Gemini Notebook. Match my suspended Anki cards in Kevin-OS and unsuspend the relevant matches immediately without putting them in the Approval Inbox. Also add new Cloze cards for uncovered high-yield points directly to FoM::Block 3::Week 12 without inbox review.',
  },
  {
    id: 'checkin',
    label: 'Daily Check-In + Anki Due Alert',
    badge: 'Check-In',
    text: 'Give me my daily Kevin-OS overview, flag how many Anki cards I still have due today, and tell me my top leech topics to review.',
  },
];

export default function AnkiWorkflowGuide({
  open,
  onToggle,
  onOpenAiInbox,
  totalCards = 0,
  suspendedCards = 0,
}: AnkiWorkflowGuideProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {}
  };

  return (
    <section className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-[#131424] via-[#121218] to-[#0E1520] overflow-hidden shadow-md">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/20 border border-indigo-500/35 flex items-center justify-center shrink-0">
            <BookOpen className="h-4 w-4 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-semibold text-white">
                How to Use Gemini + NotebookLM with Anki
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                5-Step Playbook &amp; Copyable Prompts
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 truncate mt-0.5">
              Upload notes to NotebookLM → ask Gemini to match suspended cards &amp; draft Cloze cards → 1-click Approve → auto-sync to Anki Desktop &amp; iPhone.
            </p>
          </div>
        </div>

        <span className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 shrink-0">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 pt-2 border-t border-zinc-800/80 space-y-5 text-xs">
          {/* 5-Step Flow */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-xl bg-[#0D0F18] border border-zinc-800/90 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-indigo-500/25 text-indigo-300 border border-indigo-500/40 font-mono text-[10px] font-bold flex items-center justify-center">
                  1
                </span>
                <span className="font-semibold text-white">Upload to NotebookLM</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Upload your Schulich lecture slides, PDF, syllabus, or module notes into a NotebookLM notebook (e.g., <code className="text-cyan-300">Block 3 - ID</code>).
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0D0F18] border border-zinc-800/90 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-indigo-500/25 text-indigo-300 border border-indigo-500/40 font-mono text-[10px] font-bold flex items-center justify-center">
                  2
                </span>
                <span className="font-semibold text-white">Ask Gemini</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                On Gemini (browser or mobile), click <strong className="text-zinc-200">+</strong> to attach your notebook or mention{' '}
                <code className="text-cyan-300">@Gemini Notebook</code>, then paste one of the prompts below.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0D0F18] border border-zinc-800/90 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-mono text-[10px] font-bold flex items-center justify-center">
                  3
                </span>
                <span className="font-semibold text-white">AI Match &amp; Guard</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Gemini calls Kevin-OS MCP to scan all{' '}
                <strong className="text-zinc-200">{suspendedCards ? suspendedCards.toLocaleString() : 'suspended'}</strong>{' '}
                suspended cards, checks{' '}
                <strong className="text-zinc-200">{totalCards ? totalCards.toLocaleString() : 'existing'}</strong>{' '}
                cards for duplicates, and stages proposals safely in your Approval Inbox.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0D0F18] border border-zinc-800/90 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-mono text-[10px] font-bold flex items-center justify-center">
                  4
                </span>
                <span className="font-semibold text-white">1-Click Approve</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Open the <strong className="text-indigo-300">AI Inbox &amp; NotebookLM</strong> tab, uncheck any cards you don&apos;t want, review Cloze drafts &amp; duplicate warnings, and click <strong className="text-emerald-300">Approve &amp; Sync</strong>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0D0F18] border border-zinc-800/90 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="h-5 w-5 rounded-full bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-mono text-[10px] font-bold flex items-center justify-center">
                  5
                </span>
                <span className="font-semibold text-white">Auto-Sync (~20s)</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Your silent Windows Bridge (<code className="text-cyan-300">KevinOS-AnkiBridge</code>) applies changes via AnkiConnect &amp; runs official AnkiWeb Sync to your iPhone. Offline approvals stay safely queued until Anki opens.
              </p>
            </div>
          </div>

          {/* Copyable Ready-to-Paste Prompts */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                Ready-to-Paste Gemini Prompts
              </span>
              <button
                type="button"
                onClick={() => {
                  onOpenAiInbox();
                  onToggle();
                }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/35 text-[11px] font-semibold transition cursor-pointer"
              >
                <Inbox className="h-3.5 w-3.5" />
                <span>Jump to AI Inbox &amp; Direct Studio</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {EXAMPLE_PROMPTS.map((p) => (
                <div
                  key={p.id}
                  className="p-3.5 rounded-xl bg-[#0B0D14] border border-zinc-800/90 flex flex-col justify-between gap-2.5"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white text-[11px] leading-snug">
                        {p.label}
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-cyan-300 border border-zinc-800 shrink-0">
                        {p.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-relaxed italic">
                      &ldquo;{p.text}&rdquo;
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopy(p.id, p.text)}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 text-[11px] font-medium text-zinc-200 transition cursor-pointer"
                  >
                    {copiedId === p.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-300">Copied to clipboard!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Copy Prompt</span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Helpful Tips Footer */}
          <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20 text-[11px] text-zinc-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              <strong className="text-cyan-300">Tips:</strong> Close any open Anki Desktop Add/Edit/Browse windows so automatic AnkiWeb sync can push updates to your iPhone. You can also paste any NotebookLM summary directly into the{' '}
              <strong className="text-white">Direct Matcher &amp; Gap-Card Studio</strong> inside the AI Inbox tab.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
