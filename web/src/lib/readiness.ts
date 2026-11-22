export interface BiometricHistoryRow {
  date: string;
  sleep_hours?: number | null;
  hrv?: number | null;
  rhr?: number | null;
  steps?: number | null;
  workout_duration?: number | null;
  workout_calories?: number | null;
}

export interface ReadinessResult {
  score: number; // 0-100
  tier: 'Peak' | 'Good' | 'Moderate' | 'Recovery';
  color: 'emerald' | 'cyan' | 'amber' | 'rose';
  headline: string;
  recommendation: string;
  breakdown: {
    sleepPts: number; // /40
    hrvPts: number;   // /30
    rhrPts: number;   // /20
    loadPts: number;  // /10
  };
  baselines: {
    avgSleep14d: number | null;
    avgHrv14d: number | null;
    avgRhr14d: number | null;
  };
  dataDate: string | null;
}

/**
 * Computes a free Oura/Whoop-style Daily Readiness Score (0-100) from Kevin's biometrics
 * compared against his rolling 14-day personal HRV & RHR baselines.
 */
export function computeDailyReadiness(
  rowsNewestFirst: BiometricHistoryRow[]
): ReadinessResult {
  if (!rowsNewestFirst || rowsNewestFirst.length === 0) {
    return {
      score: 0,
      tier: 'Moderate',
      color: 'cyan',
      headline: 'Awaiting Biometrics',
      recommendation: 'Sync Google Health to calculate today’s Readiness Score.',
      breakdown: { sleepPts: 0, hrvPts: 0, rhrPts: 0, loadPts: 0 },
      baselines: { avgSleep14d: null, avgHrv14d: null, avgRhr14d: null },
      dataDate: null,
    };
  }

  // Pick the most recent day with real sleep/HRV/RHR data
  const latest =
    rowsNewestFirst.find(
      (r) => Number(r.sleep_hours || 0) > 0 || Number(r.hrv || 0) > 0 || Number(r.rhr || 0) > 0
    ) || rowsNewestFirst[0];

  const baselineWindow = rowsNewestFirst.slice(0, 15);
  const avgPositive = (vals: number[]) =>
    vals.length > 0 ? Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 10) / 10 : null;

  const avgSleep14d = avgPositive(
    baselineWindow.map((r) => Number(r.sleep_hours || 0)).filter((v) => v >= 2 && v <= 16)
  );
  const avgHrv14d = avgPositive(
    baselineWindow.map((r) => Number(r.hrv || 0)).filter((v) => v >= 10 && v <= 250)
  );
  const avgRhr14d = avgPositive(
    baselineWindow.map((r) => Number(r.rhr || 0)).filter((v) => v >= 35 && v <= 120)
  );

  // 1. Sleep Score (0..40 pts — optimal >= 7.5h)
  const sleep = Number(latest.sleep_hours || 0);
  let sleepPts = 26;
  if (sleep > 0) {
    if (sleep >= 7.5) sleepPts = 40;
    else if (sleep >= 7.0) sleepPts = 36;
    else if (sleep >= 6.5) sleepPts = 31;
    else if (sleep >= 6.0) sleepPts = 25;
    else if (sleep >= 5.5) sleepPts = 18;
    else sleepPts = 12;
  }

  // 2. HRV vs 14-day personal baseline (0..30 pts)
  const hrv = Number(latest.hrv || 0);
  let hrvPts = 22;
  if (hrv > 0 && avgHrv14d && avgHrv14d > 0) {
    const ratio = hrv / avgHrv14d;
    if (ratio >= 1.05) hrvPts = 30;
    else if (ratio >= 0.96) hrvPts = 27;
    else if (ratio >= 0.88) hrvPts = 22;
    else if (ratio >= 0.78) hrvPts = 16;
    else hrvPts = 10;
  } else if (hrv >= 65) {
    hrvPts = 28;
  } else if (hrv >= 45) {
    hrvPts = 22;
  }

  // 3. Resting Heart Rate vs 14-day baseline (0..20 pts — lower RHR = better recovery)
  const rhr = Number(latest.rhr || 0);
  let rhrPts = 15;
  if (rhr > 0 && avgRhr14d && avgRhr14d > 0) {
    const diff = rhr - avgRhr14d;
    if (diff <= -2) rhrPts = 20;
    else if (diff <= 1.5) rhrPts = 18;
    else if (diff <= 4) rhrPts = 14;
    else if (diff <= 7) rhrPts = 10;
    else rhrPts = 6;
  } else if (rhr > 0 && rhr <= 60) {
    rhrPts = 18;
  }

  // 4. Recovery / Load balance from previous day's strain (0..10 pts)
  const prevDay = rowsNewestFirst[1];
  const prevDur = Number(prevDay?.workout_duration || 0);
  const prevSteps = Number(prevDay?.steps || 0);
  let loadPts = 8;
  if (prevDur >= 95 || prevSteps >= 16000) loadPts = 6; // High strain yesterday
  else if (prevDur >= 30 && prevDur <= 80) loadPts = 10; // Sweet spot active training
  else if (prevDur === 0 && prevSteps >= 6000) loadPts = 9; // Rest/active recovery day

  const score = Math.max(15, Math.min(100, Math.round(sleepPts + hrvPts + rhrPts + loadPts)));

  let tier: ReadinessResult['tier'] = 'Good';
  let color: ReadinessResult['color'] = 'cyan';
  let headline = 'Solid Readiness';
  let recommendation =
    'Good balance of sleep and autonomic recovery — tackle your core Schulich modules and Anki queue normally.';

  if (score >= 85) {
    tier = 'Peak';
    color = 'emerald';
    headline = 'Peak Cognitive & Physical Readiness';
    recommendation =
      'Great recovery window — front-load your heaviest medical modules, push progressive overload in the gym, and knock out new Anki cards.';
  } else if (score >= 70) {
    tier = 'Good';
    color = 'cyan';
    headline = 'Ready to Perform';
    recommendation =
      'Steady recovery — stick to your scheduled modules, Anki reviews, and normal training intensity.';
  } else if (score >= 55) {
    tier = 'Moderate';
    color = 'amber';
    headline = 'Moderate Recovery';
    recommendation =
      'Slightly elevated fatigue — split long Anki reviews into two blocks, protect an early bedtime, and keep gym sets crisp without grinding to failure.';
  } else {
    tier = 'Recovery';
    color = 'rose';
    headline = 'Recovery Priority Day';
    recommendation =
      'Low sleep or suppressed HRV — focus strictly on must-do Anki reviews & mandatory classes, defer optional modules, and prioritize 8h sleep tonight.';
  }

  return {
    score,
    tier,
    color,
    headline,
    recommendation,
    breakdown: { sleepPts, hrvPts, rhrPts, loadPts },
    baselines: { avgSleep14d, avgHrv14d, avgRhr14d },
    dataDate: latest.date || null,
  };
}
