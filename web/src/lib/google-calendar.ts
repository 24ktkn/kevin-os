import { google, calendar_v3, tasks_v1 } from 'googleapis';

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
  const refreshToken = cleanEnvVal(process.env.GOOGLE_TASKS_REFRESH_TOKEN);

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
