export interface WorkoutLogEntry {
  id?: string;
  date: string; // YYYY-MM-DD
  splitDay: string; // Push, Pull, Legs, etc.
  exercise: string;
  setNumber: number;
  weightLbs: number;
  reps: number;
  estimated1RM: number;
  timestamp?: string;
  durationMins?: number;
  gymDurationMins?: number;
  distanceKm?: number;
  effectiveVolume: number;
  muscleGroup: string;
}

export interface MuscleRecoveryStatus {
  muscleGroup: string; // e.g. Quads, Hamstrings & Glutes, Calves, Chest, Back, Shoulders, Biceps, Triceps, Abs/Core
  lastTrainedDate: string | null;
  hoursElapsed: number | null;
  status: 'fresh' | 'recovering' | 'fatigued'; // >72h: fresh (green), 24-72h: recovering (orange), <24h: fatigued (red)
  lastExercises: string[];
}

export interface ExercisePR {
  exercise: string;
  maxWeightLbs: number;
  maxRepsAtMaxWeight: number;
  bestEstimated1RM: number;
  dateAchieved: string;
  muscleGroup: string;
}

export interface WorkoutSessionSummary {
  date: string;
  splitDay: string;
  exerciseCount: number;
  setCount: number;
  totalVolumeLbs: number;
  gymDurationMins: number;
  exercises: string[];
}

export interface WorkoutsResponseData {
  success: boolean;
  totalWorkouts: number;
  totalVolumeLbs: number;
  averageDurationMins: number;
  recentSessions: WorkoutSessionSummary[];
  muscleRecovery: MuscleRecoveryStatus[];
  personalRecords: ExercisePR[];
  recentLogs: WorkoutLogEntry[];
}
