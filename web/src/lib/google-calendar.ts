import { google, calendar_v3, tasks_v1 } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

export const CALENDAR_MAP: Record<string, string> = {
  'School': '0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com',
  'Kevin Nguyen': '24ktkn@gmail.com',
  'Family': 'family05668227215423587251@group.calendar.google.com',
  'Volunteering': '57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com',
};

export const TASKLIST_MAP: Record<string, string> = {
  'School': 'MDQ4NjkxMjM2OTk5NDY1NzIzOTg6MDow',
  'Kevin Nguyen': '@default',
  'Family': 'ZzR2aGJ6b2p1dWJtN2R2dA',
  'Volunteering': 'YVl5dGVCZ1d5eW9hVEluTw',
};

export const SYSTEM_TOKEN_UID = '__system_google_tasks_token__';

function cleanEnvVal(val?: string): string {
  return (val || '').replace(/^["']|["']$/g, '').trim();
}

export function getServiceAccountPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY || '';
  return key.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

let cachedCalendarClient: calendar_v3.Calendar | null = null;
let cachedCalendarEmail = '';

/**
 * Returns a cached Google Calendar API v3 client authenticated via Service Account JWT.
 */
export function getGoogleCalendarClient(): calendar_v3.Calendar | null {
  const clientEmail = cleanEnvVal(process.env.GOOGLE_CLIENT_EMAIL);
  const privateKey = getServiceAccountPrivateKey();

  if (!clientEmail || !privateKey) {
    return null;
  }

  if (cachedCalendarClient && cachedCalendarEmail === clientEmail) {
    return cachedCalendarClient;
  }

  const jwtAuth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  cachedCalendarEmail = clientEmail;
  cachedCalendarClient = google.calendar({ version: 'v3', auth: jwtAuth });
  return cachedCalendarClient;
}

let cachedTasksClient: tasks_v1.Tasks | null = null;
let cachedRefreshToken = '';
let runtimeRefreshTokenOverride = '';
let lastDbTokenCheckMs = 0;

/**
 * Updates the in-memory, Supabase-persisted, and local .env.local Google Tasks refresh token.
 */
export async function saveGoogleTasksRefreshToken(newToken: string): Promise<void> {
  const cleaned = cleanEnvVal(newToken);
  if (!cleaned) return;

  runtimeRefreshTokenOverride = cleaned;
  cachedRefreshToken = '';
  cachedTasksClient = null;
  lastDbTokenCheckMs = Date.now();

  // 1. Persist in Supabase school_items system row so Vercel & all instances share it
  const sb = supabaseAdmin || supabase;
  if (sb) {
    try {
      await sb.from('school_items').upsert({
        uid: SYSTEM_TOKEN_UID,
        title: 'System Google Tasks OAuth Token',
        category: 'system',
        is_completed: false,
        is_scheduled: false,
        target_calendar: cleaned,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Could not persist refresh token to Supabase:', err);
    }
  }

  // 2. Also update local .env.local if running locally
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      if (content.includes('GOOGLE_TASKS_REFRESH_TOKEN=')) {
        const updated = content.replace(
          /^GOOGLE_TASKS_REFRESH_TOKEN=.*$/m,
          `GOOGLE_TASKS_REFRESH_TOKEN="${cleaned}"`
        );
        fs.writeFileSync(envPath, updated, 'utf8');
      } else {
        fs.appendFileSync(envPath, `\nGOOGLE_TASKS_REFRESH_TOKEN="${cleaned}"\n`, 'utf8');
      }
    }
  } catch {
    // Ignore on read-only serverless filesystems (e.g., Vercel)
  }
}

/**
 * Loads the latest Google Tasks refresh token from Supabase if available.
 */
export async function loadGoogleTasksRefreshTokenFromDb(force = false): Promise<string> {
  const now = Date.now();
  if (!force && runtimeRefreshTokenOverride && now - lastDbTokenCheckMs < 60_000) {
    return runtimeRefreshTokenOverride;
  }

  const sb = supabaseAdmin || supabase;
  if (sb) {
    try {
      const { data } = await sb
        .from('school_items')
        .select('target_calendar')
        .eq('uid', SYSTEM_TOKEN_UID)
        .maybeSingle();

      lastDbTokenCheckMs = now;
      if (data?.target_calendar) {
        const dbToken = cleanEnvVal(data.target_calendar);
        if (dbToken && dbToken !== runtimeRefreshTokenOverride) {
          runtimeRefreshTokenOverride = dbToken;
          cachedTasksClient = null;
        }
      }
    } catch {
      // Ignore DB lookup errors
    }
  }

  return runtimeRefreshTokenOverride || cleanEnvVal(process.env.GOOGLE_TASKS_REFRESH_TOKEN);
}

/**
 * Returns a cached Google Tasks API v1 client authenticated via OAuth2 Refresh Token.
 */
export function getGoogleTasksClient(): {
  tasksApi: tasks_v1.Tasks | null;
  hasCredentials: boolean;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  const clientId = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_ID);
  const clientSecret = cleanEnvVal(process.env.GOOGLE_TASKS_CLIENT_SECRET);
  const refreshToken =
    runtimeRefreshTokenOverride || cleanEnvVal(process.env.GOOGLE_TASKS_REFRESH_TOKEN);

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      tasksApi: null,
      hasCredentials: false,
      clientId,
      clientSecret,
      refreshToken,
    };
  }

  if (cachedTasksClient && cachedRefreshToken === refreshToken) {
    return {
      tasksApi: cachedTasksClient,
      hasCredentials: true,
      clientId,
      clientSecret,
      refreshToken,
    };
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  cachedRefreshToken = refreshToken;
  cachedTasksClient = google.tasks({ version: 'v1', auth: oauth2Client });

  return {
    tasksApi: cachedTasksClient,
    hasCredentials: true,
    clientId,
    clientSecret,
    refreshToken,
  };
}

/**
 * Async version that checks Supabase for a newer persisted refresh token before returning the client.
 */
export async function getGoogleTasksClientAsync(forceReload = false) {
  await loadGoogleTasksRefreshTokenFromDb(forceReload);
  return getGoogleTasksClient();
}

/**
 * Builds or updates the "⏰ Scheduled: ..." line inside a Google Task's notes field.
 */
export function buildScheduledNotesTag(
  existingNotes: string | null | undefined,
  dateStr: string,
  timeStr?: string,
  durationMins?: number
): string {
  const scheduledTag = `⏰ Scheduled: ${dateStr}${timeStr ? ` at ${timeStr}` : ''}${
    durationMins ? ` (${durationMins} mins)` : ''
  }`;
  const notes = existingNotes || '';
  if (notes.includes('⏰ Scheduled:')) {
    return notes.replace(/⏰ Scheduled:.*$/m, scheduledTag);
  }
  return `${notes ? `${notes}\n\n` : ''}${scheduledTag}`;
}
