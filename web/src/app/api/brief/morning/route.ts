import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getTodayDateStr } from '@/lib/date-utils';
import { getOsSettings } from '@/lib/habit-automations';
import { getDetectedElentraExams } from '@/lib/elentra-exams';
import { getElentraBusyBlocksForDate } from '@/lib/elentra-calendar';
import { isMissingAnkiTableError, verifyAnkiBridgeRequest } from '@/lib/anki-utils';
import { GET as healthGet } from '@/app/api/health/route';
import { GET as habitsGet } from '@/app/api/habits/route';
import { GET as ankiStatsGet } from '@/app/api/anki/stats/route';
import { MorningBriefPayload } from '@/types/digests';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

async function generateCoachNoteWithAI(brief: MorningBriefPayload): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const fallback = brief.taper.inTaperMode
    ? `Exam Taper Mode is active (${brief.taper.nextMajorExam} in ${brief.taper.daysUntil}d). Protect your ${brief.anki?.dueRemaining || 0} Anki reviews (~${brief.anki?.estimatedMins || 0}m) first around your ${brief.classesToday.length} class(es) today.`
    : `Readiness is ${brief.readiness?.score ?? '—'}/100 (${brief.readiness?.sleepDuration || 'sleep N/A'}). Knock out ${brief.anki?.dueRemaining || 0} Anki due cards (~${brief.anki?.estimatedMins || 0}m) and ${brief.tasksTodayCount} planned task(s) around ${brief.classesToday.length} class(es).`;

  if (!apiKey) return fallback;

  const prompt = `You are Kevin-OS Morning Coach for Kevin Nguyen (Schulich medical student).
Write a crisp, motivating 2-to-3 sentence morning game plan based on today's exact numbers (no bullet spam, no greetings fluff):
- Date: ${brief.date}
- Readiness: ${brief.readiness ? `${brief.readiness.score}/100 (${brief.readiness.tier}), Sleep ${brief.readiness.sleepDuration}, HRV ${brief.readiness.hrv}, Wake ${brief.readiness.wakeTime}` : 'Not synced yet'}
- Anki Due: ${brief.anki ? `${brief.anki.dueRemaining} cards (~${brief.anki.estimatedMins}m), Streak ${brief.anki.streakDays}d` : 'N/A'}
- Exam Taper: ${brief.taper.message}
- Schulich Classes Today (${brief.classesToday.length}): ${brief.classesToday.map((c) => `${c.startTime} ${c.title}`).join('; ') || 'None'}
- Outstanding Tasks Today (${brief.tasksTodayCount}): ${brief.topTasks.map((t) => `${t.time ? t.time + ' ' : ''}${t.title}`).join('; ') || 'None'}`;

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.35 },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;
    } catch {
      // try next model
    } finally {
      clearTimeout(timer);
    }
  }
  return fallback;
}

async function sendNtfyNotification(params: {
  server: string;
  topic: string;
  title: string;
  body: string;
  priority?: 'default' | 'high';
  tags?: string;
}): Promise<{ sent: boolean; error?: string }> {
  const topic = params.topic.trim();
  if (!topic) return { sent: false, error: 'No ntfy.sh topic configured yet.' };
  const server = (params.server || 'https://ntfy.sh').replace(/\/$/, '');
  const tags = (params.tags || 'sunrise,brain')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  try {
    // Publish as JSON to the ntfy server root so UTF-8/emojis in Title/Message never fail Node's ASCII ByteString header check
    const res = await fetch(`${server}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        topic,
        title: params.title,
        message: params.body,
        priority: params.priority === 'high' ? 4 : 3,
        tags,
        click: 'https://kevin-os-xr4m.vercel.app',
        actions: [
          { action: 'view', label: 'Open Kevin-OS', url: 'https://kevin-os-xr4m.vercel.app' },
          { action: 'view', label: 'Open Anki', url: 'https://kevin-os-xr4m.vercel.app/anki' },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { sent: false, error: `ntfy HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'ntfy push failed' };
  }
}

