import { DEFAULT_ELENTRA_ICAL_URL } from '@/lib/elentra-calendar';
import { getCalendarDateString, getTodayDateStr } from '@/lib/date-utils';
import { ExamTarget } from '@/types/anki';

export interface DetectedElentraExam {
  id: string;
  name: string;
  examDate: string; // YYYY-MM-DD
  daysUntil: number;
  severity: 'major' | 'quiz';
  suggestedDeckFilter?: string;
  bufferDays: number;
  source: 'elentra';
}

export interface ExamTaperStatus {
  inTaperMode: boolean;
  taperWindowDays: number;
  daysUntilNextMajorExam: number | null;
  nextMajorExam: DetectedElentraExam | null;
  upcomingMajorExams: DetectedElentraExam[];
  upcomingQuizzes: DetectedElentraExam[];
  taperMessage: string;
}

const MAJOR_EXAM_REGEX =
  /\b(final\s+summative|summative\s+exam|anatomy\s+summative|final\s+integrated\s+assessment|progress\s+test|tosce|osce|midterm|final\s+exam|bell\s*ringer)\b/i;
const WEEKLY_QUIZ_REGEX = /\bweek\s*\d+\s*quiz\b/i;
const EXCLUDE_REGEX =
  /^\(\s*\d+\s*(?:mins?|minutes?)\s*\)|peer\s*&\s*self|self-assessment|review\s+session|readiness\s+assessment|breast\s+exam|lce\s+final\s+assessment/i;

function guessDeckFilter(title: string): string | undefined {
  const wk = title.match(/\bweek\s*0?(\d{1,2})\b/i);
  if (wk) {
    const padded = wk[1].padStart(2, '0');
    return `Week ${padded}`;
  }
  if (/anatomy/i.test(title)) return 'Anatomy';
  if (/summative|final\s+integrated|progress\s+test/i.test(title)) return 'FoM';
  return undefined;
}

function parseRawIcsToEvents(rawText: string): Array<{ summary: string; dateStr: string }> {
  const normalized = rawText.replace(/\r\n /g, '').replace(/\n /g, '');
  const lines = normalized.split(/\r?\n/);
  const out: Array<{ summary: string; dateStr: string }> = [];
  let inEvent = false;
  let cur: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = {};
    } else if (line === 'END:VEVENT') {
      inEvent = false;
      const dtStart = cur['DTSTART'];
      const summary = (cur['SUMMARY'] || '').replace(/\\,/g, ',').trim();
      if (dtStart && summary) {
        let dateStr = '';
        if (dtStart.length === 8) {
          dateStr = `${dtStart.slice(0, 4)}-${dtStart.slice(4, 6)}-${dtStart.slice(6, 8)}`;
        } else if (dtStart.length >= 15) {
          const isUtc = dtStart.endsWith('Z');
          const clean = dtStart.replace('Z', '');
          const y = parseInt(clean.slice(0, 4), 10);
          const mo = parseInt(clean.slice(4, 6), 10) - 1;
          const d = parseInt(clean.slice(6, 8), 10);
          const h = parseInt(clean.slice(9, 11), 10);
          const mi = parseInt(clean.slice(11, 13), 10);
          const s = parseInt(clean.slice(13, 15), 10);
          const dt = isUtc ? new Date(Date.UTC(y, mo, d, h, mi, s)) : new Date(y, mo, d, h, mi, s);
          dateStr = getCalendarDateString(dt);
        }
        if (dateStr) out.push({ summary, dateStr });
      }
    } else if (inEvent) {
      const idx = line.indexOf(':');
      if (idx > -1) {
        const key = line.slice(0, idx).split(';')[0];
        cur[key] = line.slice(idx + 1);
      }
    }
  }
  return out;
}

let cachedExams: { fetchedAt: number; exams: DetectedElentraExam[] } | null = null;
const EXAM_CACHE_TTL_MS = 15 * 60_000;

/**
 * Fetches upcoming Schulich exams, TOSCEs, Progress Tests, and Weekly Quizzes directly
 * from Kevin's Elentra ICS feed and computes Exam Taper Mode status.
 */
