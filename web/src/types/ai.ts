export interface CalendarBusyBlock {
  calendar: string;
  title: string;
  startIso: string;
  endIso: string;
  startTime: string; // e.g. "09:00 AM"
  endTime: string;   // e.g. "10:30 AM"
}

export interface BacklogTask {
  id: string;
  title: string;
  listName: string;
  tasklistId: string;
  due?: string;
  notes?: string;
}

export interface ProposedTask {
  itemName: string;
  calendar: 'Kevin Nguyen' | 'Family' | 'School' | 'Volunteering';
  startTime24h: string; // e.g. "14:30"
  durationMins: number;
  startTimeFormatted?: string; // e.g. "2:30 PM"
  endTimeFormatted?: string;   // e.g. "3:15 PM"
  reasoning?: string;
}

export interface ScheduledCommitItem {
  type: 'event' | 'task';
  id: string;
  title: string;
  calendarId?: string;
  tasklistId?: string;
}

export interface AISchedulerContextResponse {
  success: boolean;
  date: string;
  busyBlocks: CalendarBusyBlock[];
  backlogTasks: BacklogTask[];
  error?: string;
}

export interface AIScheduleResponse {
  success: boolean;
  scheduledTasks: ProposedTask[];
  summary?: string;
  error?: string;
}

export interface AICommitResponse {
  success: boolean;
  createdEventsCount: number;
  createdTasksCount: number;
  scheduledItems: ScheduledCommitItem[];
  message: string;
  error?: string;
}
