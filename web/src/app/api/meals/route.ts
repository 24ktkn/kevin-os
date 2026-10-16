import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, SPREADSHEET_ID } from '@/lib/google-sheets';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getTodayDateStr } from '@/lib/date-utils';
import {
  CostcoGroceryItem,
  MealPlanWeek,
  HighProteinRecipe,
  MealsResponseData,
} from '@/types/meal';

export const dynamic = 'force-dynamic';

const DEFAULT_RECIPES: HighProteinRecipe[] = [
  {
    id: 'kirkland-ground-beef-bowls',
    title: 'Kirkland Lean Beef & Jasmine Rice Power Bowls',
    category: 'Lunch',
    servings: 5,
    prepTimeMins: 25,
    calories: 580,
    proteinGrams: 48,
    carbsGrams: 62,
    fatGrams: 14,
    ingredients: [
      '2 lbs Kirkland Extra Lean Ground Beef (93/7)',
      '3 cups Jasmine Rice (dry measure, cooked with bone broth)',
      '1 bag Kirkland Steamed Broccoli florets',
      '2 tbsp Low-sodium Soy Sauce + 1 tbsp Sriracha',
      '1 tbsp Garlic powder, onion powder, smoked paprika',
    ],
    instructions: [
      'Brown ground beef in a large skillet over medium-high heat, breaking it apart with a spatula.',
      'Drain excess liquid, season generously with garlic powder, paprika, and light soy sauce.',
      'Steam broccoli florets until bright green and tender-crisp (approx. 5 minutes).',
      'Portion cooked jasmine rice evenly into 5 meal prep containers.',
      'Top each with 6 oz seasoned beef and steamed broccoli. Drizzle sriracha to taste.',
    ],
    tags: ['High Protein', 'Bulking', 'Costco Essential'],
  },
  {
    id: 'lemon-herb-grilled-chicken',
    title: 'Herb-Marinated Kirkland Chicken Breasts & Sweet Potatoes',
    category: 'Dinner',
    servings: 5,
    prepTimeMins: 35,
    calories: 510,
    proteinGrams: 52,
    carbsGrams: 46,
    fatGrams: 10,
    ingredients: [
      '2.5 lbs Kirkland Frozen Chicken Breasts (thawed & butterflied)',
      '4 medium Sweet Potatoes (diced into 1/2-inch cubes)',
      '2 tbsp Olive oil',
      '1 tbsp Italian seasoning + 1 lemon (juiced)',
      'Salt, black pepper, and garlic to taste',
    ],
    instructions: [
      'Preheat oven or air fryer to 400°F (205°C).',
      'Toss diced sweet potatoes with 1 tbsp olive oil, salt, and smoked paprika. Roast for 25 mins.',
      'Marinate butterflied chicken breasts in lemon juice, olive oil, and herbs for 15 minutes.',
      'Sear chicken on a hot grill pan for 5-6 mins per side until internal temp hits 165°F.',
      'Pack each meal container with 6.5 oz sliced chicken and 1 cup roasted sweet potatoes.',
    ],
    tags: ['Lean Muscle', 'High Volume', 'Anti-Inflammatory'],
  },
  {
    id: 'overnight-fairlife-proats',
    title: 'Fairlife High-Protein Chocolate Berry Overnight Oats',
    category: 'Breakfast',
    servings: 5,
    prepTimeMins: 15,
    calories: 460,
    proteinGrams: 42,
    carbsGrams: 54,
    fatGrams: 8,
    ingredients: [
      '2.5 cups Rolled Oats (Costco Quaker bulk box)',
      '4 cups Fairlife Chocolate 30g Protein Shakes',
      '5 tbsp Chia Seeds',
      '1.5 cups Frozen Organic Blueberries',
      '2 tbsp Peanut Butter Powder',
    ],
    instructions: [
      'Line up 5 wide-mouth mason jars on your counter.',
      'Distribute 1/2 cup rolled oats, 1 tbsp chia seeds, and 1 scoop PB powder into each jar.',
      'Pour approx. 3/4 cup Fairlife shake into each jar and stir thoroughly.',
      'Top with frozen blueberries, seal airtight, and refrigerate overnight (ready for 5 mornings).',
    ],
    tags: ['Quick Prep', 'No Cook', 'Grab & Go'],
  },
];

