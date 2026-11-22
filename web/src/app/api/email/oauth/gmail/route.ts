import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  EmailAccountRow,
  getGmailOAuthCredentials,
  makeEmailAccountId,
  syncGmailAccount,
} from '@/lib/email-providers';
import { defaultAccountLabel, isMissingEmailTableError } from '@/lib/email-hub';

export const dynamic = 'force-dynamic';

const OAUTH_PLAYGROUND_REDIRECT = 'https://developers.google.com/oauthplayground';
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export async function GET() {
  const { clientId } = getGmailOAuthCredentials();
  if (!clientId) {
    return NextResponse.json({
      configured: false,
      authUrl: '',
      error: 'Missing GOOGLE_TASKS_CLIENT_ID / GMAIL_CLIENT_ID on server.',
    });
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(
    OAUTH_PLAYGROUND_REDIRECT
  )}&response_type=code&scope=${encodeURIComponent(
    GMAIL_SCOPES
  )}&access_type=offline&prompt=consent`;

  return NextResponse.json({
    configured: true,
    authUrl,
    redirectUri: OAUTH_PLAYGROUND_REDIRECT,
  });
}

export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const body = (await req.json()) as {
      tokenOrCode?: string;
      accountLabel?: string;
    };
    const rawInput = String(body.tokenOrCode || '').trim();
    if (!rawInput) {
      return NextResponse.json(
        { success: false, error: 'Paste the full redirect URL, authorization code (4/...), or refresh token (1//...).' },
        { status: 400 }
      );
    }

    const { clientId, clientSecret } = getGmailOAuthCredentials();
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { success: false, error: 'Missing GOOGLE_TASKS_CLIENT_ID or GOOGLE_TASKS_CLIENT_SECRET on server.' },
        { status: 500 }
      );
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_PLAYGROUND_REDIRECT);
    let tokenOrCode = rawInput.replace(/^["']|["']$/g, '').trim();

    if (tokenOrCode.includes('code=')) {
      try {
        const u = new URL(tokenOrCode);
        const extracted = u.searchParams.get('code');
        if (extracted) tokenOrCode = extracted;
      } catch {
        const match = tokenOrCode.match(/[?&]code=([^&]+)/);
        if (match?.[1]) tokenOrCode = decodeURIComponent(match[1]);
      }
    }

    let refreshToken = tokenOrCode;
    let accessToken: string | undefined;

    if (tokenOrCode.startsWith('4/') || !tokenOrCode.startsWith('1//')) {
      const { tokens } = await oauth2Client.getToken(tokenOrCode);
      if (!tokens.refresh_token) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Google did not return a refresh_token. Click the Gmail Connect link again and approve all requested permissions.',
          },
          { status: 400 }
        );
      }
      refreshToken = tokens.refresh_token;
      accessToken = tokens.access_token || undefined;
    }

    oauth2Client.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const emailAddress = String(profile.data.emailAddress || '').trim().toLowerCase();

    if (!emailAddress) {
      return NextResponse.json(
        { success: false, error: 'Connected to Google, but could not determine Gmail email address.' },
        { status: 400 }
      );
    }

    const accountId = makeEmailAccountId('gmail', emailAddress);
    const nowIso = new Date().toISOString();
    const label = (body.accountLabel || '').trim() || defaultAccountLabel('gmail', emailAddress);

    const row: Partial<EmailAccountRow> & Record<string, unknown> = {
      id: accountId,
      provider: 'gmail',
      email_address: emailAddress,
      display_name: emailAddress,
      account_label: label,
      oauth_refresh_token: refreshToken,
      oauth_access_token: accessToken || null,
      permission_mode: 'full_send',
      is_active: true,
      last_error: null,
      updated_at: nowIso,
    };

    const { error: upsertErr } = await sb.from('email_accounts').upsert(row, { onConflict: 'id' });
    if (upsertErr) {
      if (isMissingEmailTableError(upsertErr)) {
        return NextResponse.json(
          { success: false, needsMigration: true, error: 'Run add_email_hub_tables.sql in Supabase SQL Editor first.' },
          { status: 400 }
        );
      }
      return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 });
    }

    // Immediate initial sync
    const syncRes = await syncGmailAccount(
      {
        ...(row as EmailAccountRow),
        provider_account_id: null,
        identity_id: null,
        oauth_expires_at: null,
        folders_json: [],
        auto_send_allowed: false,
        auto_delete_allowed: false,
        last_sync_at: null,
        last_sync_device: null,
      },
      40
    ).catch((err) => ({ syncedCount: 0, foldersCount: 0, error: err instanceof Error ? err.message : String(err) }));

    return NextResponse.json({
      success: true,
      accountId,
      emailAddress,
      syncedCount: syncRes.syncedCount,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to connect Gmail account',
      },
      { status: 400 }
    );
  }
}
