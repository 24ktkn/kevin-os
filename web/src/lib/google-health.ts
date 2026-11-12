import { google } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import fs from 'fs';
import path from 'path';

export const SYSTEM_HEALTH_TOKEN_UID = '__system_google_health_token__';
export const GOOGLE_HEALTH_BASE_URL = 'https://health.googleapis.com/v4';
export const OAUTH_PLAYGROUND_REDIRECT = 'https://developers.google.com/oauthplayground';

export const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
];

function cleanEnvVal(val?: string): string {
  return (val || '').replace(/^["']|["']$/g, '').trim();
}

let runtimeHealthRefreshToken = '';
let runtimeHealthClientId = '';
let runtimeHealthClientSecret = '';
let lastHealthTokenDbCheckMs = 0;

export function getGoogleHealthOAuthConfig() {
  const clientId = cleanEnvVal(
    runtimeHealthClientId ||
      process.env.GOOGLE_HEALTH_CLIENT_ID ||
      process.env.GOOGLE_TASKS_CLIENT_ID
  );
  const clientSecret = cleanEnvVal(
    runtimeHealthClientSecret ||
      process.env.GOOGLE_HEALTH_CLIENT_SECRET ||
      process.env.GOOGLE_TASKS_CLIENT_SECRET
  );
  const authUrl = clientId
    ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(
        OAUTH_PLAYGROUND_REDIRECT
      )}&response_type=code&scope=${encodeURIComponent(
        GOOGLE_HEALTH_SCOPES.join(' ')
      )}&access_type=offline&prompt=consent`
    : '';

  return { clientId, clientSecret, authUrl };
}

/**
 * Persists the Google Health OAuth refresh token (and OAuth client credentials) to Supabase and local .env.local.
 */
export async function saveGoogleHealthRefreshToken(newToken: string): Promise<void> {
  const cleaned = cleanEnvVal(newToken);
  if (!cleaned) return;

  runtimeHealthRefreshToken = cleaned;
  lastHealthTokenDbCheckMs = Date.now();

  const { clientId, clientSecret } = getGoogleHealthOAuthConfig();
  const payloadStr =
    clientId && clientSecret
      ? JSON.stringify({ refreshToken: cleaned, clientId, clientSecret })
      : cleaned;

  const sb = supabaseAdmin || supabase;
  if (sb) {
    try {
      await sb.from('school_items').upsert({
        uid: SYSTEM_HEALTH_TOKEN_UID,
        title: 'System Google Health OAuth Token',
        category: 'system',
        is_completed: false,
        is_scheduled: false,
        target_calendar: payloadStr,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Could not persist Google Health refresh token to Supabase:', err);
    }
  }

  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      if (content.includes('GOOGLE_HEALTH_REFRESH_TOKEN=')) {
        const updated = content.replace(
          /^GOOGLE_HEALTH_REFRESH_TOKEN=.*$/m,
          `GOOGLE_HEALTH_REFRESH_TOKEN="${cleaned}"`
        );
        fs.writeFileSync(envPath, updated, 'utf8');
      } else {
        fs.appendFileSync(envPath, `\nGOOGLE_HEALTH_REFRESH_TOKEN="${cleaned}"\n`, 'utf8');
      }
    }
  } catch {
    // Ignore on read-only serverless filesystems
  }
}

/**
 * Loads the Google Health refresh token (and OAuth client credentials if bundled) from Supabase or environment variables.
 */
export async function loadGoogleHealthRefreshTokenFromDb(force = false): Promise<string> {
  const now = Date.now();
  if (!force && runtimeHealthRefreshToken && now - lastHealthTokenDbCheckMs < 60_000) {
    return runtimeHealthRefreshToken;
  }

  const sb = supabaseAdmin || supabase;
  if (sb) {
    try {
      const { data } = await sb
        .from('school_items')
        .select('target_calendar')
        .eq('uid', SYSTEM_HEALTH_TOKEN_UID)
        .maybeSingle();

      lastHealthTokenDbCheckMs = now;
      if (data?.target_calendar) {
        const raw = String(data.target_calendar).trim();
        if (raw.startsWith('{')) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.refreshToken) runtimeHealthRefreshToken = cleanEnvVal(parsed.refreshToken);
            if (parsed.clientId) runtimeHealthClientId = cleanEnvVal(parsed.clientId);
            if (parsed.clientSecret) runtimeHealthClientSecret = cleanEnvVal(parsed.clientSecret);
          } catch {
            runtimeHealthRefreshToken = cleanEnvVal(raw);
          }
        } else {
          const dbToken = cleanEnvVal(raw);
          if (dbToken) {
            runtimeHealthRefreshToken = dbToken;
          }
        }
      }
    } catch {
      // Ignore DB lookup errors
    }
  }

  return runtimeHealthRefreshToken || cleanEnvVal(process.env.GOOGLE_HEALTH_REFRESH_TOKEN);
}

/**
 * Returns a fresh OAuth2 access token for the Google Health API v4.
 */
export async function getGoogleHealthAccessTokenAsync(forceReload = false): Promise<{
  accessToken: string | null;
  hasCredentials: boolean;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  authUrl: string;
  error?: string;
}> {
  const refreshToken = await loadGoogleHealthRefreshTokenFromDb(forceReload);
  const { clientId, clientSecret, authUrl } = getGoogleHealthOAuthConfig();

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      accessToken: null,
      hasCredentials: false,
      clientId,
      clientSecret,
      refreshToken,
      authUrl,
      error: !refreshToken
        ? 'Google Health has not been authorized yet.'
        : 'Missing OAuth Client ID or Secret.',
    };
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      OAUTH_PLAYGROUND_REDIRECT
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const tokenRes = await oauth2Client.getAccessToken();
    const accessToken = tokenRes?.token || null;

    if (!accessToken) {
      return {
        accessToken: null,
        hasCredentials: true,
        clientId,
        clientSecret,
        refreshToken,
        authUrl,
        error: 'Failed to obtain access token from Google Health refresh token.',
      };
    }

    return {
      accessToken,
      hasCredentials: true,
      clientId,
      clientSecret,
      refreshToken,
      authUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      accessToken: null,
      hasCredentials: true,
      clientId,
      clientSecret,
      refreshToken,
      authUrl,
      error: msg,
    };
  }
}

/**
 * Verifies that an access token can successfully query the Google Health v4 API.
 */
export async function verifyGoogleHealthToken(accessToken: string): Promise<{
  ok: boolean;
  identity?: Record<string, unknown>;
  error?: string;
}> {
  try {
    const res = await fetch(
      `${GOOGLE_HEALTH_BASE_URL}/users/me/dataTypes/daily-resting-heart-rate/dataPoints?pageSize=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, identity: data };
    }

    const errJson = await res.json().catch(() => ({}));
    const errMsg =
      errJson?.error?.message ||
      errJson?.error_description ||
      `HTTP ${res.status} ${res.statusText}`;
    return { ok: false, error: errMsg };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface GoogleHealthDailySummary {
  date: string;
  steps?: number;
  rhr?: number;
  hrv?: number;
  weight?: number;
  sleep?: number;
  sleepTime?: string;
  wakeTime?: string;
  workoutCalories?: number;
  workoutDuration?: number;
}

