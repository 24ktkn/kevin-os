import { NextRequest } from 'next/server';
import {
  MCP_SCOPE,
  createAuthorizationCode,
  getConfiguredPasscode,
  isAllowedRedirectUri,
  recordMcpTrace,
  verifyPasscode,
} from '@/lib/mcp-auth';

export const dynamic = 'force-dynamic';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderConsentPage(params: {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  errorMessage?: string;
  passcodeMissing?: boolean;
}) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize Kevin-OS MCP</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #0a0a0d;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: #14141b;
      border: 1px solid #27272a;
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #a855f7;
      background: rgba(168, 85, 247, 0.14);
      border: 1px solid rgba(168, 85, 247, 0.35);
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 14px;
    }
    h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.25; }
    p { margin: 0 0 18px; font-size: 13.5px; line-height: 1.5; color: #a1a1aa; }
    .perms {
      background: #0f0f15;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 18px;
      font-size: 12.5px;
      color: #d4d4d8;
    }
    .perms ul { margin: 6px 0 0; padding-left: 18px; line-height: 1.65; }
    label { display: block; font-size: 12px; font-weight: 600; color: #d4d4d8; margin-bottom: 6px; }
    input[type="password"] {
      width: 100%;
      padding: 11px 13px;
      border-radius: 10px;
      border: 1px solid #3f3f46;
      background: #0a0a0d;
      color: #ffffff;
      font-size: 14px;
      margin-bottom: 14px;
      outline: none;
    }
    input[type="password"]:focus { border-color: #a855f7; }
    .error {
      background: rgba(239, 68, 68, 0.14);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12.5px;
      margin-bottom: 14px;
    }
    .actions { display: flex; gap: 10px; }
    button {
      flex: 1;
      padding: 11px 16px;
      border-radius: 10px;
      border: none;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
    }
    .approve { background: linear-gradient(135deg, #9333ea, #4f46e5); color: #ffffff; }
    .deny { background: #27272a; color: #d4d4d8; }
    .meta { margin-top: 14px; font-size: 11px; color: #71717a; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Kevin-OS MCP OAuth</div>
    <h1>Connect ${escapeHtml(params.clientName)}</h1>
    <p>Authorize this AI client to read your Kevin-OS data and schedule/update items across your connected Google Calendar, Google Tasks, and Supabase workspace.</p>
    <div class="perms">
      <strong>Access granted:</strong>
      <ul>
        <li>Tasks, Google Calendar timeblocks &amp; Schulich Elentra classes</li>
        <li>School online modules (preview &amp; auto-schedule weeks)</li>
        <li>Health biometrics, sleep trends, habits &amp; workouts</li>
        <li>Daily journal entries &amp; meal/Costco grocery checklists</li>
      </ul>
    </div>
    ${params.errorMessage ? `<div class="error">${escapeHtml(params.errorMessage)}</div>` : ''}
    ${
      params.passcodeMissing
        ? `<div class="error">Server setup required: add <code>KEVIN_OS_MCP_PASSCODE</code> in your Vercel Project Environment Variables and redeploy before authorizing.</div>`
        : ''
    }
    <form method="POST" action="/api/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.codeChallengeMethod)}" />
      <input type="hidden" name="scope" value="${escapeHtml(params.scope)}" />
      <label for="passcode">Kevin-OS Passcode</label>
      <input id="passcode" name="passcode" type="password" autocomplete="current-password" placeholder="Enter your KEVIN_OS_MCP_PASSCODE" required autofocus />
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="deny" formnovalidate>Cancel</button>
        <button type="submit" name="decision" value="approve" class="approve">Approve &amp; Connect</button>
      </div>
    </form>
    <div class="meta">Redirecting back to: ${escapeHtml(params.redirectUri)}</div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const responseType = sp.get('response_type') || 'code';
  const clientId = sp.get('client_id') || '';
  const redirectUri = sp.get('redirect_uri') || '';
  const state = sp.get('state') || '';
  const codeChallenge = sp.get('code_challenge') || '';
  const codeChallengeMethod = sp.get('code_challenge_method') || 'S256';
  const scope = sp.get('scope') || MCP_SCOPE;

  let redirectHost = '';
  try {
    redirectHost = new URL(redirectUri).hostname;
  } catch {
    redirectHost = 'invalid';
  }

  if (responseType !== 'code') {
    await recordMcpTrace('oauth_authorize_get_bad_type', 400, { responseType });
    return new Response('Unsupported response_type. Expected "code".', { status: 400 });
  }

  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    await recordMcpTrace('oauth_authorize_get_bad_redirect', 400, { redirectHost });
    return new Response('Invalid or disallowed redirect_uri.', { status: 400 });
  }

  await recordMcpTrace('oauth_authorize_get', 200, {
    redirectHost,
    hasState: Boolean(state),
    hasChallenge: Boolean(codeChallenge),
    clientIdLen: clientId.length,
    scope,
  });

  return renderConsentPage({
    clientId,
    clientName: 'Google Gemini',
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod,
    scope,
    passcodeMissing: !getConfiguredPasscode(),
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const decision = String(form.get('decision') || 'approve');
  const clientId = String(form.get('client_id') || '');
  const redirectUri = String(form.get('redirect_uri') || '');
  const state = String(form.get('state') || '');
  const codeChallenge = String(form.get('code_challenge') || '');
  const codeChallengeMethod = String(form.get('code_challenge_method') || 'S256');
  const scope = String(form.get('scope') || MCP_SCOPE);
  const passcode = String(form.get('passcode') || '');

  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    await recordMcpTrace('oauth_authorize_post_bad_redirect', 400, {});
    return new Response('Invalid or disallowed redirect_uri.', { status: 400 });
  }

  const target = new URL(redirectUri);

  if (decision === 'deny') {
    target.searchParams.set('error', 'access_denied');
    target.searchParams.set('error_description', 'User cancelled Kevin-OS authorization.');
    if (state) target.searchParams.set('state', state);
    await recordMcpTrace('oauth_authorize_denied', 302, {});
    return Response.redirect(target.toString(), 302);
  }

  const check = verifyPasscode(passcode);

  if (!check.configured) {
    await recordMcpTrace('oauth_authorize_no_passcode_env', 200, {});
    return renderConsentPage({
      clientId,
      clientName: 'Google Gemini',
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      scope,
      passcodeMissing: true,
    });
  }

  if (!check.ok) {
    await recordMcpTrace('oauth_authorize_wrong_passcode', 200, {});
    return renderConsentPage({
      clientId,
      clientName: 'Google Gemini',
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      scope,
      errorMessage: 'Incorrect passcode. Please try again.',
    });
  }

  const code = createAuthorizationCode({
    clientId,
    redirectUri,
    codeChallenge: codeChallenge || undefined,
    codeChallengeMethod: codeChallengeMethod || undefined,
    scope,
  });

  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);

  await recordMcpTrace('oauth_authorize_approved', 302, {
    redirectHost: target.hostname,
    codeLen: code.length,
    hasState: Boolean(state),
  });

  return Response.redirect(target.toString(), 302);
}
