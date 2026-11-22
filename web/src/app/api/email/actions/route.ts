import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  approveOrRejectEmailAction,
  isMissingEmailTableError,
  proposeOrExecuteEmailAction,
} from '@/lib/email-hub';
import { EmailActionPayload, EmailActionType } from '@/types/email';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) return NextResponse.json({ success: true, actions: [] });

    const status = req.nextUrl.searchParams.get('status') || undefined;
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 40)));

    let q = sb
      .from('email_actions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status && status !== 'all') {
      q = q.eq('status', status);
    }

    const { data, error } = await q;
    if (error) {
      if (isMissingEmailTableError(error)) {
        return NextResponse.json({ success: true, needsMigration: true, actions: [] });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, actions: data || [] });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to load email actions' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      account?: string;
      actionType: EmailActionType;
      payload: EmailActionPayload;
      rationale?: string;
      source?: 'gemini_mcp' | 'kevin_os_ui';
      forceApproval?: boolean;
    };

    if (!body.actionType) {
      return NextResponse.json({ success: false, error: 'actionType is required' }, { status: 400 });
    }

    const res = await proposeOrExecuteEmailAction({
      accountHint: body.account,
      actionType: body.actionType,
      payload: body.payload || {},
      rationale: body.rationale,
      source: body.source || 'kevin_os_ui',
      forceApproval: body.forceApproval,
    });

    return NextResponse.json({ success: true, ...res });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to create email action' },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      actionId?: string;
      decision?: 'approve' | 'reject';
      editedPayload?: Partial<EmailActionPayload>;
    };

    if (!body.actionId || (body.decision !== 'approve' && body.decision !== 'reject')) {
      return NextResponse.json(
        { success: false, error: 'actionId and decision ("approve" | "reject") are required.' },
        { status: 400 }
      );
    }

    const updated = await approveOrRejectEmailAction({
      actionId: body.actionId,
      decision: body.decision,
      editedPayload: body.editedPayload,
    });

    return NextResponse.json({ success: true, action: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to update action' },
      { status: 400 }
    );
  }
}