const WEEKLY_PLANS: MealPlanWeek[] = [
  {
    weekNumber: 1,
    theme: 'High-Protein Muscle Hypertrophy & Clean Bulking (Trip 1)',
    dailyAverageCalories: 2645,
    dailyAverageProtein: 185,
    schedule: [
      {
        dayName: 'Monday',
        breakfast: 'Fairlife Overnight Proats + 2 Fresh Boiled Eggs',
        lunch: 'Kirkland Lean Beef & Jasmine Rice Power Bowl',
        dinner: 'Herb-Marinated Grilled Chicken & Sweet Potatoes',
        snack: 'Kirkland Greek Yogurt (1 cup) + Mixed Berries',
        proteinGrams: 188,
        calories: 2620,
      },
      {
        dayName: 'Tuesday',
        breakfast: 'Fairlife Overnight Proats + 2 Fresh Boiled Eggs',
        lunch: 'Kirkland Lean Beef & Jasmine Rice Power Bowl',
        dinner: 'Herb-Marinated Grilled Chicken & Sweet Potatoes',
        snack: 'Fairlife Protein Shake + Almonds',
        proteinGrams: 192,
        calories: 2650,
      },
      {
        dayName: 'Wednesday',
        breakfast: 'Fairlife Overnight Proats + 2 Fresh Boiled Eggs',
        lunch: 'Kirkland Lean Beef & Jasmine Rice Power Bowl',
        dinner: 'Herb-Marinated Grilled Chicken & Sweet Potatoes',
        snack: 'Kirkland Greek Yogurt + Blueberries',
        proteinGrams: 186,
        calories: 2590,
      },
      {
        dayName: 'Thursday',
        breakfast: 'Fairlife Overnight Proats + 2 Fresh Boiled Eggs',
        lunch: 'Kirkland Lean Beef & Jasmine Rice Power Bowl',
        dinner: 'Herb-Marinated Grilled Chicken & Sweet Potatoes',
        snack: 'Fairlife Protein Shake + Banana',
        proteinGrams: 190,
        calories: 2680,
      },
      {
        dayName: 'Friday',
        breakfast: 'Fairlife Overnight Proats + 2 Fresh Boiled Eggs',
        lunch: 'Kirkland Lean Beef & Jasmine Rice Power Bowl',
        dinner: 'Herb-Marinated Grilled Chicken & Sweet Potatoes',
        snack: 'Kirkland Greek Yogurt Bowl',
        proteinGrams: 184,
        calories: 2610,
      },
      {
        dayName: 'Saturday',
        breakfast: 'Scrambled Fresh Eggs (4) + Sourdough Toast + Avocado',
        lunch: 'Costco Rotisserie Chicken Breast Salad & Quinoa',
        dinner: 'Lean Ground Beef Tacos with High-Fiber Tortillas',
        snack: 'Protein Shake + Mixed Berries',
        proteinGrams: 178,
        calories: 2750,
      },
      {
        dayName: 'Sunday (Prep Day)',
        breakfast: 'Protein French Toast + Fresh Fruit',
        lunch: 'Grilled Chicken Wrap + Veggies',
        dinner: 'Master Meal Prep Batch Tasting & Macro Balance',
        snack: 'Kirkland Greek Yogurt Parfait',
        proteinGrams: 180,
        calories: 2600,
      },
    ],
  },
  {
    weekNumber: 2,
    theme: 'Mediterranean Lean Mass & Endurance Rotation (Trip 1)',
    dailyAverageCalories: 2610,
    dailyAverageProtein: 188,
    schedule: [
      {
        dayName: 'Monday',
        breakfast: 'Greek Yogurt Power Parfait + Oats + Chia Seeds',
        lunch: 'Herb-Marinated Kirkland Chicken & Quinoa Bowl',
        dinner: 'Kirkland Lean Beef Stir-Fry & Jasmine Rice',
        snack: 'Fairlife Chocolate Protein Shake + Apple',
        proteinGrams: 190,
        calories: 2610,
      },
      {
        dayName: 'Tuesday',
        breakfast: 'Scrambled Eggs (3) + Egg Whites + Spinach Wrap',
        lunch: 'Herb-Marinated Kirkland Chicken & Quinoa Bowl',
        dinner: 'Kirkland Lean Beef Stir-Fry & Jasmine Rice',
        snack: 'Kirkland Greek Yogurt + Mixed Berries',
        proteinGrams: 186,
        calories: 2580,
      },
      {
        dayName: 'Wednesday',
        breakfast: 'Greek Yogurt Power Parfait + Oats + Chia Seeds',
        lunch: 'Herb-Marinated Kirkland Chicken & Quinoa Bowl',
        dinner: 'Kirkland Lean Beef Stir-Fry & Jasmine Rice',
        snack: 'Fairlife Protein Shake + Handful Walnuts',
        proteinGrams: 192,
        calories: 2640,
      },
      {
        dayName: 'Thursday',
        breakfast: 'Scrambled Eggs (3) + Egg Whites + Spinach Wrap',
        lunch: 'Herb-Marinated Kirkland Chicken & Quinoa Bowl',
        dinner: 'Kirkland Lean Beef Stir-Fry & Jasmine Rice',
        snack: 'Kirkland Greek Yogurt + Honey & Berries',
        proteinGrams: 185,
        calories: 2595,
      },
      {
        dayName: 'Friday',
        breakfast: 'Fairlife Overnight Proats + Blueberries',
        lunch: 'Herb-Marinated Kirkland Chicken & Quinoa Bowl',
        dinner: 'Kirkland Lean Beef Stir-Fry & Jasmine Rice',
        snack: 'Fairlife Protein Shake + Banana',
        proteinGrams: 189,
        calories: 2630,
      },
      {
        dayName: 'Saturday',
        breakfast: '4-Egg Omelet with Peppers & Sourdough Toast',
        lunch: 'Kirkland Tuna / Chicken Salad Protein Melt',
        dinner: 'Grilled Sirloin / Lean Beef & Roasted Sweet Potatoes',
        snack: 'Greek Yogurt + Dark Chocolate Chips',
        proteinGrams: 194,
        calories: 2690,
      },
      {
        dayName: 'Sunday (Prep Day)',
        breakfast: 'Fairlife Protein Pancakes + Berries',
        lunch: 'Rotisserie Chicken Caesar Salad Bowl',
        dinner: 'Trip 2 Inventory Check & Meal Prep Batch',
        snack: 'Fairlife Protein Shake',
        proteinGrams: 182,
        calories: 2540,
      },
    ],
  },
  {
    weekNumber: 3,
    theme: 'Metabolic Performance & Mid-Month Restock (Trip 2)',
    dailyAverageCalories: 2660,
    dailyAverageProtein: 190,
    schedule: [
      {
        dayName: 'Monday',
        breakfast: 'Fairlife Overnight Proats + 2 Hard-Boiled Eggs',
        lunch: 'Chipotle-Style Kirkland Chicken Burrito Bowl',
        dinner: 'Lean Ground Beef & Roasted Sweet Potato Mash',
        snack: 'Kirkland Greek Yogurt + Organic Blueberries',
        proteinGrams: 192,
        calories: 2670,
      },
      {
        dayName: 'Tuesday',
        breakfast: 'Fairlife Overnight Proats + 2 Hard-Boiled Eggs',
        lunch: 'Chipotle-Style Kirkland Chicken Burrito Bowl',
        dinner: 'Lean Ground Beef & Roasted Sweet Potato Mash',
        snack: 'Fairlife Shake + Rice Cakes & PB',
        proteinGrams: 194,
        calories: 2690,
      },
      {
        dayName: 'Wednesday',
        breakfast: 'Fairlife Overnight Proats + 2 Hard-Boiled Eggs',
        lunch: 'Chipotle-Style Kirkland Chicken Burrito Bowl',
        dinner: 'Lean Ground Beef & Roasted Sweet Potato Mash',
        snack: 'Kirkland Greek Yogurt + Chia Seeds',
        proteinGrams: 188,
        calories: 2620,
      },
      {
        dayName: 'Thursday',
        breakfast: 'Fairlife Overnight Proats + 2 Hard-Boiled Eggs',
        lunch: 'Chipotle-Style Kirkland Chicken Burrito Bowl',
        dinner: 'Lean Ground Beef & Roasted Sweet Potato Mash',
        snack: 'Fairlife Shake + Banana',
        proteinGrams: 191,
        calories: 2660,
      },
      {
        dayName: 'Friday',
        breakfast: 'Fairlife Overnight Proats + 2 Hard-Boiled Eggs',
        lunch: 'Chipotle-Style Kirkland Chicken Burrito Bowl',
        dinner: 'Lean Ground Beef & Roasted Sweet Potato Mash',
        snack: 'Kirkland Greek Yogurt Parfait',
        proteinGrams: 187,
        calories: 2630,
      },
      {
        dayName: 'Saturday',
        breakfast: 'Steak & Eggs Breakfast Skillet + Potatoes',
        lunch: 'Grilled Chicken Pita Wrap + Greek Salad',
        dinner: 'High-Protein Bolognese over Chickpea Pasta',
        snack: 'Fairlife Protein Shake',
        proteinGrams: 195,
        calories: 2740,
      },
      {
        dayName: 'Sunday (Prep Day)',
        breakfast: 'Scrambled Eggs (4) + Oatmeal & Berries',
        lunch: 'Lean Beef & Broccoli Rice Bowl',
        dinner: 'Week 4 Batch Prep & Macro Portioning',
        snack: 'Kirkland Greek Yogurt Bowl',
        proteinGrams: 184,
        calories: 2610,
      },
    ],
  },
  {
    weekNumber: 4,
    theme: 'Peak Conditioning & Lean Recovery Rotation (Trip 2)',
    dailyAverageCalories: 2590,
    dailyAverageProtein: 187,
    schedule: [
      {
        dayName: 'Monday',
        breakfast: 'High-Protein Egg White & Whole Egg Frittata + Oats',
        lunch: 'Teriyaki Glazed Kirkland Chicken & Jasmine Rice',
        dinner: 'Korean-Style Ground Beef Bulgolgi Bowl & Broccoli',
        snack: 'Fairlife Chocolate Shake + Berries',
        proteinGrams: 189,
        calories: 2600,
      },
      {
        dayName: 'Tuesday',
        breakfast: 'High-Protein Egg White & Whole Egg Frittata + Oats',
        lunch: 'Teriyaki Glazed Kirkland Chicken & Jasmine Rice',
        dinner: 'Korean-Style Ground Beef Bulgolgi Bowl & Broccoli',
        snack: 'Kirkland Greek Yogurt + Almonds',
        proteinGrams: 186,
        calories: 2575,
      },
      {
        dayName: 'Wednesday',
        breakfast: 'High-Protein Egg White & Whole Egg Frittata + Oats',
        lunch: 'Teriyaki Glazed Kirkland Chicken & Jasmine Rice',
        dinner: 'Korean-Style Ground Beef Bulgolgi Bowl & Broccoli',
        snack: 'Fairlife Chocolate Shake + Banana',
        proteinGrams: 190,
        calories: 2615,
      },
      {
        dayName: 'Thursday',
        breakfast: 'High-Protein Egg White & Whole Egg Frittata + Oats',
        lunch: 'Teriyaki Glazed Kirkland Chicken & Jasmine Rice',
        dinner: 'Korean-Style Ground Beef Bulgolgi Bowl & Broccoli',
        snack: 'Kirkland Greek Yogurt + Blueberries',
        proteinGrams: 185,
        calories: 2560,
      },
      {
        dayName: 'Friday',
        breakfast: 'High-Protein Egg White & Whole Egg Frittata + Oats',
        lunch: 'Teriyaki Glazed Kirkland Chicken & Jasmine Rice',
        dinner: 'Korean-Style Ground Beef Bulgolgi Bowl & Broccoli',
        snack: 'Fairlife Shake + PB Powder',
        proteinGrams: 191,
        calories: 2605,
      },
      {
        dayName: 'Saturday',
        breakfast: '4 Eggs Any Style + Avocado Sourdough Toast',
        lunch: 'Double-Protein Chicken & Rice Burrito Bowl',
        dinner: 'Lean Beef Burgers (Lettuce/Brioche) + Sweet Potato Fries',
        snack: 'Greek Yogurt Berry Bowl',
        proteinGrams: 188,
        calories: 2650,
      },
      {
        dayName: 'Sunday (Prep Day)',
        breakfast: 'Fairlife Overnight Proats + Fresh Fruit',
        lunch: 'Pantry Clean-Out Stir Fry (Chicken/Beef & Veggies)',
        dinner: 'Next Month Costco Trip 1 Restock Planning & Prep',
        snack: 'Fairlife Protein Shake',
        proteinGrams: 182,
        calories: 2530,
      },
    ],
  },
];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tripParam = url.searchParams.get('trip');
    const weekParam = url.searchParams.get('week');

    const todayStr = getTodayDateStr();
    const dayOfMonth = parseInt(todayStr.split('-')[2] || '1', 10);

    const activeTrip: 'Trip 1' | 'Trip 2' = tripParam
      ? tripParam.includes('2')
        ? 'Trip 2'
        : 'Trip 1'
      : dayOfMonth > 14
        ? 'Trip 2'
        : 'Trip 1';

    const activeWeek = weekParam
      ? Math.min(4, Math.max(1, parseInt(weekParam, 10) || 1))
      : Math.min(4, Math.max(1, Math.ceil(dayOfMonth / 7)));

    const groceryItems: CostcoGroceryItem[] = [];
    const deptSet = new Set<string>();

    const sb = supabaseAdmin || supabase;

    // 1. Primary: Load from Supabase costco_meal_items (sub-20ms)
    if (sb) {
      try {
        const { data: dbItems, error: dbErr } = await sb
          .from('costco_meal_items')
          .select('*')
          .order('sort_order', { ascending: true });

        if (!dbErr && dbItems && dbItems.length > 0) {
          for (const item of dbItems) {
            deptSet.add(item.department || 'General');
            groceryItems.push({
              id: item.id,
              trip: item.trip || 'Trip 1',
              department: item.department || 'General',
              itemName: item.item_name,
              targetScaleSize: item.target_scale_size || '',
              mealAssignment: item.meal_assignment || '',
              isChecked: Boolean(item.is_checked),
            });
          }
        }
      } catch (sbErr) {
        console.warn('Supabase costco_meal_items fetch notice:', sbErr);
      }
    }

    // 2. Fallback to Google Sheets if Supabase is empty
    if (groceryItems.length === 0) {
      try {
        const sheets = getGoogleSheetsClient();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Costco_MealPlan!A1:E100',
        });

        const rows = res.data.values || [];
        if (rows.length > 1) {
          const headers = rows[0].map((h: string) => String(h).trim().toLowerCase());
          const tripIdx = headers.findIndex((h: string) => h.includes('trip') || h.includes('phase'));
          const deptIdx = headers.findIndex((h: string) => h.includes('dept') || h.includes('department'));
          const nameIdx = headers.findIndex((h: string) => h.includes('item') || h.includes('name'));
          const scaleIdx = headers.findIndex((h: string) => h.includes('scale') || h.includes('size'));
          const assignIdx = headers.findIndex((h: string) => h.includes('target') || h.includes('assignment'));

          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const itemName = String(r[nameIdx] || '').trim();
            if (!itemName) continue;

            const tripStr = String(r[tripIdx] || 'Trip 1').trim();
            const deptStr = String(r[deptIdx] || 'General').trim();
            const scaleStr = String(r[scaleIdx] || '').trim();
            const assignStr = String(r[assignIdx] || '').trim();

            deptSet.add(deptStr);

            groceryItems.push({
              id: `item_${i}`,
              trip: tripStr,
              department: deptStr,
              itemName,
              targetScaleSize: scaleStr,
              mealAssignment: assignStr,
              isChecked: false,
            });
          }
        }
      } catch (sheetsErr) {
        console.warn('Sheets fallback notice in meals GET:', sheetsErr);
      }
    }

    const departments = Array.from(deptSet);
    if (departments.length === 0) {
      departments.push('Meat & Deli', 'Dairy & Eggs', 'Produce & Frozen', 'Bakery & Pantry');
    }

    const selectedPlan = WEEKLY_PLANS.find((w) => w.weekNumber === activeWeek) || WEEKLY_PLANS[0];

    return NextResponse.json<MealsResponseData>({
      success: true,
      activeTrip,
      activeWeek,
      groceryItems,
      departments,
      weeklyPlan: selectedPlan,
      allWeeks: WEEKLY_PLANS,
      recipes: DEFAULT_RECIPES,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error fetching meal prep data:', errorMsg);
    return NextResponse.json(
      {
        success: false,
        activeTrip: 'Trip 1',
        activeWeek: 1,
        groceryItems: [],
        departments: [],
        weeklyPlan: WEEKLY_PLANS[0],
        recipes: DEFAULT_RECIPES,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}

// POST endpoint to toggle checklist status or clear all checked items
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, isChecked, clearAll } = body;

    const sb = supabaseAdmin || supabase;

    if (clearAll === true) {
      if (sb) {
        await sb
          .from('costco_meal_items')
          .update({ is_checked: false, updated_at: new Date().toISOString() })
          .eq('is_checked', true);
      }
      return NextResponse.json({ success: true, cleared: true });
    }

    if (!id || typeof isChecked !== 'boolean') {
      return NextResponse.json({ error: 'Missing id or isChecked boolean' }, { status: 400 });
    }

    if (sb) {
      await sb
        .from('costco_meal_items')
        .update({ is_checked: isChecked, updated_at: new Date().toISOString() })
        .eq('id', id);
    }

    return NextResponse.json({ success: true, id, isChecked });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
