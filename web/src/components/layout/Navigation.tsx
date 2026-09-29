'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Rocket,
  GraduationCap,
  Activity,
  BookOpen,
  Dumbbell,
  UtensilsCrossed,
  Bot,
  Sparkles,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  activeMatch: (p: string) => boolean;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Home', href: '/', icon: Home, activeMatch: (p: string) => p === '/' },
  { name: 'Mission Control', href: '/tasks', icon: Rocket, activeMatch: (p: string) => p.startsWith('/tasks') },
  { name: 'School Sync', href: '/school', icon: GraduationCap, activeMatch: (p: string) => p.startsWith('/school') },
  { name: 'Habit Tracker', href: '/habits', icon: Activity, activeMatch: (p: string) => p.startsWith('/habits') },
  { name: 'Daily Journal', href: '/journal', icon: BookOpen, activeMatch: (p: string) => p.startsWith('/journal') },
  { name: 'Workout Tracker', href: '/workouts', icon: Dumbbell, activeMatch: (p: string) => p.startsWith('/workouts') },
  { name: 'Meal Prep', href: '/meals', icon: UtensilsCrossed, activeMatch: (p: string) => p.startsWith('/meals') },
  { name: 'AI Scheduler', href: '/ai', icon: Bot, activeMatch: (p: string) => p.startsWith('/ai') },
];

export default function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#0A0A0D] text-white">
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-zinc-800/80 bg-[#0F0F14] sticky top-0 h-screen z-50">
        {/* Brand Header */}
        <div className="p-5 border-b border-zinc-800/80 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              Kevin-OS <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">v2.0</span>
            </h1>
            <p className="text-[11px] text-zinc-400">Personal Command Center</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.activeMatch(pathname);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-gradient-to-r from-zinc-800 to-zinc-800/80 text-white shadow-sm border border-zinc-700/80 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${isActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 font-mono">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Card & Database Indicator */}
        <div className="p-4 border-t border-zinc-800/80 bg-[#121218]/50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-purple-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow-md shadow-purple-500/20">
              KN
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">Kevin Nguyen</div>
              <div className="text-[10px] text-zinc-400 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Supabase Live</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        {children}
      </div>

      {/* Mobile Bottom Navigation Bar (iPhone) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0F0F14]/95 backdrop-blur-lg border-t border-zinc-800/90 px-2 py-1.5 flex items-center justify-around">
        {NAV_ITEMS.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const isActive = item.activeMatch(pathname);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[10px] font-medium transition ${
                isActive ? 'text-cyan-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className={`h-4 w-4 mb-0.5 ${isActive ? 'text-cyan-400' : 'text-zinc-400'}`} />
              <span className="truncate max-w-[65px]">{item.name.replace(' Tracker', '')}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
