'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Dumbbell,
  Flame,
  GraduationCap,
  HeartPulse,
  Home,
  LayoutGrid,
  Mail,
  Rocket,
  Search,
  Sparkles,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import CommandPalette from '@/components/layout/CommandPalette';

interface NavItem {
  name: string;
  shortName?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  activeMatch: (p: string) => boolean;
  group: 'Core' | 'Performance' | 'Strategy';
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Home', href: '/', icon: Home, activeMatch: (p) => p === '/', group: 'Core' },
  { name: 'Mission Control', shortName: 'Tasks', href: '/tasks', icon: Rocket, activeMatch: (p) => p.startsWith('/tasks'), group: 'Core' },
  { name: 'School Sync', shortName: 'School', href: '/school', icon: GraduationCap, activeMatch: (p) => p.startsWith('/school'), group: 'Core' },
  { name: 'Anki', href: '/anki', icon: Brain, activeMatch: (p) => p.startsWith('/anki'), group: 'Core' },
  { name: 'Email Hub', shortName: 'Email', href: '/email', icon: Mail, activeMatch: (p) => p.startsWith('/email'), group: 'Core' },
  { name: 'AI Scheduler', shortName: 'AI Plan', href: '/ai', icon: Bot, activeMatch: (p) => p.startsWith('/ai'), group: 'Core' },

  { name: 'Habit Tracker', shortName: 'Habits', href: '/habits', icon: Flame, activeMatch: (p) => p.startsWith('/habits'), group: 'Performance' },
  { name: 'Health Tracker', shortName: 'Health', href: '/health', icon: HeartPulse, activeMatch: (p) => p.startsWith('/health'), group: 'Performance' },
  { name: 'Workout Tracker', shortName: 'Workouts', href: '/workouts', icon: Dumbbell, activeMatch: (p) => p.startsWith('/workouts'), group: 'Performance' },
  { name: 'Meal Prep', shortName: 'Meals', href: '/meals', icon: UtensilsCrossed, activeMatch: (p) => p.startsWith('/meals'), group: 'Performance' },
  { name: 'Daily Journal', shortName: 'Journal', href: '/journal', icon: BookOpen, activeMatch: (p) => p.startsWith('/journal'), group: 'Performance' },

  { name: 'Weekly Review', shortName: 'Review', href: '/review', icon: BarChart3, activeMatch: (p) => p.startsWith('/review'), group: 'Strategy' },
  { name: 'CaRMS Portfolio', shortName: 'CaRMS', href: '/portfolio', icon: Award, activeMatch: (p) => p.startsWith('/portfolio'), group: 'Strategy' },
];

const MOBILE_PRIMARY_HREFS = ['/', '/tasks', '/school', '/anki'];

export default function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  // Register lightweight PWA service worker once on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Global Cmd+K / Ctrl+K Command Palette shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setMoreSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const mobilePrimaryItems = NAV_ITEMS.filter((i) => MOBILE_PRIMARY_HREFS.includes(i.href));
  const isMoreRouteActive = !mobilePrimaryItems.some((i) => i.activeMatch(pathname));

  return (
    <div className="flex min-h-screen bg-[#0A0A0D] text-white">
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-zinc-800/80 bg-[#0F0F14] sticky top-0 h-screen z-50">
        {/* Brand Header */}
        <div className="p-4 border-b border-zinc-800/80 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                Kevin-OS <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">v2.5</span>
              </h1>
              <p className="text-[11px] text-zinc-400">Personal Command Center</p>
            </div>
          </div>

          {/* Global Cmd+K Trigger */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#0A0B10] border border-zinc-800 hover:border-cyan-500/40 text-xs text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-cyan-400" />
              <span>Quick Capture / Jump</span>
            </span>
            <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-400">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Grouped Navigation Links */}
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {(['Core', 'Performance', 'Strategy'] as const).map((groupName) => (
            <div key={groupName} className="space-y-1">
              <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {groupName}
              </div>
              {NAV_ITEMS.filter((i) => i.group === groupName).map((item) => {
                const Icon = item.icon;
                const isActive = item.activeMatch(pathname);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-gradient-to-r from-zinc-800 to-zinc-800/80 text-white shadow-sm border border-zinc-700/80 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User Card */}
        <div className="p-4 border-t border-zinc-800/80 bg-[#121218]/50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow-md shadow-purple-500/20">
              KN
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">Kevin Nguyen</div>
              <div className="text-[10px] text-zinc-400 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Schulich MD · Live</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0">{children}</div>

      {/* Upgraded iPhone PWA Bottom Navigation Bar (4 Core Tabs + "More" All-Apps Sheet) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0F0F14]/95 backdrop-blur-xl border-t border-zinc-800/90 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-around">
        {mobilePrimaryItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.activeMatch(pathname);
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => setMoreSheetOpen(false)}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl text-[10px] font-medium transition ${
                isActive ? 'text-cyan-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className={`h-4.5 w-4.5 mb-0.5 ${isActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
              <span>{item.shortName || item.name}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreSheetOpen((v) => !v)}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl text-[10px] font-medium transition cursor-pointer ${
            moreSheetOpen || isMoreRouteActive
              ? 'text-cyan-400 font-semibold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <LayoutGrid className={`h-4.5 w-4.5 mb-0.5 ${moreSheetOpen || isMoreRouteActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
          <span>More</span>
        </button>
      </nav>

      {/* Mobile "More" Slide-Up Drawer (All 12 Pages + Quick Capture) */}
      {moreSheetOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreSheetOpen(false);
          }}
        >
          <div className="w-full rounded-t-3xl bg-[#11121A] border-t border-zinc-700/80 p-5 pb-24 space-y-4 shadow-2xl max-h-[82vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                All Kevin-OS Modules
              </div>
              <button
                onClick={() => setMoreSheetOpen(false)}
                className="p-1.5 rounded-lg bg-zinc-900 text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={() => {
                setMoreSheetOpen(false);
                setPaletteOpen(true);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 border border-cyan-500/35 text-xs font-semibold text-cyan-200"
            >
              <Search className="h-4 w-4 text-cyan-400" />
              <span>Quick Capture / Search Anki &amp; Tasks</span>
            </button>

            <div className="grid grid-cols-3 gap-2.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = item.activeMatch(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreSheetOpen(false)}
                    className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border text-center transition ${
                      isActive
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-white'
                        : 'bg-[#171824] border-zinc-800 text-zinc-300'
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${isActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
                    <span className="text-[11px] font-medium leading-tight">
                      {item.shortName || item.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Global Command Palette Modal */}
      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
