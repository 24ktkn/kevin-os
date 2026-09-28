export type TaskType = 'Task' | 'Event';
export type CalendarName = 'Kevin Nguyen' | 'School' | 'Family' | 'Volunteering';

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
  created_at?: string;
  updated_at?: string;
}
