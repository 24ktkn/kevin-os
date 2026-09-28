export type SchoolCategory = 'module' | 'assignment' | 'class';

export interface SchoolEvent {
  uid: string;
  summary: string;
  description: string;
  location?: string;
  dateStr: string;
  isAllDay: boolean;
  dateObj: string; // ISO string
  duration: number; // in minutes
  category: SchoolCategory;
  isScheduled?: boolean;
  isCompleted?: boolean;
  scheduledTime?: string;
  scheduledDate?: string;
}

export interface SchoolFetchResponse {
  events: SchoolEvent[];
  error?: string;
  lastUpdated: string;
}
