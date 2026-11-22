import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  EmailAccountRow,
  getEmailOAuthConfig,
  makeEmailAccountId,
  syncMicrosoftAccount,
} from '@/lib/email-providers';
import { defaultAccountLabel } from '@/lib/email-hub';

export const dynamic = 'force-dynamic';

const MS_SCOPES = 'offline_access User.Read Mail.ReadWrite Mail.Send';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const redirectBack = (status: string, detail?: string) => {
    const u = new URL('/email', origin);
    u.searchParams.set('ms_status', status);
    if (detail) u.searchParams.set('ms_msg', detail.slice(0, 180));
    const res = NextResponse.redirect(u);
    res.cookies.delete('kevin_os_ms_pkce');
    return res;
  };

  try {
    const errParam = req.nextUrl.searchParams.get('error_description') || req.nextUrl.searchParams.get('error');
    if (errParam) {
      return redirectBack('error', errParam);
    }

    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    if (!code) {
      return redirectBack('error', 'Missing authorization code from Microsoft.');
    }

    const cookieRaw = req.cookies.get('kevin_os_ms_pkce')?.value;
    let pkce: { state?: string; codeVerifier?: string; redirectUri?: string } = {};
    if (cookieRaw) {
      try {
        pkce = JSON.parse(cookieRaw);
      } catch {
        pkce = {};
      }
    }

    if (pkce.state && state && pkce.state !== state) {
      return redirectBack('error', 'OAuth state mismatch. Please click Connect Hotmail/Outlook again.');
    }

    const config = await getEmailOAuthConfig();
    if (!config.microsoft_client_id) {
      return redirectBack('error', 'Microsoft Client ID is missing.');
    }

    const redirectUri = pkce.redirectUri || `${origin}/api/email/oauth/microsoft/callback`;
    const form = new URLSearchParams();
    form.set('client_id', config.microsoft_client_id);
    if (config.microsoft_client_secret) {
      form.set('client_secret', config.microsoft_client_secret);
    }
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('redirect_uri', redirectUri);
    form.set('scope', MS_SCOPES);
    if (pkce.codeVerifier) {
      form.set('code_verifier', pkce.codeVerifier);
    }

    const tokenRes = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token || !tokenData.refresh_token) {
      return redirectBack(
        'error',
        tokenData.error_description || tokenData.error || `Microsoft token exchange failed (${tokenRes.status})`
      );
    }

    // Fetch user's Hotmail/Outlook profile
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData = await meRes.json().catch(() => ({}));
    const emailAddress = String(meData.mail || meData.userPrincipalName || '').trim().toLowerCase();
    const displayName = String(meData.displayName || emailAddress).trim();

    if (!emailAddress) {
      return redirectBack('error', 'Signed in to Microsoft, but could not read email address.');
    }

    const sb = supabaseAdmin || supabase;
    if (!sb) return redirectBack('error', 'Supabase is not configured.');

    const accountId = makeEmailAccountId('microsoft', emailAddress);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + Number(tokenData.expires_in || 3500) * 1000).toISOString();

    const row: Partial<EmailAccountRow> & Record<string, unknown> = {
      id: accountId,
      provider: 'microsoft',
      email_address: emailAddress,
      display_name: displayName,
      account_label: defaultAccountLabel('microsoft', emailAddress),
      oauth_refresh_token: tokenData.refresh_token,
      oauth_access_token: tokenData.access_token,
      oauth_expires_at: expiresAt,
      permission_mode: 'full_send',
      is_active: true,
      last_error: null,
      updated_at: nowIso,
    };

    const { error: upsertErr } = await sb.from('email_accounts').upsert(row, { onConflict: 'id' });
    if (upsertErr) {
      return redirectBack('error', upsertErr.message);
    }

    // Initial sync in background/immediate
    await syncMicrosoftAccount(
      {
        ...(row as EmailAccountRow),
        provider_account_id: null,
        identity_id: null,
        folders_json: [],
        auto_send_allowed: false,
        auto_delete_allowed: false,
        last_sync_at: null,
        last_sync_device: null,
      },
      40
    ).catch(() => {});

    return redirectBack('connected', emailAddress);
  } catch (err: unknown) {
    return redirectBack('error', err instanceof Error ? err.message : 'Microsoft OAuth failed');
  }
}
