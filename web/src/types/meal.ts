export interface CostcoGroceryItem {
  id: string;
  trip: string; // "Trip 1 (Day 1)" | "Trip 2 (Day 15)"
  department: string; // "Meat & Deli" | "Dairy & Eggs" | "Produce & Frozen" | "Bakery & Pantry"
  itemName: string;
  targetScaleSize: string; // e.g. "3-Pack", "1 Bulk Bag", "5-Dozen Crate"
  mealAssignment: string; // e.g. "Lunch (Weeks 1-2)", "Dinner (Weeks 1 & 3)"
  isChecked?: boolean;
}

export interface MealPlanDay {
  dayName: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  snack: string;
  proteinGrams: number;
  calories: number;
}

export interface MealPlanWeek {
  weekNumber: number; // 1, 2, 3, 4
  theme: string;
  schedule: MealPlanDay[];
  dailyAverageCalories: number;
  dailyAverageProtein: number;
}

export interface HighProteinRecipe {
  id: string;
  title: string;
  category: 'Lunch' | 'Dinner' | 'Breakfast' | 'Snack';
  servings: number;
  prepTimeMins: number;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
}

export interface MealsResponseData {
  success: boolean;
  activeTrip: 'Trip 1' | 'Trip 2';
  activeWeek: number; // 1, 2, 3, 4
  groceryItems: CostcoGroceryItem[];
  departments: string[];
  weeklyPlan: MealPlanWeek;
  recipes: HighProteinRecipe[];
}
