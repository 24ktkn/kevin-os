export type TaskType = 'Task' | 'Event';
export type CalendarName = 'Kevin Nguyen' | 'School' | 'Family' | 'Volunteering';
export type RepeatOption = 'None' | 'Daily' | 'Weekly' | 'Monthly' | 'Every Weekday (Mon-Fri)';

export interface TaskItem {
  id: string;
  title: string;
  type: TaskType;
  calendar_name: CalendarName;
  due_date: string; // YYYY-MM-DD
  due_time?: string; // e.g. "10:00 AM"
  duration_mins: number;
  is_completed: boolean;
  is_scheduled: boolean;
  location?: string;
  notes?: string;
  calendar_event_id?: string;
  google_task_id?: string;
  recurrence_rule?: string;
  recurring_event_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RescheduleRequest {
  taskId?: string;
  calendarEventId?: string;
  googleTaskId?: string;
  schoolUid?: string;
  title?: string;
  calendarName?: CalendarName;
  newDate: string; // YYYY-MM-DD
  newTime?: string; // e.g. "10:00 AM" or "14:30"
  durationMins?: number;
  scope?: 'instance' | 'series';
  createTimeblock?: boolean;
}

export interface RescheduleResponse {
  success: boolean;
  message?: string;
  updatedTask?: TaskItem;
  patchedCalendar?: boolean;
  patchedTask?: boolean;
  patchedSchool?: boolean;
  error?: string;
}

export interface DeleteTaskRequest {
  taskId?: string;
  calendarEventId?: string;
  googleTaskId?: string;
  calendarName?: CalendarName;
  title?: string;
}

export interface DeleteTaskResponse {
  success: boolean;
  message?: string;
  error?: string;
}


