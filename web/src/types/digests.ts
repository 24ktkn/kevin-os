export interface MorningBriefPayload {
  date: string;
  generatedAt: string;
  headline: string;
  coachNote: string;
  readiness: {
    score: number;
    tier: string;
    sleepDuration: string;
    sleepHours: number;
    hrv: number;
    rhr: number;
    wakeTime: string;
  } | null;
  anki: {
    dueRemaining: number;
    reviewDue: number;
    learningRem: number;
    estimatedMins: number;
    streakDays: number;
    pendingProposals: number;
  } | null;
  taper: {
    inTaperMode: boolean;
    nextMajorExam: string | null;
    daysUntil: number | null;
    examDate: string | null;
    message: string;
  };
  classesToday: Array<{ title: string; startTime: string; endTime: string }>;
  tasksTodayCount: number;
  topTasks: Array<{ title: string; time: string; calendar: string }>;
  habitsCompletedCount: number;
  habitsTotalCount: number;
  pushedViaNtfy?: boolean;
  pushedAt?: string | null;
}

export interface WeeklyExecutiveReview {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  overallGrade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C';
  headline: string;
  executiveSummary: string;
  wins: string[];
  watchouts: string[];
  nextWeekAdjustments: string[];
  pillars: {
    academics: {
      tasksCompleted: number;
      tasksTotal: number;
      completionRate: number;
      modulesCompleted: number;
      nextMajorExam: string | null;
      daysUntilExam: number | null;
      inTaperMode: boolean;
    };
    anki: {
      totalReviews: number;
      activeDays: number;
      avgRetentionPct: number;
      avgSecsPerCard: number;
      currentStreak: number;
      dueRemainingNow: number;
      leechCount: number;
    };
    health: {
      avgSleepHours: number;
      avgHrv: number;
      avgRhr: number;
      avgSteps: number;
      avgReadiness: number;
      weightDeltaLbs: number | null;
      latestWeightLbs: number | null;
    };
    workouts: {
      sessionsCount: number;
      totalSets: number;
      totalVolumeLbs: number;
      topExercises: Array<{ exercise: string; bestWeightLbs: number; bestReps: number }>;
    };
    habits: {
      overallPct: number;
      perHabit: Array<{ name: string; daysDone: number; totalDays: number; pct: number }>;
    };
    portfolioAndJournal: {
      journalEntriesCount: number;
      portfolioEntriesCount: number;
      totalPortfolioHours: number;
    };
  };
}
