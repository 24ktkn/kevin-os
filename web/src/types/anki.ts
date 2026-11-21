export interface AnkiDeckBreakdown {
  deck: string;
  newRemaining: number;
  learningRemaining: number;
  reviewRemaining: number;
  totalCards: number;
  suspendedCards: number;
  matureCards: number;
  leechCards: number;
}

export interface AnkiForecastPoint {
  dayOffset: number;
  date: string; // YYYY-MM-DD
  dueCount: number;
}

export interface AnkiDailyStats {
  date: string;
  reviews_today: number;
  new_done_today: number;
  review_due_remaining: number;
  learning_remaining: number;
  new_remaining: number;
  total_due_remaining: number;
  study_time_secs: number;
  avg_secs_per_card: number;
  retention_pct: number;
  mature_retention_pct: number;
  again_count: number;
  hard_count: number;
  good_count: number;
  easy_count: number;
  streak_days: number;
  total_cards: number;
  active_cards: number;
  suspended_cards: number;
  mature_cards: number;
  leech_cards: number;
  deck_breakdown: AnkiDeckBreakdown[];
  forecast_30d: AnkiForecastPoint[];
  synced_at?: string;
}

export interface AnkiCard {
  card_id: number;
  note_id: number;
  deck_name: string;
  model_name: string;
  ord: number;
  front_html: string;
  back_html: string;
  front_text: string;
  back_text: string;
  extra_text: string;
  fields_json: Record<string, string>;
  tags: string[];
  suspended: boolean;
  buried: boolean;
  queue: number;
  card_type: number;
  due_value: number;
  due_date: string | null;
  interval_days: number;
  ease_factor: number;
  reps: number;
  lapses: number;
  is_leech?: boolean;
  updated_at?: string;
}

export type AnkiActionType =
  | 'add_note'
  | 'unsuspend_cards'
  | 'suspend_cards'
  | 'answer_card'
  | 'update_tags'
  | 'edit_note'
  | 'trigger_sync';

export interface AnkiActionItem {
  id: string;
  action_type: AnkiActionType;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'applied' | 'failed';
  source: string;
  error_message?: string | null;
  result_json?: Record<string, unknown> | null;
  created_at: string;
  applied_at?: string | null;
}

export interface StagedNewCardDraft {
  deckName: string;
  modelName: 'Cloze' | 'Basic' | string;
  front: string;
  back: string;
  extra?: string;
  tags?: string[];
  duplicateWarning?: string | null;
}

export interface StagedCardMatchRef {
  cardId: number;
  noteId?: number;
  deckName: string;
  frontSnippet: string;
  tags: string[];
  matchScore?: number;
  matchedTerms?: string[];
}

export interface AnkiProposal {
  id: string;
  proposal_type: 'new_cards' | 'unsuspend_cards' | 'suspend_cards';
  title: string;
  source_label: string;
  deck_name: string;
  payload: {
    cards?: StagedNewCardDraft[];
    cardIds?: number[];
    matches?: StagedCardMatchRef[];
  };
  reasoning: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string | null;
}

export interface ExamTarget {
  id: string;
  name: string;
  examDate: string; // YYYY-MM-DD
  deckFilter?: string;
  tagFilter?: string;
  bufferDays?: number; // default 3
}

export interface AnkiSyncState {
  id: string;
  last_heartbeat_at: string | null;
  last_full_sync_at: string | null;
  last_ankiweb_sync_at: string | null;
  bridge_version: string;
  auto_habit_rule: 'zero_review_learning' | 'min_reviews';
  auto_habit_min_reviews: number;
  default_deck: string;
  default_model: string;
  exam_targets: ExamTarget[];
  updated_at?: string;
}

export interface ExamPacingProjection {
  target: ExamTarget;
  daysUntilExam: number;
  studyDaysLeft: number;
  totalMatchingCards: number;
  suspendedCards: number;
  newCards: number;
  activeCards: number;
  matureCards: number;
  cardsToUnlock: number;
  recommendedNewPerDay: number;
  peakDailyReviews: number;
  burdenCurve: Array<{
    dayOffset: number;
    date: string;
    baselineDue: number;
    projectedNewReviews: number;
    newIntroduced: number;
    totalProjected: number;
  }>;
}

export interface BiometricRetentionPoint {
  date: string;
  retentionPct: number;
  avgSecsPerCard: number;
  reviewsToday: number;
  sleepHours: number | null;
  hrv: number | null;
  rhr: number | null;
  steps: number | null;
}

export interface BiometricsRetentionInsights {
  pairedDays: number;
  points: BiometricRetentionPoint[];
  avgRetentionGoodSleep: number | null;
  avgRetentionLowSleep: number | null;
  avgSpeedGoodSleep: number | null;
  avgSpeedLowSleep: number | null;
  avgRetentionHighHrv: number | null;
  avgRetentionLowHrv: number | null;
  medianHrv: number | null;
  takeaways: string[];
}

export interface AnkiLeechGroup {
  topic: string;
  deckName: string;
  cardCount: number;
  avgLapses: number;
  totalLapses: number;
  cards: Array<{
    card_id: number;
    note_id: number;
    deck_name: string;
    front_text: string;
    back_text: string;
    extra_text: string;
    lapses: number;
    reps: number;
    tags: string[];
  }>;
}
