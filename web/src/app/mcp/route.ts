import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  buildUnauthorizedMcpResponse,
  getMcpCorsHeaders,
  mcpCorsPreflight,
  recordMcpTrace,
  verifyBearerRequest,
  withMcpCors,
} from '@/lib/mcp-auth';
import {
  addAnkiNotes,
  addPortfolioEntry,
  completeTask,
  deleteTask,
  draftEmail,
  getAnkiLeeches,
  getAnkiOverview,
  getEmailInbox,
  getHabitsData,
  getHealthSummary,
  getJournalData,
  getKevinOsOverview,
  getMealsAndGroceries,
  getMorningBriefData,
  getPortfolioEntries,
  getScheduleAndTasks,
  getSchoolModules,
  getWeeklyExecutiveReviewData,
  getWorkoutsData,
  logHabit,
  matchSuspendedAnkiCards,
  queryKevinOsTable,
  readEmail,
  rescheduleTask,
  saveJournalEntry,
  scheduleAnkiTodayTimeblock,
  scheduleItem,
  scheduleWeekModules,
  searchAnkiCards,
  searchEmails,
  sendEmail,
  suspendAnkiCards,
  toggleGroceryItem,
  triageEmails,
  unsuspendAnkiCards,
} from '@/lib/kevin-os-tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CALENDAR_ENUM = z.enum(['School', 'Kevin Nguyen', 'Family', 'Volunteering']);
const HABIT_ENUM = z.enum(['Wake Up On Time', 'Gym Workout', 'Journaling', 'Anki']);

function jsonToolResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function createKevinOsMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'kevin-os',
      version: '1.0.0',
    },
    {
      instructions:
        'You are connected to Kevin-OS, Kevin Nguyen’s personal productivity, medical school (Schulich UWO), Anki spaced repetition, health biometrics, habits, workouts, daily journal, and meal prep system. ' +
        'All dates use America/New_York (Eastern Time) in YYYY-MM-DD format. ' +
        'ONLINE MODULE DURATION RULE: For every online school module with a bracketed duration (e.g. "(45 min) ..."), always add 20 minutes and round UP to the nearest 30 minutes (e.g. 45m -> 65m -> 90m, 20m -> 40m -> 60m, 57m -> 77m -> 90m). ' +
        'ANKI APPROVAL INBOX RULE (STRICT): Whenever calling add_anki_notes, unsuspend_anki_cards, or suspend_anki_cards, ALWAYS default to requireApproval: true so proposals go to Kevin’s 1-click Approval Inbox on /anki. ONLY set requireApproval: false when Kevin EXPLICITLY says in his current prompt to add/unsuspend/suspend immediately without inbox approval — never choose immediate commit on your own. ' +
        'ANKI CHECK-IN RULE: During daily/evening check-ins (get_kevin_os_overview or get_anki_overview), always flag if Kevin still has Anki review/learning cards due today (dueCardsAlert === true). ' +
        'NOTEBOOKLM -> ANKI WORKFLOW: When Kevin references a NotebookLM source (@Gemini Notebook), first call match_suspended_anki_cards with the lecture concepts/summary to find matching suspended cards to unsuspend, and call search_anki_cards to avoid duplicates before proposing new atomic Cloze ({{c1::...}}) or Basic cards via add_anki_notes.',
    }
  );

  // 1. Daily Overview / Briefing
  server.registerTool(
    'get_kevin_os_overview',
    {
      title: 'Get Kevin-OS Daily Overview',
      description:
        'Returns a complete snapshot of today: outstanding & completed tasks, Google Calendar timeblocks, Schulich Elentra classes, latest biometrics (sleep, HRV, RHR, steps, weight), today’s habits & streaks, and active meal prep status.',
      inputSchema: {
        syncFirst: z
          .boolean()
          .optional()
          .describe('Sync two-way with Google Calendar & Google Tasks first (default: true).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ syncFirst }) => {
      try {
        return jsonToolResult(await getKevinOsOverview({ syncFirst }));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 2. Tasks & Calendar Schedule
  server.registerTool(
    'get_schedule_and_tasks',
    {
      title: 'Get Schedule & Tasks',
      description:
        'Reads Kevin’s outstanding tasks, completed items, Google Calendar timeblocks, and Schulich Elentra classes for today or any date range (up to 14 days).',
      inputSchema: {
        startDate: z.string().optional().describe('Start date in YYYY-MM-DD (defaults to today).'),
        endDate: z.string().optional().describe('End date in YYYY-MM-DD (defaults to startDate).'),
        includeCompleted: z
          .boolean()
          .optional()
          .describe('Include completed items alongside outstanding tasks (default: true).'),
        calendar: CALENDAR_ENUM.optional().describe('Optional filter by calendar category.'),
        syncFirst: z
          .boolean()
          .optional()
          .describe('Run live Google Calendar & Tasks sync before reading (default: false).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getScheduleAndTasks(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 3. School Modules / Classes / Assignments
  server.registerTool(
    'get_school_modules',
    {
      title: 'Get School Modules & Elentra Schedule',
      description:
        'Lists Schulich medical school online modules (with predetermined durations in minutes), classes, or assignments from Elentra merged with Kevin-OS completion and scheduling state.',
      inputSchema: {
        startDate: z
          .string()
          .optional()
          .describe('Start release/due date YYYY-MM-DD (defaults to 7 days ago).'),
        endDate: z
          .string()
          .optional()
          .describe('End release/due date YYYY-MM-DD (defaults to 14 days ahead).'),
        category: z
          .enum(['module', 'class', 'assignment', 'all'])
          .optional()
          .describe('Item category filter (default: "module").'),
        onlyUnscheduled: z
          .boolean()
          .optional()
          .describe('If true, return only modules not yet scheduled onto Google Calendar.'),
        onlyIncomplete: z
          .boolean()
          .optional()
          .describe('If true, exclude completed modules (default: true).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getSchoolModules(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 4. Schedule Week's Online Modules (AI Auto-Slot Around Classes)
  server.registerTool(
    'schedule_week_modules',
    {
      title: 'Auto-Schedule Week Online Modules',
      description:
        'Finds unscheduled incomplete online school modules in a date range, schedules them into open daytime slots around all 4 Google Calendars AND Schulich Elentra classes, applying Kevin’s duration rule (+20 minutes added to the bracketed duration, rounded UP to the nearest 30 minutes, e.g. 45m -> 65m -> 90m), and creates paired Google Calendar [Task] blocks, Google Tasks, and Supabase school_items links. Supports dryRun=true to preview before committing.',
      inputSchema: {
        startDate: z
          .string()
          .optional()
          .describe('First day of scheduling window in YYYY-MM-DD (defaults to today).'),
        endDate: z
          .string()
          .optional()
          .describe('Last day of scheduling window in YYYY-MM-DD (defaults to startDate + 6 days).'),
        moduleTitles: z
          .array(z.string())
          .optional()
          .describe('Optional subset of module titles to schedule; omit to schedule all unscheduled modules in range.'),
        includeOverdueModules: z
          .boolean()
          .optional()
          .describe('Also include unscheduled modules released in the 14 days prior to startDate (default: false).'),
        maxModulesPerDay: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe('Maximum modules to place per day (default: 4).'),
        preferredStartHour: z
          .number()
          .int()
          .min(6)
          .max(20)
          .optional()
          .describe('Earliest hour of day (24h) to start scheduling modules (default: 8).'),
        dryRun: z
          .boolean()
          .optional()
          .describe('If true, return proposed non-overlapping slots without writing to Google Calendar/Tasks (default: false).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await scheduleWeekModules(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 5. Schedule Single Item
  server.registerTool(
    'schedule_item',
    {
      title: 'Schedule Task or Event',
      description:
        'Creates a paired Google Calendar [Task] timeblock + Google Task + Supabase record (or standalone event). If autoFindEmptySlot is true or time is omitted, automatically finds an open non-overlapping slot around Google Calendar events and Schulich classes.',
      inputSchema: {
        title: z.string().min(1).describe('Title of the task, module, or event.'),
        date: z.string().optional().describe('Target date in YYYY-MM-DD (defaults to today).'),
        time: z
          .string()
          .optional()
          .describe('Start time like "2:30 PM" or "14:30". Omit or set autoFindEmptySlot=true for AI slot selection.'),
        durationMins: z
          .number()
          .int()
          .min(5)
          .max(480)
          .optional()
          .describe('Duration in minutes (default: 60).'),
        calendar: CALENDAR_ENUM.optional().describe('Calendar category (default: "School").'),
        autoFindEmptySlot: z
          .boolean()
          .optional()
          .describe('Automatically pick a non-overlapping empty timeblock on the date.'),
        isStandaloneEvent: z
          .boolean()
          .optional()
          .describe('Set true for a standalone calendar event (no Google Task checklist).'),
        skipCalendar: z
          .boolean()
          .optional()
          .describe('Set true to create a Google Task only without a calendar timeblock.'),
        skipTask: z.boolean().optional().describe('Set true to skip creating a Google Task.'),
        description: z.string().optional().describe('Optional notes or description.'),
        location: z.string().optional().describe('Optional event location.'),
        repeat: z
          .enum(['None', 'Daily', 'Weekly', 'Monthly', 'Every Weekday (Mon-Fri)'])
          .optional()
          .describe('Optional recurrence rule.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await scheduleItem(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 6. Complete / Uncomplete Task
  server.registerTool(
    'complete_task',
    {
      title: 'Complete or Uncomplete Task',
      description:
        'Marks a task, [Task] calendar timeblock, or school module complete or incomplete across Google Tasks, Google Calendar ("✅ [Task]" / "🎓 [Task]"), Supabase tasks, and school_items.',
      inputSchema: {
        title: z.string().optional().describe('Task or module title (fuzzy matched).'),
        taskId: z.string().optional().describe('Supabase task row ID if known.'),
        googleTaskId: z.string().optional().describe('Google Task ID if known.'),
        calendarEventId: z.string().optional().describe('Google Calendar event ID if known.'),
        calendarName: CALENDAR_ENUM.optional().describe('Calendar/list name if known.'),
        completed: z.boolean().describe('true to mark completed, false to reopen.'),
        timeblockOnly: z
          .boolean()
          .optional()
          .describe('If true, toggle only the calendar timeblock without touching Google Tasks.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await completeTask(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 7. Reschedule Task
  server.registerTool(
    'reschedule_task',
    {
      title: 'Reschedule Task or Module',
      description:
        'Moves an existing task/module to a new date and time across Google Calendar, Google Tasks, and Supabase. If newTime is omitted or autoFindEmptySlot is true, automatically finds an open slot avoiding classes and busy blocks.',
      inputSchema: {
        title: z.string().optional().describe('Task or module title.'),
        taskId: z.string().optional().describe('Supabase task ID if known.'),
        calendarEventId: z.string().optional().describe('Google Calendar event ID if known.'),
        googleTaskId: z.string().optional().describe('Google Task ID if known.'),
        newDate: z.string().describe('Target date in YYYY-MM-DD.'),
        newTime: z
          .string()
          .optional()
          .describe('Optional explicit time (e.g. "3:00 PM"). Omit to let AI pick an open slot.'),
        durationMins: z.number().int().min(5).max(480).optional().describe('Optional new duration in minutes.'),
        autoFindEmptySlot: z
          .boolean()
          .optional()
          .describe('Use AI to pick a free slot on newDate around classes (defaults to true when newTime is omitted).'),
        calendarName: CALENDAR_ENUM.optional().describe('Calendar name if known.'),
        createTimeblock: z
          .boolean()
          .optional()
          .describe('Create a Google Calendar timeblock if the task did not have one yet.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await rescheduleTask(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 8. Delete Task
  server.registerTool(
    'delete_task',
    {
      title: 'Delete Task or Timeblock',
      description:
        'Deletes a task and/or its paired Google Calendar timeblock across Google Calendar, Google Tasks, and Supabase.',
      inputSchema: {
        title: z.string().optional().describe('Task title to match.'),
        taskId: z.string().optional().describe('Supabase task row ID if known.'),
        calendarEventId: z.string().optional().describe('Google Calendar event ID if known.'),
        googleTaskId: z.string().optional().describe('Google Task ID if known.'),
        calendarName: CALENDAR_ENUM.optional().describe('Calendar name if known.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await deleteTask(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 9. Health & Biometrics Trends
  server.registerTool(
    'get_health_summary',
    {
      title: 'Get Health, Sleep, HRV & Fitness Trends',
      description:
        'Returns Kevin’s biometrics analytics (sleep duration, sleep debt, HRV, RHR, daily steps & 10k goal hit rate, bodyweight delta, workout calories/duration), habit consistency streaks, and recent gym recovery status for weekly, monthly, quarterly, or all-time review.',
      inputSchema: {
        timeframe: z
          .enum(['week', 'month', 'quarter', 'year', 'all'])
          .optional()
          .describe('Analytics period (default: "week").'),
        includeDailyPoints: z
          .boolean()
          .optional()
          .describe('Include day-by-day biometric records (default: true).'),
        syncGoogleHealth: z
          .boolean()
          .optional()
          .describe('Pull latest 7 days from Google Health API before calculating summary (default: false).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getHealthSummary(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 10. Habits Read & Write
  server.registerTool(
    'get_habits',
    {
      title: 'Get Habits & Streaks',
      description:
        'Returns Kevin’s tracked habits (Wake Up On Time, Gym Workout, Journaling, Anki), current streaks, monthly consistency rates, and 30-day velocity.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return jsonToolResult(await getHabitsData());
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'log_habit',
    {
      title: 'Log or Toggle Habit',
      description: 'Marks one of Kevin’s habits completed or incomplete for today or a specified YYYY-MM-DD date.',
      inputSchema: {
        habit: HABIT_ENUM.describe('Habit name.'),
        completed: z.boolean().describe('true if completed, false otherwise.'),
        date: z.string().optional().describe('Optional YYYY-MM-DD date (defaults to current productivity day).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await logHabit(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 11. Workouts Read
  server.registerTool(
    'get_workouts',
    {
      title: 'Get Workouts, PRs & Muscle Recovery',
      description:
        'Returns recent gym sessions, total volume, average duration, per-muscle recovery status (fresh/recovering/fatigued with hours elapsed), estimated 1RM personal records, and exercise logs.',
      inputSchema: {
        includeExerciseLogs: z
          .boolean()
          .optional()
          .describe('Include full recent set-by-set exercise logs (default: false returns top 15).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getWorkoutsData(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 12. Journal Read & Write
  server.registerTool(
    'get_journal',
    {
      title: 'Get Daily Journal Entries',
      description:
        'Reads Kevin’s daily journal entry, timeline, and locations for a single date, or reads recent journal entries across the last N days.',
      inputSchema: {
        date: z.string().optional().describe('Date in YYYY-MM-DD (defaults to current productivity day).'),
        recentDays: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('If > 1, fetches journal text across the last N days ending on date.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getJournalData(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'save_journal_entry',
    {
      title: 'Save or Append Journal Entry',
      description:
        'Appends to (default) or replaces Kevin’s daily journal entry for today or a specified YYYY-MM-DD date.',
      inputSchema: {
        date: z.string().optional().describe('Date in YYYY-MM-DD (defaults to current productivity day).'),
        entry: z.string().min(1).describe('Journal text to save or append.'),
        mode: z
          .enum(['append', 'replace'])
          .optional()
          .describe('append adds below existing entry (default); replace overwrites the day’s text.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await saveJournalEntry(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 13. Meals & Groceries Read & Write
  server.registerTool(
    'get_meals_and_groceries',
    {
      title: 'Get Meal Plan, Recipes & Costco Groceries',
      description:
        'Returns Kevin’s active weekly meal plan (macros & schedule), high-protein recipes, and Costco grocery checklist.',
      inputSchema: {
        trip: z.enum(['Trip 1', 'Trip 2']).optional().describe('Optional Costco shopping trip filter.'),
        week: z.number().int().min(1).max(4).optional().describe('Optional meal plan week (1-4).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getMealsAndGroceries(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'toggle_grocery_item',
    {
      title: 'Toggle or Clear Costco Grocery Item',
      description: 'Checks/unchecks a Costco grocery item by itemName or id, or resets all checked items.',
      inputSchema: {
        id: z.string().optional().describe('Grocery item ID if known.'),
        itemName: z.string().optional().describe('Item name to match (e.g. "Kirkland Ground Beef").'),
        isChecked: z.boolean().optional().describe('true to check off, false to uncheck.'),
        clearAll: z.boolean().optional().describe('Set true to uncheck all items for a fresh trip.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await toggleGroceryItem(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 14. Anki Spaced Repetition & NotebookLM Card Workflows
  server.registerTool(
    'get_anki_overview',
    {
      title: 'Get Anki Daily Stats & Due Alert',
      description:
        'Returns today’s Anki reviews done, remaining review+learning due count, estimated minutes left, retention %, streak, deck breakdown, exam pacing projections, biometrics-retention takeaways, and dueCardsAlert flag.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return jsonToolResult(await getAnkiOverview());
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'search_anki_cards',
    {
      title: 'Search Anki Cards',
      description:
        'Reads and searches Kevin’s mirrored Anki cards (3,000-5,000 custom Schulich Cloze/Basic cards) by text query, deck, tag, or status (all, due, active, suspended, leech, new).',
      inputSchema: {
        query: z.string().optional().describe('Keyword search across front, back, extra, deck, and tags.'),
        deck: z.string().optional().describe('Optional deck name prefix filter.'),
        tag: z.string().optional().describe('Optional tag substring filter.'),
        status: z
          .enum(['all', 'due', 'active', 'suspended', 'leech', 'new'])
          .optional()
          .describe('Card status filter (default: "all").'),
        limit: z.number().int().min(1).max(60).optional().describe('Max cards to return (default: 25).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await searchAnkiCards(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'match_suspended_anki_cards',
    {
      title: 'Match Suspended Anki Cards to NotebookLM / Lecture Content',
      description:
        'Matches Kevin’s suspended Anki cards against newly uploaded NotebookLM source summaries, lecture notes, or medical concept lists. Returns ranked suspended cardIds, front snippets, tags, and relevance scores ready to unsuspend.',
      inputSchema: {
        sourceTitle: z.string().optional().describe('Lecture or NotebookLM source title.'),
        sourceSummary: z
          .string()
          .optional()
          .describe('Key notes, summary, or high-yield takeaways extracted from NotebookLM.'),
        concepts: z
          .array(z.string())
          .optional()
          .describe('Specific medical terms, drugs, organisms, or pathways to match.'),
        deckFilter: z.string().optional().describe('Optional deck name filter.'),
        tagFilter: z.string().optional().describe('Optional tag filter.'),
        maxMatches: z.number().int().min(1).max(50).optional().describe('Max matches (default: 25).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await matchSuspendedAnkiCards(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'unsuspend_anki_cards',
    {
      title: 'Unsuspend Anki Cards (Approval Inbox Default)',
      description:
        'Stages suspended Anki cardIds in Kevin-OS /anki 1-click Approval Inbox by default (requireApproval: true). ONLY pass requireApproval: false if Kevin explicitly instructed you in his prompt to unsuspend immediately without approval.',
      inputSchema: {
        cardIds: z.array(z.number().int().positive()).min(1).describe('Anki cardIds to unsuspend.'),
        title: z.string().optional().describe('Short label for the Approval Inbox proposal.'),
        sourceLabel: z.string().optional().describe('Source label (e.g. "NotebookLM: Antibiotics").'),
        reasoning: z.string().optional().describe('Why these suspended cards match the lecture/source.'),
        requireApproval: z
          .boolean()
          .optional()
          .describe('MUST remain true (default) unless Kevin explicitly asks to skip Approval Inbox and commit immediately.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await unsuspendAnkiCards(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'suspend_anki_cards',
    {
      title: 'Suspend Anki Cards (Approval Inbox Default)',
      description:
        'Stages Anki cardIds to suspend in Kevin-OS /anki 1-click Approval Inbox by default (requireApproval: true). ONLY pass requireApproval: false if Kevin explicitly instructed immediate suspension.',
      inputSchema: {
        cardIds: z.array(z.number().int().positive()).min(1).describe('Anki cardIds to suspend.'),
        title: z.string().optional().describe('Short label for the Approval Inbox proposal.'),
        sourceLabel: z.string().optional().describe('Optional source label.'),
        reasoning: z.string().optional().describe('Why these cards should be suspended.'),
        requireApproval: z
          .boolean()
          .optional()
          .describe('MUST remain true (default) unless Kevin explicitly asks to bypass Approval Inbox.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await suspendAnkiCards(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'add_anki_notes',
    {
      title: 'Add New Anki Cards from NotebookLM (Approval Inbox Default)',
      description:
        'Creates new Cloze ({{c1::...}}) or Basic Anki cards (e.g., from NotebookLM sources) with automatic duplicate checking. Stages in Kevin-OS /anki 1-click Approval Inbox by default (requireApproval: true). ONLY set requireApproval: false if Kevin explicitly tells you to add directly without review.',
      inputSchema: {
        deckName: z.string().optional().describe('Default target deck (e.g. "Schulich::Infectious Disease").'),
        title: z.string().optional().describe('Title for the Approval Inbox batch.'),
        sourceLabel: z.string().optional().describe('Source label (e.g. "NotebookLM: Week 12 Heme").'),
        reasoning: z.string().optional().describe('Summary of what knowledge gaps these new cards cover.'),
        requireApproval: z
          .boolean()
          .optional()
          .describe('MUST remain true (default) unless Kevin explicitly asks to add immediately without Approval Inbox.'),
        cards: z
          .array(
            z.object({
              deckName: z.string().optional(),
              modelName: z.enum(['Cloze', 'Basic']).optional(),
              front: z.string().describe('Cloze text containing {{c1::...}} OR Basic front question.'),
              back: z.string().optional().describe('Basic card answer (leave empty for Cloze).'),
              extra: z.string().optional().describe('High-yield mechanism, clinical pearl, or differential.'),
              tags: z.array(z.string()).optional(),
            })
          )
          .min(1)
          .max(30),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await addAnkiNotes(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'schedule_anki_timeblock',
    {
      title: 'Auto-Schedule Today’s Anki Timeblock & Google Task',
      description:
        'Calculates study duration from Kevin’s remaining due Anki cards × average seconds/card, finds non-overlapping open time slot(s) around Google Calendar + Schulich classes, and creates the paired Google Calendar timeblock + Google Task.',
      inputSchema: {
        date: z.string().optional().describe('Target date YYYY-MM-DD (defaults to today).'),
        includeNewCards: z.boolean().optional().describe('Include remaining New cards in time estimate (default: false).'),
        allowSplit: z.boolean().optional().describe('Split heavy review days (>45 mins) into 2 blocks (default: true).'),
        calendar: CALENDAR_ENUM.optional().describe('Calendar name (default: "School").'),
        commit: z
          .boolean()
          .optional()
          .describe('Set true to actually create the Google Calendar timeblock + Google Task; false to preview.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await scheduleAnkiTodayTimeblock(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'get_anki_leeches',
    {
      title: 'Get Anki Leeches & Weak Topics',
      description:
        'Lists high-lapse Anki leech cards grouped by topic/deck so Gemini can quiz Kevin or build high-yield comparison tables & mnemonics.',
      inputSchema: {
        minLapses: z.number().int().min(2).max(20).optional().describe('Minimum lapse threshold (default: 4).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getAnkiLeeches(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 15. Morning Brief, Sunday Weekly Executive Review & CaRMS Portfolio
  server.registerTool(
    'get_morning_brief',
    {
      title: 'Get Today’s Morning Brief & Readiness Score',
      description:
        'Returns Kevin’s 7:30 AM Morning Brief: Daily Readiness Score (0-100), sleep/HRV, Anki due count & minutes, Exam Taper Mode status, today’s Schulich classes/tasks, and AI game plan.',
      inputSchema: {
        refresh: z.boolean().optional().describe('Force regenerate fresh brief instead of using today’s cache.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getMorningBriefData(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'get_weekly_executive_review',
    {
      title: 'Get Sunday Weekly Executive Review',
      description:
        'Returns Kevin’s 7-day cross-pillar Executive Review: weekly grade, academics/module completion, Anki reviews & retention, Sleep/HRV/Readiness & weight trends, Hevy gym volume/PRs, habit consistency, wins, watchouts, and 3 adjustments for next week.',
      inputSchema: {
        weekEnd: z.string().optional().describe('End date YYYY-MM-DD of the 7-day window (defaults to today).'),
        refresh: z.boolean().optional().describe('Force fresh synthesis instead of cached weekly digest.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getWeeklyExecutiveReviewData(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'get_portfolio_entries',
    {
      title: 'Read Med School Portfolio / CaRMS Log',
      description:
        'Searches Kevin’s Schulich Med School Portfolio / CaRMS activity log (clinical, research, volunteering, leadership, teaching, shadowing, awards) with hours, verifiers, CanMEDS role coverage, and CV bullets.',
      inputSchema: {
        category: z.string().optional().describe('Filter by category (clinical, research, volunteering, leadership, teaching, shadowing, award, extracurricular).'),
        query: z.string().optional().describe('Keyword search across title, organization, CanMEDS roles, description, and bullets.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await getPortfolioEntries(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  server.registerTool(
    'add_portfolio_entry',
    {
      title: 'Add Med School Portfolio / CaRMS Activity',
      description:
        'Logs a new clinical, research, shadowing, volunteering, leadership, teaching, or award entry into Kevin’s CaRMS Portfolio with CanMEDS roles, hours, verifier info, and CV bullets.',
      inputSchema: {
        category: z
          .enum(['clinical', 'research', 'volunteering', 'leadership', 'teaching', 'shadowing', 'award', 'extracurricular'])
          .optional(),
        title: z.string().describe('Activity or project title.'),
        organization: z.string().optional(),
        role: z.string().optional(),
        start_date: z.string().optional().describe('YYYY-MM-DD'),
        end_date: z.string().optional().describe('YYYY-MM-DD (omit if ongoing)'),
        is_ongoing: z.boolean().optional(),
        hours: z.number().min(0).optional(),
        verifier_name: z.string().optional(),
        verifier_contact: z.string().optional(),
        canmeds_roles: z.array(z.string()).optional(),
        description: z.string().optional(),
        carms_bullets: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await addPortfolioEntry(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 28. Unified Email Inbox (Gmail Cloud + Hotmail/Outlook Cloud + @uwo.ca Thunderbird Bridge)
  server.registerTool(
    'get_email_inbox',
    {
      title: 'Get Unified Email Inbox (Gmail, Hotmail & School @uwo.ca)',
      description:
        'Reads Kevin’s unified inbox across all connected email accounts: Gmail (cloud 24/7), Hotmail/Outlook.com (cloud 24/7), and Western/Schulich @uwo.ca (via Thunderbird Bridge). Changes automatically mirror into Spark Mail.',
      inputSchema: {
        account: z
          .string()
          .optional()
          .describe('Optional filter by email address, label, or alias ("gmail", "hotmail", "outlook", "school", "uwo"). Omit for all accounts.'),
        folder: z
          .enum(['all', 'inbox', 'sent', 'drafts', 'archive', 'trash', 'spam', 'custom'])
          .optional()
          .describe('Folder filter (default: "inbox").'),
        unreadOnly: z.boolean().optional().describe('Return only unread messages (default: false).'),
        limit: z.number().int().min(1).max(60).optional().describe('Max emails to return (default: 25).'),
        syncCloud: z
          .boolean()
          .optional()
          .describe('If true, triggers a live cloud pull from Gmail & Hotmail APIs before returning (default: false).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await getEmailInbox(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 29. Search Emails
  server.registerTool(
    'search_emails',
    {
      title: 'Search Emails Across All Accounts',
      description:
        'Searches emails across Gmail, Hotmail/Outlook.com (including live server search), and Western/Schulich @uwo.ca (Thunderbird mirror) by keyword, sender, subject, or body.',
      inputSchema: {
        query: z.string().describe('Search terms, sender name/email, or subject keywords.'),
        account: z
          .string()
          .optional()
          .describe('Optional account filter ("gmail", "hotmail", "school", "uwo", or full email address).'),
        folder: z
          .enum(['all', 'inbox', 'sent', 'drafts', 'archive', 'trash', 'spam', 'custom'])
          .optional(),
        unreadOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        liveSearch: z
          .boolean()
          .optional()
          .describe('Run live Gmail/Microsoft server search in addition to synced cache (default: true).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await searchEmails(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 30. Read Full Email & Thread
  server.registerTool(
    'read_email',
    {
      title: 'Read Full Email Body & Thread',
      description:
        'Returns the complete plaintext body and thread messages for a specific email ID returned by get_email_inbox or search_emails.',
      inputSchema: {
        messageId: z.string().describe('Unified email ID (e.g. "gmail:..." or "microsoft:..." or "thunderbird:...").'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await readEmail(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 31. Draft Email or Reply
  server.registerTool(
    'draft_email',
    {
      title: 'Create Email Draft or Reply Draft',
      description:
        'Creates a real email draft (or threaded reply draft) in Gmail, Hotmail/Outlook.com, or Thunderbird (@uwo.ca). The draft syncs directly to Spark Mail Drafts so Kevin can review or send it from any device.',
      inputSchema: {
        account: z
          .string()
          .optional()
          .describe('Which account to draft from ("gmail", "hotmail", "school", "uwo", or full email). Auto-inferred when replyToMessageId is provided.'),
        to: z.array(z.string()).optional().describe('Recipient email addresses (auto-filled when replying).'),
        cc: z.array(z.string()).optional().describe('Optional CC email addresses.'),
        bcc: z.array(z.string()).optional().describe('Optional BCC email addresses.'),
        subject: z.string().optional().describe('Email subject line (auto-filled with Re: when replying).'),
        bodyText: z.string().describe('Plaintext body of the draft email.'),
        replyToMessageId: z
          .string()
          .optional()
          .describe('Optional unified messageId to create a threaded reply draft.'),
        replyAll: z.boolean().optional().describe('Set true to reply-all when replyToMessageId is set.'),
        rationale: z.string().optional().describe('Short note explaining why this draft was created.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await draftEmail(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 32. Triage / Sort / Move / Trash Emails
  server.registerTool(
    'triage_emails',
    {
      title: 'Sort, Archive, Move, Star, Mark Read, or Trash Emails',
      description:
        'Organizes emails across Gmail, Hotmail, or Thunderbird (@uwo.ca): archive, move to a folder/label, mark_read, mark_unread, star, unstar, or delete (moves safely to Trash; defaults to 1-click Kevin-OS Approval Inbox unless auto_delete_allowed is enabled on the account).',
      inputSchema: {
        action: z
          .enum(['archive', 'move', 'delete', 'mark_read', 'mark_unread', 'star', 'unstar'])
          .describe('Action to apply to the specified messageIds.'),
        messageIds: z
          .array(z.string())
          .min(1)
          .describe('One or more unified email IDs from get_email_inbox / search_emails.'),
        account: z.string().optional().describe('Optional account hint (auto-inferred from messageIds).'),
        targetFolder: z
          .string()
          .optional()
          .describe('Target folder or Gmail label name (required when action is "move").'),
        rationale: z.string().optional().describe('Short reason for this triage/delete action.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await triageEmails(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 33. Send Email or Reply (Protected by Approval Inbox by default)
  server.registerTool(
    'send_email',
    {
      title: 'Send Email or Reply (Approval-Protected)',
      description:
        'Sends an email or threaded reply from Gmail, Hotmail/Outlook.com, or Thunderbird (@uwo.ca). By default queues in Kevin-OS Email Approval Inbox (/email) for 1-click confirmation unless Kevin explicitly enabled auto-send for that account.',
      inputSchema: {
        account: z
          .string()
          .optional()
          .describe('Account to send from ("gmail", "hotmail", "school", "uwo", or full email). Auto-inferred on reply.'),
        to: z.array(z.string()).optional().describe('Recipient email addresses (required for new email).'),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string().optional().describe('Email subject line.'),
        bodyText: z.string().describe('Plaintext body of the email to send.'),
        replyToMessageId: z
          .string()
          .optional()
          .describe('Optional unified messageId to send as a threaded reply.'),
        replyAll: z.boolean().optional(),
        rationale: z.string().optional().describe('Short note explaining why this email should be sent.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonToolResult(await sendEmail(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  // 16. Future-Proof Extensible Read-Only Data Table Query
  server.registerTool(
    'query_kevin_os_data',
    {
      title: 'Query Kevin-OS Database Tables',
      description:
        'Future-proof read-only query tool across Kevin-OS Supabase tables (including newly added modules/tables). Call with no table parameter to list known tables, or specify a table name and optional filters/ordering. System token rows are automatically excluded.',
      inputSchema: {
        table: z
          .string()
          .optional()
          .describe('Supabase table name (e.g. "tasks", "biometrics", "school_items", "workout_logs", or any newly added Kevin-OS table). Omit to list known tables.'),
        limit: z.number().int().min(1).max(100).optional().describe('Max rows to return (default: 25).'),
        orderBy: z.string().optional().describe('Optional column name to sort by (e.g. "date", "updated_at").'),
        ascending: z.boolean().optional().describe('Sort ascending (default: false / newest first).'),
        equals: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('Optional exact-match column filters.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        return jsonToolResult(await queryKevinOsTable(args));
      } catch (err) {
        return jsonToolResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    }
  );

  return server;
}

async function handleAuthorizedMcpPost(req: NextRequest): Promise<Response> {
  const auth = verifyBearerRequest(req);
  if (!auth.authorized) {
    await recordMcpTrace('mcp_post_unauth', 401, {
      hasAuthHeader: Boolean(req.headers.get('authorization')),
    });
    return buildUnauthorizedMcpResponse(req);
  }

  // Normalize Accept header so clients sending application/json or */* work cleanly with enableJsonResponse
  const accept = req.headers.get('accept') || '';
  let transportReq: Request = req;
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    const headers = new Headers(req.headers);
    headers.set('accept', 'application/json, text/event-stream');
    const bodyText = await req.text();
    transportReq = new Request(req.url, {
      method: req.method,
      headers,
      body: bodyText,
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = createKevinOsMcpServer();
  await server.connect(transport);

  try {
    const response = await transport.handleRequest(transportReq);
    await recordMcpTrace('mcp_post_ok', response.status, {});
    return withMcpCors(response);
  } finally {
    await server.close().catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  return handleAuthorizedMcpPost(req);
}

export async function GET(req: NextRequest) {
  const auth = verifyBearerRequest(req);
  if (!auth.authorized) {
    await recordMcpTrace('mcp_get_unauth', 401, {});
    return buildUnauthorizedMcpResponse(req);
  }
  // Stateless StreamableHTTP server: standalone server-initiated SSE streams are not used
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed on stateless MCP endpoint. Use POST for JSON-RPC requests.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: getMcpCorsHeaders({
        Allow: 'POST, DELETE, OPTIONS',
        'Content-Type': 'application/json',
      }),
    }
  );
}

export async function DELETE(req: NextRequest) {
  const auth = verifyBearerRequest(req);
  if (!auth.authorized) {
    return buildUnauthorizedMcpResponse(req);
  }
  return new Response(null, {
    status: 204,
    headers: getMcpCorsHeaders(),
  });
}

export async function OPTIONS() {
  return mcpCorsPreflight();
}