async function buildMorningBrief(): Promise<MorningBriefPayload> {
  const todayStr = getTodayDateStr();
  const sb = supabaseAdmin || supabase;
  const settings = await getOsSettings();

  const [healthRes, habitsRes, ankiRes, classesToday, taperStatus, tasksRes] = await Promise.all([
    healthGet(new NextRequest('http://localhost/api/health'))
      .then((r) => r.json())
      .catch(() => null),
    habitsGet().then((r) => r.json()).catch(() => null),
    ankiStatsGet().then((r) => r.json()).catch(() => null),
    getElentraBusyBlocksForDate(todayStr).catch(() => []),
    getDetectedElentraExams(settings.exam_taper_days),
    sb
      ? sb
          .from('tasks')
          .select('title, due_time, calendar_name, is_completed, type')
          .eq('is_completed', false)
          .lte('due_date', todayStr)
          .order('due_time', { ascending: true, nullsFirst: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
  ]);

  const hData = healthRes?.data || null;
  const readinessObj = hData?.readiness || healthRes?.readiness || null;

  const ankiToday = ankiRes?.today || null;
  const habitsList = Array.isArray(habitsRes?.habits) ? habitsRes.habits : [];
  const habitsDone = habitsList.filter((h: { completedToday?: boolean }) => h.completedToday).length;

  const rawTasks = (tasksRes?.data || []) as Array<{
    title: string;
    due_time?: string;
    calendar_name?: string;
  }>;
  const seenTitles = new Set<string>();
  const dedupTasks = [];
  for (const t of rawTasks) {
    const clean = String(t.title || '')
      .replace(/^[^\w(]+/, '')
      .replace(/^\[Task\]\s*/i, '')
      .trim();
    const key = clean.toLowerCase();
    if (!clean || seenTitles.has(key)) continue;
    seenTitles.add(key);
    dedupTasks.push({
      title: clean,
      time: t.due_time || '',
      calendar: t.calendar_name || 'School',
    });
  }

  const scoreStr = readinessObj?.score ? `Readiness ${readinessObj.score}/100` : 'Morning Brief';
  const ankiStr = ankiToday ? `${ankiToday.total_due_remaining || 0} Anki due` : '';
  const taperTag = taperStatus.inTaperMode
    ? `🔥 Taper (${taperStatus.daysUntilNextMajorExam}d to ${taperStatus.nextMajorExam?.name})`
    : '';
  const headline = [scoreStr, ankiStr, taperTag].filter(Boolean).join(' · ');

  const brief: MorningBriefPayload = {
    date: todayStr,
    generatedAt: new Date().toISOString(),
    headline,
    coachNote: '',
    readiness: hData
      ? {
          score: readinessObj?.score ?? 0,
          tier: readinessObj?.tier ?? 'Good',
          sleepDuration: hData.sleep_duration || 'No data',
          sleepHours: Number(hData.sleep_hours || 0),
          hrv: Number(hData.hrv || 0),
          rhr: Number(hData.rhr || 0),
          wakeTime: hData.wake_time || 'No data',
        }
      : null,
    anki: ankiToday
      ? {
          dueRemaining: Number(ankiToday.total_due_remaining || 0),
          reviewDue: Number(ankiToday.review_due_remaining || 0),
          learningRem: Number(ankiToday.learning_remaining || 0),
          estimatedMins: Number(ankiRes?.studyPlan?.rawEstimatedMins || 0),
          streakDays: Number(ankiToday.streak_days || 0),
          pendingProposals: Number(ankiRes?.pendingProposalsCount || 0),
        }
      : null,
    taper: {
      inTaperMode: taperStatus.inTaperMode,
      nextMajorExam: taperStatus.nextMajorExam?.name || null,
      daysUntil: taperStatus.daysUntilNextMajorExam,
      examDate: taperStatus.nextMajorExam?.examDate || null,
      message: taperStatus.taperMessage,
    },
    classesToday: classesToday.map((c) => ({
      title: c.title,
      startTime: c.startTime12h,
      endTime: c.endTime12h,
    })),
    tasksTodayCount: dedupTasks.length,
    topTasks: dedupTasks.slice(0, 5),
    habitsCompletedCount: habitsDone,
    habitsTotalCount: habitsList.length || 4,
  };

  brief.coachNote = await generateCoachNoteWithAI(brief);
  return brief;
}

function formatPushBody(brief: MorningBriefPayload): string {
  const lines: string[] = [];
  if (brief.readiness) {
    lines.push(
      `Readiness ${brief.readiness.score}/100 (${brief.readiness.tier}) · Sleep ${brief.readiness.sleepDuration} · HRV ${brief.readiness.hrv}ms`
    );
  }
  if (brief.anki) {
    lines.push(
      `Anki: ${brief.anki.dueRemaining} due (~${brief.anki.estimatedMins}m) · Streak ${brief.anki.streakDays}d${
        brief.anki.pendingProposals > 0 ? ` · ${brief.anki.pendingProposals} AI inbox` : ''
      }`
    );
  }
  if (brief.taper.inTaperMode && brief.taper.nextMajorExam) {
    lines.push(`🔥 Exam Taper: ${brief.taper.nextMajorExam} in ${brief.taper.daysUntil}d`);
  }
  lines.push(
    `Schedule: ${brief.classesToday.length} Schulich class(es) · ${brief.tasksTodayCount} task(s) today`
  );
  lines.push('');
  lines.push(brief.coachNote);
  return lines.join('\n');
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    const todayStr = getTodayDateStr();
    const refresh = req.nextUrl.searchParams.get('refresh') === 'true';
    const digestId = `morning:${todayStr}`;

    if (sb && !refresh) {
      const { data: cached, error } = await sb
        .from('os_digests')
        .select('*')
        .eq('id', digestId)
        .maybeSingle();

      if (!error && cached?.payload_json) {
        return NextResponse.json({
          success: true,
          cached: true,
          brief: {
            ...(cached.payload_json as MorningBriefPayload),
            pushedViaNtfy: Boolean(cached.pushed_via_ntfy),
            pushedAt: cached.pushed_at || null,
          },
        });
      }
    }

    const brief = await buildMorningBrief();

    if (sb) {
      const { error: uErr } = await sb.from('os_digests').upsert(
        {
          id: digestId,
          digest_type: 'morning',
          date: todayStr,
          headline: brief.headline,
          summary_text: brief.coachNote,
          payload_json: brief,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (uErr && !isMissingAnkiTableError(uErr)) {
        console.warn('os_digests upsert warning:', uErr.message);
      }
    }

    return NextResponse.json({ success: true, cached: false, brief });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Morning brief failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const body = (await req.json().catch(() => ({}))) as {
      push?: boolean;
      testPush?: boolean;
      ntfyTopic?: string;
      ntfyServer?: string;
      force?: boolean;
    };

    const wantsPush = Boolean(body.push || body.testPush || url.searchParams.get('push') === 'true');
    const isCronHeader =
      Boolean(req.headers.get('x-vercel-cron')) ||
      verifyAnkiBridgeRequest(req) ||
      (process.env.CRON_SECRET &&
        req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`);

    const settings = await getOsSettings();
    const todayStr = getTodayDateStr();
    const digestId = `morning:${todayStr}`;
    const sb = supabaseAdmin || supabase;

    // Prevent double-push on scheduled cron runs if already pushed today
    if (isCronHeader && wantsPush && !body.force && !body.testPush && sb) {
      if (!settings.morning_brief_enabled) {
        return NextResponse.json({ success: true, skipped: true, reason: 'Morning brief disabled' });
      }
      const { data: existing } = await sb
        .from('os_digests')
        .select('pushed_via_ntfy')
        .eq('id', digestId)
        .maybeSingle();
      if (existing?.pushed_via_ntfy) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: `Already pushed morning brief for ${todayStr}.`,
        });
      }
    }

    const brief = await buildMorningBrief();
    let pushResult: { sent: boolean; error?: string } = { sent: false };

    if (wantsPush) {
      const topic = (body.ntfyTopic || settings.ntfy_topic || '').trim();
      const server = (body.ntfyServer || settings.ntfy_server || 'https://ntfy.sh').trim();
      pushResult = await sendNtfyNotification({
        server,
        topic,
        title: `Kevin-OS · ${brief.headline}`,
        body: formatPushBody(brief),
        priority: brief.taper.inTaperMode ? 'high' : 'default',
        tags: brief.taper.inTaperMode ? 'fire,brain' : 'sunrise,brain',
      });
    }

    const nowIso = new Date().toISOString();
    if (sb) {
      await sb
        .from('os_digests')
        .upsert(
          {
            id: digestId,
            digest_type: 'morning',
            date: todayStr,
            headline: brief.headline,
            summary_text: brief.coachNote,
            payload_json: brief,
            pushed_via_ntfy: pushResult.sent,
            pushed_at: pushResult.sent ? nowIso : null,
            updated_at: nowIso,
          },
          { onConflict: 'id' }
        )
        .then();
    }

    return NextResponse.json({
      success: true,
      brief: {
        ...brief,
        pushedViaNtfy: pushResult.sent,
        pushedAt: pushResult.sent ? nowIso : null,
      },
      pushResult,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Morning brief push failed' },
      { status: 500 }
    );
  }
}
