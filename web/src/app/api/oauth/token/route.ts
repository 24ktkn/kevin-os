import { NextRequest, NextResponse } from 'next/server';
import {
  MCP_SCOPE,
  getMcpCorsHeaders,
  issueTokenPair,
  mcpCorsPreflight,
  recordMcpTrace,
  shortHash,
  verifyAuthorizationCode,
  verifyClientSecretIfApplicable,
  verifyPkceS256,
  verifyRefreshToken,
} from '@/lib/mcp-auth';

export const dynamic = 'force-dynamic';

async function parseTokenRequestParams(req: NextRequest): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  const contentType = (req.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(json)) {
      if (v !== undefined && v !== null) params[k] = String(v);
    }
  } else {
    const text = await req.text();
    const usp = new URLSearchParams(text);
    for (const [k, v] of usp.entries()) {
      params[k] = v;
    }
  }

  // Extract client_id and client_secret from HTTP Basic auth if present (RFC 6749 section 2.3.1)
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep > 0) {
        const basicId = decodeURIComponent(decoded.slice(0, sep).replace(/\+/g, ' '));
        const basicSecret = decodeURIComponent(decoded.slice(sep + 1).replace(/\+/g, ' '));
        if (!params.client_id && basicId) params.client_id = basicId;
        if (!params.client_secret && basicSecret) params.client_secret = basicSecret;
      }
    } catch {
      // ignore malformed basic header
    }
  }

  return params;
}

export async function POST(req: NextRequest) {
  try {
    const params = await parseTokenRequestParams(req);
    const grantType = params.grant_type || '';

    if (grantType === 'authorization_code') {
      const code = params.code || '';
      const redirectUri = params.redirect_uri || '';
      const clientId = params.client_id || '';
      const clientSecret = params.client_secret || '';
      const codeVerifier = params.code_verifier || '';

      const payload = verifyAuthorizationCode(code);
      if (!payload) {
        await recordMcpTrace('oauth_token_bad_code', 400, { codeLen: code.length });
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (payload.rh && redirectUri && shortHash(redirectUri) !== payload.rh) {
        await recordMcpTrace('oauth_token_redirect_mismatch', 400, {});
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'redirect_uri mismatch.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (payload.ci && clientId && shortHash(clientId) !== payload.ci) {
        await recordMcpTrace('oauth_token_client_mismatch', 400, {});
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'client_id mismatch.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (clientSecret && !verifyClientSecretIfApplicable(clientId, clientSecret)) {
        await recordMcpTrace('oauth_token_bad_secret', 401, {});
        return NextResponse.json(
          { error: 'invalid_client', error_description: 'Invalid client_secret.' },
          { status: 401, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (payload.ch) {
        const method = (payload.cm || 'S256').toUpperCase();
        const pkceOk =
          method === 'S256'
            ? verifyPkceS256(codeVerifier, payload.ch)
            : Boolean(codeVerifier && codeVerifier === payload.ch);
        if (!pkceOk) {
          await recordMcpTrace('oauth_token_pkce_failed', 400, {
            method,
            hasVerifier: Boolean(codeVerifier),
          });
          return NextResponse.json(
            { error: 'invalid_grant', error_description: 'PKCE code_verifier verification failed.' },
            { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
          );
        }
      }

      const tokenResponse = issueTokenPair({
        clientId: clientId || 'gemini',
        scope: payload.sc || MCP_SCOPE,
      });

      await recordMcpTrace('oauth_token_issued', 200, {
        grantType,
        hasSecret: Boolean(clientSecret),
        hasVerifier: Boolean(codeVerifier),
      });

      return NextResponse.json(tokenResponse, {
        status: 200,
        headers: getMcpCorsHeaders({
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        }),
      });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = params.refresh_token || '';
      const clientId = params.client_id || '';
      const clientSecret = params.client_secret || '';
      const parsed = verifyRefreshToken(refreshToken);

      if (!parsed) {
        await recordMcpTrace('oauth_refresh_invalid', 400, {});
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (clientSecret && !verifyClientSecretIfApplicable(clientId, clientSecret)) {
        await recordMcpTrace('oauth_refresh_bad_secret', 401, {});
        return NextResponse.json(
          { error: 'invalid_client', error_description: 'Invalid client_secret.' },
          { status: 401, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      const tokenResponse = issueTokenPair({
        clientId: clientId || 'gemini',
        scope: parsed.sc || MCP_SCOPE,
      });

      await recordMcpTrace('oauth_token_refreshed', 200, {});

      return NextResponse.json(tokenResponse, {
        status: 200,
        headers: getMcpCorsHeaders({
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        }),
      });
    }

    await recordMcpTrace('oauth_token_unsupported_grant', 400, { grantType });
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}` },
      { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Token endpoint error';
    await recordMcpTrace('oauth_token_error', 500, { error: msg });
    return NextResponse.json(
      { error: 'server_error', error_description: msg },
      { status: 500, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
    );
  }
}

export async function OPTIONS() {
  return mcpCorsPreflight();
}
