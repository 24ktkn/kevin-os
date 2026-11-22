import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { computeAnkiBridgeToken } from '@/lib/anki-utils';
import { getEmailAccountsWithCounts, isMissingEmailTableError } from '@/lib/email-hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { accounts, safetyConfig, needsMigration } = await getEmailAccountsWithCounts();
    return NextResponse.json({
      success: true,
      needsMigration,
      accounts,
      safetyConfig,
      bridgeToken: computeAnkiBridgeToken(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to load email accounts' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const body = (await req.json()) as {
      accountId?: string;
      account_label?: string;
      permission_mode?: 'read' | 'draft_triage' | 'full_send';
      auto_send_allowed?: boolean;
      auto_delete_allowed?: boolean;
    };

    if (!body.accountId) {
      return NextResponse.json({ success: false, error: 'accountId is required' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.account_label === 'string') patch.account_label = body.account_label.trim();
    if (
      body.permission_mode === 'read' ||
      body.permission_mode === 'draft_triage' ||
      body.permission_mode === 'full_send'
    ) {
      patch.permission_mode = body.permission_mode;
    }
    if (typeof body.auto_send_allowed === 'boolean') patch.auto_send_allowed = body.auto_send_allowed;
    if (typeof body.auto_delete_allowed === 'boolean') patch.auto_delete_allowed = body.auto_delete_allowed;

    const { error } = await sb.from('email_accounts').update(patch).eq('id', body.accountId);
    if (error) {
      if (isMissingEmailTableError(error)) {
        return NextResponse.json({ success: false, needsMigration: true, error: 'Run Email Hub SQL migration first.' }, { status: 400 });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to update email account' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const body = (await req.json()) as {
      microsoft_client_id?: string;
      microsoft_client_secret?: string;
      require_approval_for_send?: boolean;
      require_approval_for_delete?: boolean;
    };

    const upsertRow: Record<string, unknown> = {
      id: 'default',
      updated_at: new Date().toISOString(),
    };
    if (typeof body.microsoft_client_id === 'string' && body.microsoft_client_id.trim()) {
      upsertRow.microsoft_client_id = body.microsoft_client_id.trim();
    }
    if (typeof body.microsoft_client_secret === 'string' && body.microsoft_client_secret.trim()) {
      upsertRow.microsoft_client_secret = body.microsoft_client_secret.trim();
    }
    if (typeof body.require_approval_for_send === 'boolean') {
      upsertRow.require_approval_for_send = body.require_approval_for_send;
    }
    if (typeof body.require_approval_for_delete === 'boolean') {
      upsertRow.require_approval_for_delete = body.require_approval_for_delete;
    }

    const { error } = await sb
      .from('email_oauth_config')
      .upsert(upsertRow, { onConflict: 'id' });

    if (error) {
      if (isMissingEmailTableError(error)) {
        return NextResponse.json({ success: false, needsMigration: true, error: 'Run Email Hub SQL migration first.' }, { status: 400 });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to save email config' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const accountId = req.nextUrl.searchParams.get('id')?.trim();
    if (!accountId) {
      return NextResponse.json({ success: false, error: 'id query param is required' }, { status: 400 });
    }

    const { error } = await sb.from('email_accounts').delete().eq('id', accountId);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to remove email account' },
      { status: 500 }
    );
  }
}
