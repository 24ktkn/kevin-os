import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  buildUnauthorizedMcpResponse,
  getMcpCorsHeaders,
  mcpCorsPreflight,
  verifyBearerRequest,
  withMcpCors,
} from '@/lib/mcp-auth';
import {
  completeTask,
  deleteTask,
  getHabitsData,
  getHealthSummary,
  getJournalData,
  getKevinOsOverview,
  getMealsAndGroceries,
  getScheduleAndTasks,
  getSchoolModules,
  getWorkoutsData,
  logHabit,
  queryKevinOsTable,
  rescheduleTask,
  saveJournalEntry,
  scheduleItem,
  scheduleWeekModules,
  toggleGroceryItem,
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
        'You are connected to Kevin-OS, Kevin Nguyen’s personal productivity, medical school (Schulich UWO), health biometrics, habits, workouts, daily journal, and meal prep system. ' +
        'All dates use America/New_York (Eastern Time) in YYYY-MM-DD format. ' +
        'When scheduling school modules, always check existing classes and calendars via schedule_week_modules or schedule_item so modules are created as paired Google Calendar [Task] timeblocks + Google Tasks + Supabase records without overlapping Schulich Elentra classes.',
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
        'Finds unscheduled incomplete online school modules in a date range, schedules them into open daytime slots around all 4 Google Calendars AND Schulich Elentra classes (preserving module durations), and creates paired Google Calendar [Task] blocks, Google Tasks, and Supabase school_items links. Supports dryRun=true to preview before committing.',
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

  // 14. Future-Proof Extensible Read-Only Data Table Query
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