function toEasternDateStr(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function toEasternTime12h(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });
}

function parseCivilDateObj(obj: any): string {
  if (!obj) return '';
  if (typeof obj === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(obj.trim())) return obj.trim();
    return toEasternDateStr(obj);
  }
  const d = obj.date || obj;
  if (d && typeof d.year === 'number' && typeof d.month === 'number' && typeof d.day === 'number') {
    return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  }
  if (obj.physicalTime || obj.civilTime) {
    return toEasternDateStr(obj.physicalTime || obj.civilTime);
  }
  return '';
}

async function fetchHealthEndpoint(
  accessToken: string,
  pathAndQuery: string,
  init?: RequestInit
): Promise<any> {
  const url = `${GOOGLE_HEALTH_BASE_URL}${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Health API ${res.status} on ${pathAndQuery}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

async function fetchDataPointsWithFallback(
  accessToken: string,
  dataType: string,
  preferReconcile = true,
  pageSize = 500
): Promise< any[] > {
  const endpoints = preferReconcile
    ? [
        `/users/me/dataTypes/${dataType}/dataPoints:reconcile?pageSize=${pageSize}`,
        `/users/me/dataTypes/${dataType}/dataPoints?pageSize=${pageSize}`,
      ]
    : [
        `/users/me/dataTypes/${dataType}/dataPoints?pageSize=${pageSize}`,
        `/users/me/dataTypes/${dataType}/dataPoints:reconcile?pageSize=${pageSize}`,
      ];

  for (const ep of endpoints) {
    try {
      const data = await fetchHealthEndpoint(accessToken, ep);
      if (Array.isArray(data?.dataPoints)) {
        return data.dataPoints;
      }
      if (Array.isArray(data?.reconciledDataPoints)) {
        return data.reconciledDataPoints;
      }
    } catch {
      // Try next fallback endpoint
    }
  }
  return [];
}

/**
 * Fetches and reconciles daily biometrics, sleep, and workout summaries from Google Health API v4
 * for the last `daysBack` calendar days in America/New_York.
 */
export async function fetchGoogleHealthDailyRecords(daysBack = 7): Promise<{
  records: GoogleHealthDailySummary[];
  diagnostics: Record<string, string>;
}> {
  const { accessToken, error } = await getGoogleHealthAccessTokenAsync();
  if (!accessToken) {
    throw new Error(error || 'Not authenticated with Google Health API.');
  }

  const now = new Date();
  const cutoffDate = new Date(now.getTime() - (daysBack + 1) * 24 * 3600 * 1000);
  const minDateStr = toEasternDateStr(cutoffDate);
  const todayStr = toEasternDateStr(now);

  const byDate = new Map<string, GoogleHealthDailySummary>();
  const ensureDay = (dateStr: string): GoogleHealthDailySummary | null => {
    if (!dateStr || dateStr < minDateStr || dateStr > todayStr) return null;
    let existing = byDate.get(dateStr);
    if (!existing) {
      existing = { date: dateStr };
      byDate.set(dateStr, existing);
    }
    return existing;
  };

  const diagnostics: Record<string, string> = {};

  // Run all 6 Google Health v4 metric fetches in parallel
  await Promise.all([
    // 1. STEPS (Apple Watch priority + non-overlapping iPhone interval deduplication, fallback to dailyRollUp)
    (async () => {
      try {
        let gotDeduplicatedSteps = false;
        try {
          const rawData = await fetchHealthEndpoint(
            accessToken,
            '/users/me/dataTypes/steps/dataPoints?pageSize=2500'
          );
          const rawPts = Array.isArray(rawData?.dataPoints) ? rawData.dataPoints : [];
          if (rawPts.length > 0) {
            const ptsByDate = new Map<string, any[]>();
            for (const p of rawPts) {
              const s = p.steps || p;
              const dStr = parseCivilDateObj(
                s?.interval?.civilStartTime ||
                  s?.interval?.startTime ||
                  s?.startTime ||
                  s?.date
              );
              if (!dStr) continue;
              let arr = ptsByDate.get(dStr);
              if (!arr) {
                arr = [];
                ptsByDate.set(dStr, arr);
              }
              arr.push(p);
            }

            for (const [dStr, dayPts] of ptsByDate.entries()) {
              const rec = ensureDay(dStr);
              if (!rec) continue;

              const watchPts = dayPts.filter(
                (p) => p?.dataSource?.device?.formFactor !== 'PHONE'
              );
              const phonePts = dayPts.filter(
                (p) => p?.dataSource?.device?.formFactor === 'PHONE'
              );

              if (watchPts.length > 0 && phonePts.length > 0) {
                const watchIntervals = watchPts.map((p) => {
                  const iv = p.steps?.interval || p.interval || {};
                  return {
                    start: new Date(iv.startTime || 0).getTime(),
                    end: new Date(iv.endTime || 0).getTime(),
                    count: Number(p.steps?.count ?? p.steps?.countSum ?? 0),
                  };
                });

                const watchSum = watchIntervals.reduce((acc, w) => acc + w.count, 0);
                let nonOverlapPhone = 0;
                for (const p of phonePts) {
                  const iv = p.steps?.interval || p.interval || {};
                  const pStart = new Date(iv.startTime || 0).getTime();
                  const pEnd = new Date(iv.endTime || 0).getTime();
                  const c = Number(p.steps?.count ?? p.steps?.countSum ?? 0);
                  const overlaps = watchIntervals.some(
                    (w) => pStart <= w.end + 60_000 && pEnd >= w.start - 60_000
                  );
                  if (!overlaps) {
                    nonOverlapPhone += c;
                  }
                }
                const totalSteps = Math.round(watchSum + nonOverlapPhone);
                if (totalSteps > 0) {
                  rec.steps = totalSteps;
                  gotDeduplicatedSteps = true;
                }
              } else {
                const sum = dayPts.reduce(
                  (acc, p) => acc + Number(p.steps?.count ?? p.steps?.countSum ?? 0),
                  0
                );
                if (sum > 0) {
                  rec.steps = Math.round(sum);
                  gotDeduplicatedSteps = true;
                }
              }
            }
          }
        } catch {
          // Fallback to dailyRollUp below
        }

        if (!gotDeduplicatedSteps) {
          const [startY, startM, startD] = minDateStr.split('-').map(Number);
          const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
          const [endY, endM, endD] = toEasternDateStr(tomorrow).split('-').map(Number);

          const rollupData = await fetchHealthEndpoint(
            accessToken,
            '/users/me/dataTypes/steps/dataPoints:dailyRollUp',
            {
              method: 'POST',
              body: JSON.stringify({
                range: {
                  start: {
                    date: { year: startY, month: startM, day: startD },
                    time: { hours: 0, minutes: 0, seconds: 0 },
                  },
                  end: {
                    date: { year: endY, month: endM, day: endD },
                    time: { hours: 0, minutes: 0, seconds: 0 },
                  },
                },
                windowSizeDays: 1,
              }),
            }
          );

          const rollupPoints =
            rollupData?.dailyRollupDataPoints || rollupData?.rollupDataPoints || [];
          if (Array.isArray(rollupPoints) && rollupPoints.length > 0) {
            for (const pt of rollupPoints) {
              const dStr = parseCivilDateObj(pt.civilStartTime || pt.startDate || pt.startTime);
              const countVal = Number(
                pt.steps?.countSum ??
                  pt.steps?.count ??
                  pt.rollupValue?.steps?.countSum ??
                  pt.rollupValue?.steps?.count ??
                  0
              );
              const rec = ensureDay(dStr);
              if (rec && countVal > 0) {
                rec.steps = Math.max(rec.steps || 0, Math.round(countVal));
              }
            }
          }
        }
        diagnostics.steps = 'ok';
      } catch (e: unknown) {
        diagnostics.steps = e instanceof Error ? e.message : String(e);
      }
    })(),

    // 2. RESTING HEART RATE (daily-resting-heart-rate)
    (async () => {
      try {
        const pts = await fetchDataPointsWithFallback(
          accessToken,
          'daily-resting-heart-rate',
          false,
          100
        );
        for (const dp of pts) {
          const r = dp.dailyRestingHeartRate || dp.restingHeartRate || dp;
          const dStr = parseCivilDateObj(
            r?.date || r?.sampleTime || r?.interval?.startTime || dp?.date
          );
          const bpm = parseFloat(
            String(
              r?.beatsPerMinute ??
                r?.averageBeatsPerMinute ??
                r?.restingHeartRateBpm ??
                r?.value ??
                0
            )
          );
          const rec = ensureDay(dStr);
          if (rec && bpm > 25 && bpm < 200) {
            rec.rhr = Math.round(bpm);
          }
        }
        diagnostics.rhr = `ok (${pts.length} pts)`;
      } catch (e: unknown) {
        diagnostics.rhr = e instanceof Error ? e.message : String(e);
      }
    })(),

    // 3. HEART RATE VARIABILITY (daily-heart-rate-variability)
    (async () => {
      try {
        const pts = await fetchDataPointsWithFallback(
          accessToken,
          'daily-heart-rate-variability',
          false,
          100
        );
        for (const dp of pts) {
          const h = dp.dailyHeartRateVariability || dp.heartRateVariability || dp;
          const dStr = parseCivilDateObj(
            h?.date || h?.sampleTime || h?.interval?.startTime || dp?.date
          );
          const ms = parseFloat(
            String(
              h?.averageHeartRateVariabilityMilliseconds ??
                h?.rootMeanSquareOfSuccessiveDifferencesMilliseconds ??
                h?.rmssdMilliseconds ??
                h?.dailyRmssd ??
                h?.rmssd ??
                h?.value ??
                0
            )
          );
          const rec = ensureDay(dStr);
          if (rec && ms > 0 && ms < 300) {
            rec.hrv = Math.round(ms * 10) / 10;
          }
        }
        diagnostics.hrv = `ok (${pts.length} pts)`;
      } catch (e: unknown) {
        diagnostics.hrv = e instanceof Error ? e.message : String(e);
      }
    })(),

    // 4. BODYWEIGHT (weight)
    (async () => {
      try {
        const pts = await fetchDataPointsWithFallback(accessToken, 'weight', true, 100);
        for (const dp of pts) {
          const w = dp.weight || dp.bodyWeight || dp;
          const dStr = parseCivilDateObj(
            w?.sampleTime?.physicalTime ||
              w?.sampleTime ||
              w?.interval?.startTime ||
              w?.date ||
              w?.time
          );
          let lbs = 0;
          if (w?.weightGrams !== undefined) {
            lbs = Number(w.weightGrams) / 453.59237;
          } else if (w?.grams !== undefined) {
            lbs = Number(w.grams) / 453.59237;
          } else if (w?.weightKilograms !== undefined || w?.kilograms !== undefined) {
            lbs = Number(w.weightKilograms ?? w.kilograms) * 2.20462262;
          } else if (w?.weightPounds !== undefined || w?.pounds !== undefined) {
            lbs = Number(w.weightPounds ?? w.pounds);
          } else if (w?.mass?.unit && w?.mass?.value) {
            const u = String(w.mass.unit).toUpperCase();
            const v = Number(w.mass.value);
            if (u.includes('GRAM') && !u.includes('KILO')) lbs = v / 453.59237;
            else if (u.includes('KILO') || u === 'KG') lbs = v * 2.20462262;
            else lbs = v;
          }
          const rec = ensureDay(dStr);
          if (rec && lbs > 50 && lbs < 400) {
            rec.weight = Math.round(lbs * 10) / 10;
          }
        }
        diagnostics.weight = `ok (${pts.length} pts)`;
      } catch (e: unknown) {
        diagnostics.weight = e instanceof Error ? e.message : String(e);
      }
    })(),

    // 5. SLEEP (sleep: duration, bedtime, wake time)
    (async () => {
      try {
        const pts = await fetchDataPointsWithFallback(accessToken, 'sleep', true, 60);
        // Track longest sleep session per wake date so naps don't overwrite main night sleep
        const longestSessionMinsByDate = new Map<string, number>();

        for (const dp of pts) {
          const sl = dp.sleep || dp;
          const startRaw = sl?.interval?.startTime || sl?.startTime;
          const endRaw = sl?.interval?.endTime || sl?.endTime;
          if (!startRaw || !endRaw) continue;

          const startDate = new Date(startRaw);
          const endDate = new Date(endRaw);
          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;

          // Attribute night sleep to the wake-up date in America/New_York
          const wakeDateStr = toEasternDateStr(endDate);
          const rec = ensureDay(wakeDateStr);
          if (!rec) continue;

          // Compute actual asleep minutes
          let asleepMins = Number(
            sl?.sleepSummary?.minutesAsleep ??
              sl?.summary?.minutesAsleep ??
              sl?.minutesAsleep ??
              0
          );

          if (asleepMins <= 0 && Array.isArray(sl?.stages) && sl.stages.length > 0) {
            let stageAsleepMs = 0;
            for (const st of sl.stages) {
              const stageType = String(st?.stage || st?.type || '').toUpperCase();
              const isAwake =
                stageType.includes('AWAKE') ||
                stageType.includes('OUT_OF_BED') ||
                stageType === 'WAKE';
              if (isAwake) continue;
              const stStart = new Date(st?.interval?.startTime || st?.startTime || '').getTime();
              const stEnd = new Date(st?.interval?.endTime || st?.endTime || '').getTime();
              if (!isNaN(stStart) && !isNaN(stEnd) && stEnd > stStart) {
                stageAsleepMs += stEnd - stStart;
              }
            }
            if (stageAsleepMs > 0) {
              asleepMins = stageAsleepMs / 60_000;
            }
          }

          const totalIntervalMins = (endDate.getTime() - startDate.getTime()) / 60_000;
          if (asleepMins <= 0 && totalIntervalMins > 0 && totalIntervalMins < 24 * 60) {
            asleepMins = totalIntervalMins;
          }

          if (asleepMins <= 0) continue;

          const prevLongest = longestSessionMinsByDate.get(wakeDateStr) || 0;
          const hours = Math.round((asleepMins / 60) * 10) / 10;

          if (asleepMins >= prevLongest) {
            longestSessionMinsByDate.set(wakeDateStr, asleepMins);
            rec.sleep = hours;
            rec.sleepTime = toEasternTime12h(startDate);
            rec.wakeTime = toEasternTime12h(endDate);
          }
        }
        diagnostics.sleep = `ok (${pts.length} pts)`;
      } catch (e: unknown) {
        diagnostics.sleep = e instanceof Error ? e.message : String(e);
      }
    })(),

    // 6. WORKOUTS / EXERCISE (exercise: workoutDuration & workoutCalories)
    (async () => {
      try {
        const pts = await fetchDataPointsWithFallback(accessToken, 'exercise', true, 100);
        const dailyCal = new Map<string, number>();
        const dailyDur = new Map<string, number>();

        for (const dp of pts) {
          const ex = dp.exercise || dp;
          const startRaw = ex?.interval?.startTime || ex?.startTime;
          const endRaw = ex?.interval?.endTime || ex?.endTime;
          if (!startRaw) continue;

          const startDate = new Date(startRaw);
          if (isNaN(startDate.getTime())) continue;
          const dStr = toEasternDateStr(startDate);

          let durMins = 0;
          if (endRaw) {
            const endDate = new Date(endRaw);
            if (!isNaN(endDate.getTime()) && endDate > startDate) {
              durMins = (endDate.getTime() - startDate.getTime()) / 60_000;
            }
          }
          if (durMins <= 0 && ex?.metricsSummary?.activeDuration) {
            const activeSec = parseFloat(String(ex.metricsSummary.activeDuration).replace('s', ''));
            if (activeSec > 0) durMins = activeSec / 60;
          }

          const cals = Number(
            ex?.metricsSummary?.caloriesKcal ??
              ex?.activeEnergyBurned?.energy?.value ??
              ex?.caloriesKcal ??
              ex?.caloriesBurned ??
              0
          );

          if (durMins > 0 && durMins < 12 * 60) {
            dailyDur.set(dStr, (dailyDur.get(dStr) || 0) + durMins);
          }
          if (cals > 0) {
            dailyCal.set(dStr, (dailyCal.get(dStr) || 0) + cals);
          }
        }

        const allWorkoutDates = new Set([...dailyCal.keys(), ...dailyDur.keys()]);
        for (const dStr of allWorkoutDates) {
          const rec = ensureDay(dStr);
          if (!rec) continue;
          const c = dailyCal.get(dStr) || 0;
          const m = dailyDur.get(dStr) || 0;
          if (c > 0) rec.workoutCalories = Math.round(c);
          if (m > 0) rec.workoutDuration = Math.round(m);
        }
        diagnostics.exercise = `ok (${pts.length} pts)`;
      } catch (e: unknown) {
        diagnostics.exercise = e instanceof Error ? e.message : String(e);
      }
    })(),
  ]);

  const records = Array.from(byDate.values())
    .filter(
      (r) =>
        (r.steps && r.steps > 0) ||
        (r.rhr && r.rhr > 0) ||
        (r.hrv && r.hrv > 0) ||
        (r.weight && r.weight > 0) ||
        (r.sleep && r.sleep > 0) ||
        (r.workoutCalories && r.workoutCalories > 0) ||
        (r.workoutDuration && r.workoutDuration > 0)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  return { records, diagnostics };
}
