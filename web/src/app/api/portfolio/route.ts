import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { isMissingAnkiTableError } from '@/lib/anki-utils';
import { CANMEDS_ROLES, PortfolioEntry } from '@/types/portfolio';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

async function draftCarmsBulletsWithAI(input: {
  title: string;
  organization?: string;
  role?: string;
  category?: string;
  description: string;
}): Promise<{ bullets: string[]; suggestedCanmeds: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      bullets: [
        `Contributed as ${input.role || 'member'} at ${input.organization || 'organization'}: ${input.description.slice(0, 140)}`,
      ],
      suggestedCanmeds: ['Collaborator', 'Professional'],
    };
  }

  const prompt = `You are a Canadian medical school CaRMS CV & Personal Portfolio advisor for a Western University (Schulich) MD student.
Convert this activity into 3 crisp, high-impact CaRMS CV bullet points (strong action verbs, concrete scope/outcomes, concise medical-application tone) AND select the 2-3 best-fitting CanMEDS roles strictly from: ${CANMEDS_ROLES.join(', ')}.

ACTIVITY:
Title: ${input.title}
Category: ${input.category || 'clinical'}
Role: ${input.role || ''}
Organization: ${input.organization || ''}
Raw Description: ${input.description}

Return ONLY a raw JSON object:
{
  "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
  "suggestedCanmeds": ["Role 1", "Role 2"]
}`;

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.25,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.bullets)) {
        return {
          bullets: parsed.bullets.map(String).filter(Boolean).slice(0, 5),
          suggestedCanmeds: Array.isArray(parsed.suggestedCanmeds)
            ? parsed.suggestedCanmeds.filter((r: string) =>
                (CANMEDS_ROLES as readonly string[]).includes(r)
              )
            : [],
        };
      }
    } catch {
      // next model
    } finally {
      clearTimeout(timer);
    }
  }
  return { bullets: [], suggestedCanmeds: [] };
}

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }

    const category = (req.nextUrl.searchParams.get('category') || '').trim().toLowerCase();
    const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

    let query = sb
      .from('portfolio_entries')
      .select('*')
      .order('is_ongoing', { ascending: false })
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    const { data, error } = await query.limit(300);
    if (error) {
      if (isMissingAnkiTableError(error)) {
        return NextResponse.json({
          success: true,
          needsMigration: true,
          entries: [],
          summary: { totalEntries: 0, totalHours: 0, ongoingCount: 0, canmedsCoverage: {} },
        });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    let entries = (data || []) as PortfolioEntry[];
    if (q) {
      entries = entries.filter((e) => {
        const hay = `${e.title} ${e.organization} ${e.role} ${e.description} ${(e.carms_bullets || []).join(' ')} ${(e.tags || []).join(' ')} ${(e.canmeds_roles || []).join(' ')}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const canmedsCoverage: Record<string, number> = {};
    for (const r of CANMEDS_ROLES) canmedsCoverage[r] = 0;
    let totalHours = 0;
    let ongoingCount = 0;
    for (const e of entries) {
      totalHours += Number(e.hours || 0);
      if (e.is_ongoing) ongoingCount += 1;
      for (const r of e.canmeds_roles || []) {
        if (r in canmedsCoverage) canmedsCoverage[r] += 1;
      }
    }

    return NextResponse.json({
      success: true,
      needsMigration: false,
      entries,
      summary: {
        totalEntries: entries.length,
        totalHours: Math.round(totalHours * 10) / 10,
        ongoingCount,
        canmedsCoverage,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to load portfolio' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<PortfolioEntry> & {
      action?: 'draft_carms_bullets';
    };

    if (body.action === 'draft_carms_bullets') {
      if (!body.title && !body.description) {
        return NextResponse.json(
          { success: false, error: 'Provide a title or description to draft CaRMS bullets.' },
          { status: 400 }
        );
      }
      const drafted = await draftCarmsBulletsWithAI({
        title: body.title || 'Medical Activity',
        organization: body.organization,
        role: body.role,
        category: body.category,
        description: body.description || body.title || '',
      });
      return NextResponse.json({ success: true, ...drafted });
    }

    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }
    if (!body.title?.trim()) {
      return NextResponse.json({ success: false, error: 'Title is required.' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const row = {
      category: body.category || 'clinical',
      title: body.title.trim(),
      organization: (body.organization || '').trim(),
      role: (body.role || '').trim(),
      start_date: (body.start_date || '').trim(),
      end_date: body.is_ongoing ? '' : (body.end_date || '').trim(),
      is_ongoing: body.is_ongoing !== false,
      hours: Math.max(0, Number(body.hours) || 0),
      verifier_name: (body.verifier_name || '').trim(),
      verifier_contact: (body.verifier_contact || '').trim(),
      canmeds_roles: Array.isArray(body.canmeds_roles) ? body.canmeds_roles : [],
      description: (body.description || '').trim(),
      carms_bullets: Array.isArray(body.carms_bullets)
        ? body.carms_bullets.map((b) => String(b).trim()).filter(Boolean)
        : [],
      tags: Array.isArray(body.tags)
        ? body.tags.map((t) => String(t).trim()).filter(Boolean)
        : [],
      updated_at: nowIso,
    };

    const { data, error } = await sb.from('portfolio_entries').insert(row).select('*').single();
    if (error) {
      if (isMissingAnkiTableError(error)) {
        return NextResponse.json(
          {
            success: false,
            needsMigration: true,
            error: 'Run web/supabase_migrations/add_os_upgrades_tables.sql in Supabase first.',
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, entry: data });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to save entry' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }
    const body = (await req.json().catch(() => ({}))) as Partial<PortfolioEntry>;
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'Entry id is required.' }, { status: 400 });
    }

    const { id, ...rest } = body;
    const { data, error } = await sb
      .from('portfolio_entries')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, entry: data });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
    }
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'Entry id is required.' }, { status: 400 });
    }
    const { error } = await sb.from('portfolio_entries').delete().eq('id', id);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 }
    );
  }
}
