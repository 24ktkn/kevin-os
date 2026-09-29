'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  UtensilsCrossed,
  ShoppingCart,
  Calendar,
  BookOpen,
  CheckCircle2,
  Circle,
  RefreshCw,
  Flame,
  Clock,
  Sparkles,
  ChevronRight,
  Filter,
  Check,
} from 'lucide-react';
import {
  CostcoGroceryItem,
  MealPlanWeek,
  HighProteinRecipe,
  MealsResponseData,
} from '@/types/meal';

export default function MealsPage() {
  const [data, setData] = useState<MealsResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'costco' | 'rotation' | 'recipes'>('costco');
  
  // Warehouse Trip Selection
  const [selectedTrip, setSelectedTrip] = useState<'Trip 1' | 'Trip 2'>('Trip 1');
  
  // Weekly Rotation Selection
  const [selectedWeek, setSelectedWeek] = useState<number>(1);

  // Checked Grocery Items State (persisted in localStorage)
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  // Load checked items from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('kevin_costco_checked_items');
      if (saved) {
        setCheckedItems(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
  }, []);

  // Save checked items to localStorage
  const toggleItem = (itemId: string) => {
    setCheckedItems((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] };
      try {
        localStorage.setItem('kevin_costco_checked_items', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const clearCheckedItems = () => {
    setCheckedItems({});
    try {
      localStorage.removeItem('kevin_costco_checked_items');
    } catch {
      // ignore
    }
  };

  // Fetch Meals & Costco Data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meals?trip=${encodeURIComponent(selectedTrip)}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        setSelectedWeek(json.activeWeek);
      }
    } catch (err) {
      console.error('Failed to load meal data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedTrip]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter grocery items by selected trip
  const filteredGroceries = (data?.groceryItems || []).filter((item) =>
    selectedTrip === 'Trip 1'
      ? item.trip.toLowerCase().includes('1')
      : item.trip.toLowerCase().includes('2')
  );

  // Group by department
  const groupedDepartments = filteredGroceries.reduce<Record<string, CostcoGroceryItem[]>>((acc, item) => {
    const dept = item.department || 'General';
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(item);
    return acc;
  }, {});

  const totalGroceryCount = filteredGroceries.length;
  const checkedGroceryCount = filteredGroceries.filter((item) => checkedItems[item.id]).length;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0D] text-white p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🥗</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-400">
              Provisioning & Nutrition Core
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Meal Prep & Costco Hub
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Warehouse transit shopping checklists, 4-week meal rotation schedules, and high-protein recipes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 hover:text-white transition shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-orange-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Warehouse Transit Status Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider">
              Warehouse Transit Mode
            </div>
            <div className="text-lg font-black text-orange-400 mt-1 flex items-center gap-1.5">
              <span>🛒</span> {selectedTrip === 'Trip 1' ? 'Trip 1 (Day 1 Master Stock)' : 'Trip 2 (Day 15 Refresh)'}
            </div>
          </div>
          <div className="flex gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            <button
              onClick={() => setSelectedTrip('Trip 1')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                selectedTrip === 'Trip 1' ? 'bg-orange-500 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Trip 1
            </button>
            <button
              onClick={() => setSelectedTrip('Trip 2')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                selectedTrip === 'Trip 2' ? 'bg-orange-500 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Trip 2
            </button>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider">
              Costco Cart Progress
            </div>
            <div className="text-xl font-black text-white mt-1">
              {checkedGroceryCount} / {totalGroceryCount}{' '}
              <span className="text-xs text-zinc-400 font-semibold">items checked</span>
            </div>
          </div>
          <div className="w-16 h-2 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-300"
              style={{
                width: `${totalGroceryCount > 0 ? (checkedGroceryCount / totalGroceryCount) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider">
              Active Rotation Week
            </div>
            <div className="text-xl font-black text-cyan-400 mt-1">
              Week {data ? data.activeWeek : 1}{' '}
              <span className="text-xs text-zinc-400 font-semibold">(Current Cycle)</span>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            Auto-Sync
          </span>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('costco')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'costco'
              ? 'bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          <span>Costco Checklist</span>
        </button>

        <button
          onClick={() => setActiveTab('rotation')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'rotation'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>Weekly Rotation Manifest</span>
        </button>

        <button
          onClick={() => setActiveTab('recipes')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
            activeTab === 'recipes'
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>High-Protein Recipes</span>
        </button>
      </div>

      {/* TAB 1: COSTCO CHECKLIST */}
      {activeTab === 'costco' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-400">
              Tap any item to strike it off while walking the warehouse. State persists across reloads.
            </div>
            {checkedGroceryCount > 0 && (
              <button
                onClick={clearCheckedItems}
                className="text-xs text-zinc-400 hover:text-rose-400 font-semibold transition"
              >
                Reset Checked
              </button>
            )}
          </div>

          <div className="space-y-6">
            {Object.keys(groupedDepartments).length > 0 ? (
              Object.entries(groupedDepartments).map(([dept, items]) => (
                <div key={dept} className="space-y-2.5">
                  {/* Department Banner */}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#181820] border-l-4 border-orange-500">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                      {dept}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-semibold">
                      ({items.length} items)
                    </span>
                  </div>

                  {/* Department Items Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {items.map((item) => {
                      const isChecked = Boolean(checkedItems[item.id]);

                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleItem(item.id)}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
                            isChecked
                              ? 'bg-zinc-900/40 border-zinc-800/40 opacity-50'
                              : 'bg-[#14141B] border-zinc-800/80 hover:border-orange-500/40'
                          }`}
                        >
                          <div
                            className={`h-5 w-5 rounded-md mt-0.5 flex items-center justify-center shrink-0 transition ${
                              isChecked
                                ? 'bg-orange-500 text-white'
                                : 'border border-zinc-700 bg-zinc-900'
                            }`}
                          >
                            {isChecked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div
                              className={`text-sm font-bold truncate ${
                                isChecked ? 'line-through text-zinc-500' : 'text-white'
                              }`}
                            >
                              {item.itemName}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {item.targetScaleSize && (
                                <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-orange-300">
                                  {item.targetScaleSize}
                                </span>
                              )}
                              {item.mealAssignment && (
                                <span className="text-[10px] font-semibold text-zinc-400 truncate">
                                  {item.mealAssignment}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-zinc-500">
                Loading Costco provisioning checklist...
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: WEEKLY ROTATION MANIFEST */}
      {activeTab === 'rotation' && (
        <div className="space-y-6">
          {/* Week Selector Ribbon */}
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((w) => (
              <button
                key={w}
                onClick={() => setSelectedWeek(w)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  selectedWeek === w
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <span>Week {w}</span>
                {data && data.activeWeek === w && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            ))}
          </div>

          {/* Daily Schedule Cards */}
          <div className="space-y-3">
            {data && data.weeklyPlan ? (
              data.weeklyPlan.schedule.map((day, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-[#14141B] border border-zinc-800/80 hover:border-zinc-700/80 transition space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                    <span className="text-sm font-black text-white flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-cyan-400" />
                      {day.dayName}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-bold text-emerald-400">{day.proteinGrams}g Protein</span>
                      <span className="text-zinc-500">•</span>
                      <span className="font-semibold text-amber-400">{day.calories} kcal</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60">
                      <div className="text-[10px] font-bold uppercase text-orange-400 mb-0.5">
                        🍳 Breakfast
                      </div>
                      <div className="text-zinc-200 font-medium">{day.breakfast}</div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60">
                      <div className="text-[10px] font-bold uppercase text-cyan-400 mb-0.5">
                        🍱 Lunch
                      </div>
                      <div className="text-zinc-200 font-medium">{day.lunch}</div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60">
                      <div className="text-[10px] font-bold uppercase text-purple-400 mb-0.5">
                        🥩 Dinner
                      </div>
                      <div className="text-zinc-200 font-medium">{day.dinner}</div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60">
                      <div className="text-[10px] font-bold uppercase text-emerald-400 mb-0.5">
                        🥣 Snack / Proats
                      </div>
                      <div className="text-zinc-200 font-medium">{day.snack}</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-zinc-500">Loading weekly rotation...</div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: HIGH-PROTEIN RECIPES */}
      {activeTab === 'recipes' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {data && data.recipes.length > 0 ? (
            data.recipes.map((recipe) => (
              <div
                key={recipe.id}
                className="p-5 rounded-2xl bg-[#14141B] border border-zinc-800/80 flex flex-col justify-between space-y-4 hover:border-zinc-700/80 transition"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {recipe.category}
                    </span>
                    <span className="text-xs text-zinc-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {recipe.prepTimeMins} mins
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white leading-snug">
                    {recipe.title}
                  </h3>

                  {/* Macro Ribbon */}
                  <div className="grid grid-cols-4 gap-1.5 text-center p-2 rounded-xl bg-zinc-900 border border-zinc-800">
                    <div>
                      <div className="text-xs font-black text-white">{recipe.calories}</div>
                      <div className="text-[9px] font-bold text-zinc-500 uppercase">Calories</div>
                    </div>
                    <div>
                      <div className="text-xs font-black text-emerald-400">{recipe.proteinGrams}g</div>
                      <div className="text-[9px] font-bold text-zinc-500 uppercase">Protein</div>
                    </div>
                    <div>
                      <div className="text-xs font-black text-cyan-400">{recipe.carbsGrams}g</div>
                      <div className="text-[9px] font-bold text-zinc-500 uppercase">Carbs</div>
                    </div>
                    <div>
                      <div className="text-xs font-black text-amber-400">{recipe.fatGrams}g</div>
                      <div className="text-[9px] font-bold text-zinc-500 uppercase">Fat</div>
                    </div>
                  </div>

                  {/* Ingredients */}
                  <div className="space-y-1.5 pt-2">
                    <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider">
                      Ingredients (Costco Bulked):
                    </div>
                    <ul className="text-xs text-zinc-300 space-y-1 list-disc list-inside">
                      {recipe.ingredients.map((ing, iIdx) => (
                        <li key={iIdx} className="leading-tight truncate">
                          {ing}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Instructions */}
                  <div className="space-y-1.5 pt-2">
                    <div className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider">
                      Batch Instructions:
                    </div>
                    <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside">
                      {recipe.instructions.map((ins, insIdx) => (
                        <li key={insIdx} className="leading-tight">
                          {ins}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap gap-1">
                  {recipe.tags.map((t, tIdx) => (
                    <span
                      key={tIdx}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full p-8 text-center text-zinc-500">Loading recipes...</div>
          )}
        </div>
      )}
    </div>
  );
}
