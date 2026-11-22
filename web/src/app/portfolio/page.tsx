'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Award,
  Check,
  Clock,
  Copy,
  Database,
  Download,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  CANMEDS_ROLES,
  PORTFOLIO_CATEGORIES,
  PortfolioEntry,
} from '@/types/portfolio';
import { getTodayDateStr } from '@/lib/date-utils';

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  clinical: 'Clinical',
  research: 'Research',
  volunteering: 'Volunteering',
  leadership: 'Leadership',
  teaching: 'Teaching',
  shadowing: 'Shadowing',
  award: 'Awards',
  extracurricular: 'Extracurricular',
};

const EMPTY_FORM = {
  id: '',
  category: 'clinical' as PortfolioEntry['category'],
  title: '',
  organization: '',
  role: '',
  start_date: getTodayDateStr(),
  end_date: '',
  is_ongoing: true,
  hours: 0,
  verifier_name: '',
  verifier_contact: '',
  canmeds_roles: [] as string[],
  description: '',
  carms_bullets: '' as string, // newline-separated in form
  tags: '' as string,
};

export default function PortfolioPage() {
  const [entries, setEntries] = useState<PortfolioEntry[]>([]);
  const [summary, setSummary] = useState<{
    totalEntries: number;
    totalHours: number;
    ongoingCount: number;
    canmedsCoverage: Record<string, number>;
  }>({ totalEntries: 0, totalHours: 0, ongoingCount: 0, canmedsCoverage: {} });
  const [needsMigration, setNeedsMigration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [draftingBullets, setDraftingBullets] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (categoryFilter !== 'all') sp.set('category', categoryFilter);
      if (search.trim()) sp.set('q', search.trim());
      const res = await fetch(`/api/portfolio?${sp.toString()}`);
      const data = await res.json();
      if (data.success) {
        setNeedsMigration(Boolean(data.needsMigration));
        setEntries(data.entries || []);
        if (data.summary) setSummary(data.summary);
      }
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, search]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadPortfolio();
    }, 150);
    return () => clearTimeout(t);
  }, [loadPortfolio]);

  const openNewModal = () => {
    setForm({ ...EMPTY_FORM, start_date: getTodayDateStr() });
    setModalOpen(true);
  };

  const openEditModal = (e: PortfolioEntry) => {
    setForm({
      id: e.id,
      category: e.category,
      title: e.title,
      organization: e.organization,
      role: e.role,
      start_date: e.start_date,
      end_date: e.end_date,
      is_ongoing: e.is_ongoing,
      hours: Number(e.hours || 0),
      verifier_name: e.verifier_name,
      verifier_contact: e.verifier_contact,
      canmeds_roles: e.canmeds_roles || [],
      description: e.description,
      carms_bullets: (e.carms_bullets || []).join('\n'),
      tags: (e.tags || []).join(', '),
    });
    setModalOpen(true);
  };

  const handleDraftBullets = async () => {
    if (!form.title.trim() && !form.description.trim()) return;
    setDraftingBullets(true);
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft_carms_bullets',
          title: form.title,
          organization: form.organization,
          role: form.role,
          category: form.category,
          description: form.description || form.title,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setForm((prev) => ({
          ...prev,
          carms_bullets: Array.isArray(data.bullets)
            ? data.bullets.join('\n')
            : prev.carms_bullets,
          canmeds_roles:
            prev.canmeds_roles.length === 0 && Array.isArray(data.suggestedCanmeds)
              ? data.suggestedCanmeds
              : prev.canmeds_roles,
        }));
      }
    } finally {
      setDraftingBullets(false);
    }
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...(form.id ? { id: form.id } : {}),
        category: form.category,
        title: form.title.trim(),
        organization: form.organization.trim(),
        role: form.role.trim(),
        start_date: form.start_date,
        end_date: form.is_ongoing ? '' : form.end_date,
        is_ongoing: form.is_ongoing,
        hours: Number(form.hours) || 0,
        verifier_name: form.verifier_name.trim(),
        verifier_contact: form.verifier_contact.trim(),
        canmeds_roles: form.canmeds_roles,
        description: form.description.trim(),
        carms_bullets: form.carms_bullets
          .split('\n')
          .map((l) => l.replace(/^[•\-*]\s*/, '').trim())
          .filter(Boolean),
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      const res = await fetch('/api/portfolio', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setModalOpen(false);
        await loadPortfolio();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/portfolio?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadPortfolio();
  };

  const exportCarmsMarkdown = async (copyOnly = false) => {
    const lines: string[] = [
      '# Kevin Nguyen — CaRMS Medical School Portfolio',
      `Exported: ${getTodayDateStr()} · ${summary.totalEntries} Activities · ${summary.totalHours} Total Hours`,
      '',
    ];
    for (const cat of PORTFOLIO_CATEGORIES) {
      const group = entries.filter((e) => e.category === cat);
      if (group.length === 0) continue;
      lines.push(`## ${CATEGORY_LABELS[cat] || cat}`);
      for (const item of group) {
        lines.push(
          `### ${item.title}${item.role ? ` — ${item.role}` : ''}${item.organization ? ` (${item.organization})` : ''}`
        );
        lines.push(
          `*${item.start_date || 'N/A'} – ${item.is_ongoing ? 'Present' : item.end_date || 'N/A'}* · ${item.hours} hrs${
            item.canmeds_roles?.length ? ` · CanMEDS: ${item.canmeds_roles.join(', ')}` : ''
          }`
        );
        if (item.verifier_name) {
          lines.push(`Verifier: ${item.verifier_name}${item.verifier_contact ? ` (${item.verifier_contact})` : ''}`);
        }
        if (item.carms_bullets?.length) {
          for (const b of item.carms_bullets) lines.push(`- ${b}`);
        } else if (item.description) {
          lines.push(item.description);
        }
        lines.push('');
      }
    }
    const md = lines.join('\n');
    if (copyOnly) {
      try {
        await navigator.clipboard.writeText(md);
        setCopiedMd(true);
        setTimeout(() => setCopiedMd(false), 2000);
      } catch {}
      return;
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kevin-carms-portfolio-${getTodayDateStr()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const coveredCanmedsCount = CANMEDS_ROLES.filter(
    (r) => (summary.canmedsCoverage[r] || 0) > 0
  ).length;

  return (
    <div className="min-h-screen bg-[#0A0A0D] text-white">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0F0F14]/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Award className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">
              Med School Portfolio &amp; CaRMS Log
            </h1>
            <p className="text-xs text-zinc-400">
              Clinical · Research · Shadowing · Leadership · CanMEDS Tracker &amp; CV Builder
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCarmsMarkdown(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 cursor-pointer"
          >
            {copiedMd ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-cyan-400" />}
            <span className="hidden sm:inline">{copiedMd ? 'Copied CV!' : 'Copy CV'}</span>
          </button>
          <button
            onClick={() => exportCarmsMarkdown(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">Export .md</span>
          </button>
          <button
            onClick={openNewModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-white text-xs font-semibold shadow-sm cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Activity</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {needsMigration && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/35 text-xs space-y-1.5">
            <div className="font-semibold text-amber-200 flex items-center gap-2">
              <Database className="h-4 w-4 text-amber-400" />
              Run One-Time SQL Migration to Enable CaRMS Portfolio Storage
            </div>
            <p className="text-zinc-300">
              Run <code className="text-cyan-300 bg-zinc-900 px-1.5 py-0.5 rounded">web/supabase_migrations/add_os_upgrades_tables.sql</code> in your{' '}
              <a
                href="https://supabase.com/dashboard/project/lqjdolzbzxrqlpykospy/sql/new"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline"
              >
                Supabase SQL Editor
              </a>
              .
            </p>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4">
            <div className="text-xs text-zinc-400">Logged Activities</div>
            <div className="mt-1.5 text-2xl font-bold text-white">{summary.totalEntries}</div>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4">
            <div className="text-xs text-zinc-400">Total Verified Hours</div>
            <div className="mt-1.5 text-2xl font-bold text-cyan-300 font-mono">
              {summary.totalHours}h
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4">
            <div className="text-xs text-zinc-400">Ongoing Roles</div>
            <div className="mt-1.5 text-2xl font-bold text-emerald-400">{summary.ongoingCount}</div>
          </div>
          <div className="rounded-xl border border-zinc-800/80 bg-[#121218] p-4">
            <div className="text-xs text-zinc-400">CanMEDS Coverage</div>
            <div className="mt-1.5 text-2xl font-bold text-amber-300">
              {coveredCanmedsCount} / 7
            </div>
          </div>
        </div>

        {/* 7-Role CanMEDS Coverage Bar */}
        <section className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-4 space-y-2.5">
          <div className="text-xs font-semibold text-zinc-300">CanMEDS Role Balance</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {CANMEDS_ROLES.map((role) => {
              const count = summary.canmedsCoverage[role] || 0;
              return (
                <div
                  key={role}
                  className={`p-2.5 rounded-xl border text-center ${
                    count > 0
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                      : 'bg-zinc-900/60 border-zinc-800 text-zinc-500'
                  }`}
                >
                  <div className="text-[11px] font-semibold truncate">{role}</div>
                  <div className="text-sm font-mono font-bold mt-0.5">{count}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Search & Category Tabs */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activities, preceptors, verifiers, CanMEDS roles, or bullets..."
              className="w-full bg-[#121218] border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['all', ...PORTFOLIO_CATEGORIES].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border transition cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                    : 'bg-[#121218] text-zinc-400 border-zinc-800 hover:text-white'
                }`}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>
        </div>

        {/* Entries List */}
        {loading ? (
          <div className="py-16 text-center text-xs text-zinc-400">
            <RefreshCw className="h-6 w-6 text-amber-400 animate-spin mx-auto mb-2" />
            Loading CaRMS portfolio...
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center rounded-2xl border border-dashed border-zinc-800 bg-[#121218]/40 space-y-2">
            <Award className="h-9 w-9 text-zinc-600 mx-auto" />
            <p className="text-sm font-medium text-zinc-300">No portfolio entries yet</p>
            <p className="text-xs text-zinc-500">
              Start logging shadowing, research, clubs, awards, and verifiers early so CaRMS prep is effortless!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-zinc-800/90 bg-[#121218] p-5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {CATEGORY_LABELS[item.category] || item.category}
                      </span>
                      {item.is_ongoing && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          Ongoing
                        </span>
                      )}
                      <span className="text-xs font-mono text-zinc-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {item.hours}h · {item.start_date || 'N/A'} –{' '}
                        {item.is_ongoing ? 'Present' : item.end_date || 'N/A'}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-white">
                      {item.title}
                      {item.role ? <span className="text-cyan-300 font-normal"> · {item.role}</span> : null}
                    </h3>
                    {item.organization && (
                      <div className="text-xs text-zinc-400">{item.organization}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEditModal(item)}
                      className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer"
                      title="Edit entry"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-2 rounded-lg bg-zinc-900 hover:bg-rose-500/15 border border-zinc-800 text-zinc-400 hover:text-rose-300 cursor-pointer"
                      title="Delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {item.carms_bullets && item.carms_bullets.length > 0 ? (
                  <ul className="space-y-1 text-xs text-zinc-200 list-disc list-inside">
                    {item.carms_bullets.map((b, i) => (
                      <li key={i} className="leading-relaxed">
                        {b}
                      </li>
                    ))}
                  </ul>
                ) : item.description ? (
                  <p className="text-xs text-zinc-300 leading-relaxed">{item.description}</p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-[11px]">
                  <div className="flex flex-wrap gap-1.5">
                    {(item.canmeds_roles || []).map((r) => (
                      <span
                        key={r}
                        className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 font-medium"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                  {item.verifier_name && (
                    <span className="text-zinc-400 flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                      Verifier: {item.verifier_name}
                      {item.verifier_contact ? ` (${item.verifier_contact})` : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add / Edit Activity Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveEntry}
            className="w-full max-w-2xl rounded-2xl bg-[#121218] border border-zinc-700 p-5 space-y-4 shadow-2xl my-auto text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                {form.id ? 'Edit CaRMS Portfolio Entry' : 'Add CaRMS Portfolio Entry'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-zinc-400 block mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as PortfolioEntry['category'] })
                  }
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                >
                  {PORTFOLIO_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Activity / Project Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Internal Medicine Observership"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Organization / Hospital</label>
                <input
                  type="text"
                  value={form.organization}
                  onChange={(e) => setForm({ ...form, organization: e.target.value })}
                  placeholder="e.g. London Health Sciences Centre"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Your Role</label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="e.g. Medical Student Observer / First Author"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white [color-scheme:dark]"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-zinc-400 block mb-1">Hours</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={form.hours}
                    onChange={(e) => setForm({ ...form, hours: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <label className="flex items-center gap-1.5 pb-2 text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_ongoing}
                    onChange={(e) => setForm({ ...form, is_ongoing: e.target.checked })}
                    className="h-3.5 w-3.5"
                  />
                  <span>Ongoing</span>
                </label>
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Verifier / Preceptor Name</label>
                <input
                  type="text"
                  value={form.verifier_name}
                  onChange={(e) => setForm({ ...form, verifier_name: e.target.value })}
                  placeholder="Dr. Jane Doe"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Verifier Email / Contact</label>
                <input
                  type="text"
                  value={form.verifier_contact}
                  onChange={(e) => setForm({ ...form, verifier_contact: e.target.value })}
                  placeholder="jdoe@lhsc.on.ca"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1.5">CanMEDS Roles</label>
              <div className="flex flex-wrap gap-1.5">
                {CANMEDS_ROLES.map((role) => {
                  const active = form.canmeds_roles.includes(role);
                  return (
                    <button
                      type="button"
                      key={role}
                      onClick={() =>
                        setForm({
                          ...form,
                          canmeds_roles: active
                            ? form.canmeds_roles.filter((r) => r !== role)
                            : [...form.canmeds_roles, role],
                        })
                      }
                      className={`px-2.5 py-1 rounded-lg border text-[11px] transition cursor-pointer ${
                        active
                          ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/60 font-semibold'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-zinc-400 block mb-1">Raw Notes / Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What you did, patient populations, techniques, outcomes..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-zinc-400">CaRMS CV Bullets (1 per line)</label>
                <button
                  type="button"
                  onClick={handleDraftBullets}
                  disabled={draftingBullets || (!form.title.trim() && !form.description.trim())}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/35 text-[11px] font-semibold cursor-pointer"
                >
                  <Sparkles className={`h-3 w-3 ${draftingBullets ? 'animate-spin' : ''}`} />
                  <span>{draftingBullets ? 'Drafting...' : 'AI Draft CaRMS Bullets'}</span>
                </button>
              </div>
              <textarea
                rows={3}
                value={form.carms_bullets}
                onChange={(e) => setForm({ ...form, carms_bullets: e.target.value })}
                placeholder="One polished CV bullet per line..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 text-white font-semibold cursor-pointer"
              >
                {saving ? 'Saving...' : form.id ? 'Save Changes' : 'Add Activity'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
