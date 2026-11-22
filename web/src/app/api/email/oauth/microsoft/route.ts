import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getEmailOAuthConfig } from '@/lib/email-providers';

export const dynamic = 'force-dynamic';

const MS_SCOPES = 'offline_access User.Read Mail.ReadWrite Mail.Send';

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function GET(req: NextRequest) {
  const config = await getEmailOAuthConfig();
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/email/oauth/microsoft/callback`;

  if (!config.microsoft_client_id) {
    return NextResponse.json({
      configured: false,
      authUrl: '',
      redirectUri,
      error: 'Add your free Microsoft Azure App Client ID in Email Settings first.',
    });
  }

  const state = base64Url(crypto.randomBytes(16));
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  const params = new URLSearchParams({
    client_id: config.microsoft_client_id,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params.toString()}`;
  const res = NextResponse.json({
    configured: true,
    authUrl,
    redirectUri,
  });

  res.cookies.set('kevin_os_ms_pkce', JSON.stringify({ state, codeVerifier, redirectUri }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
    path: '/',
    maxAge: 900,
  });

  return res;
}