export async function getDetectedElentraExams(
  taperWindowDays = 7
): Promise<ExamTaperStatus> {
  const todayStr = getTodayDateStr();
  let detected: DetectedElentraExam[] = [];

  if (cachedExams && Date.now() - cachedExams.fetchedAt < EXAM_CACHE_TTL_MS) {
    detected = cachedExams.exams;
  } else {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(DEFAULT_ELENTRA_ICAL_URL, {
        headers: { 'User-Agent': 'KevinOS/2.0' },
        signal: controller.signal,
        cache: 'no-store',
      }).finally(() => clearTimeout(timer));

      if (res.ok) {
        const rawText = await res.text();
        const events = parseRawIcsToEvents(rawText);
        const todayMs = new Date(`${todayStr}T12:00:00Z`).getTime();
        const seen = new Set<string>();

        for (const ev of events) {
          if (ev.dateStr < todayStr) continue;
          if (EXCLUDE_REGEX.test(ev.summary)) continue;

          const isMajor = MAJOR_EXAM_REGEX.test(ev.summary);
          const isQuiz = !isMajor && WEEKLY_QUIZ_REGEX.test(ev.summary);
          if (!isMajor && !isQuiz) continue;

          const dedupKey = `${ev.dateStr}|${ev.summary.toLowerCase()}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);

          const examMs = new Date(`${ev.dateStr}T12:00:00Z`).getTime();
          const daysUntil = Math.max(0, Math.round((examMs - todayMs) / 86_400_000));

          detected.push({
            id: `elentra-${ev.dateStr}-${ev.summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`,
            name: ev.summary,
            examDate: ev.dateStr,
            daysUntil,
            severity: isMajor ? 'major' : 'quiz',
            suggestedDeckFilter: guessDeckFilter(ev.summary),
            bufferDays: isMajor ? 3 : 1,
            source: 'elentra',
          });
        }

        detected.sort((a, b) => a.examDate.localeCompare(b.examDate));
        cachedExams = { fetchedAt: Date.now(), exams: detected };
      }
    } catch {
      // Non-fatal fallback
    }
  }

  // Recompute daysUntil cleanly against current todayStr
  const todayMs = new Date(`${todayStr}T12:00:00Z`).getTime();
  const active = detected
    .filter((e) => e.examDate >= todayStr)
    .map((e) => ({
      ...e,
      daysUntil: Math.max(
        0,
        Math.round((new Date(`${e.examDate}T12:00:00Z`).getTime() - todayMs) / 86_400_000)
      ),
    }));

  const upcomingMajorExams = active.filter((e) => e.severity === 'major');
  const upcomingQuizzes = active.filter((e) => e.severity === 'quiz');
  const nextMajorExam = upcomingMajorExams[0] || null;
  const daysUntilNextMajorExam = nextMajorExam ? nextMajorExam.daysUntil : null;
  const inTaperMode =
    daysUntilNextMajorExam !== null && daysUntilNextMajorExam <= taperWindowDays;

  const taperMessage = inTaperMode && nextMajorExam
    ? `EXAM TAPER MODE ACTIVE: ${nextMajorExam.name} is in ${daysUntilNextMajorExam} day${daysUntilNextMajorExam === 1 ? '' : 's'} (${nextMajorExam.examDate}). Protect Anki reviews & high-yield exam blocks first and defer non-essential tasks.`
    : nextMajorExam
    ? `Next major exam: ${nextMajorExam.name} in ${daysUntilNextMajorExam} days (${nextMajorExam.examDate}).`
    : 'No major exams detected in Elentra yet.';

  return {
    inTaperMode,
    taperWindowDays,
    daysUntilNextMajorExam,
    nextMajorExam,
    upcomingMajorExams,
    upcomingQuizzes,
    taperMessage,
  };
}

export function detectedExamToTarget(exam: DetectedElentraExam): ExamTarget {
  return {
    id: exam.id,
    name: exam.name,
    examDate: exam.examDate,
    deckFilter: exam.suggestedDeckFilter,
    bufferDays: exam.bufferDays,
  };
}
