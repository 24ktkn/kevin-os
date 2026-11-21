import { NextRequest, NextResponse } from 'next/server';
import {
  MCP_SCOPE,
  getMcpCorsHeaders,
  issueTokenPair,
  mcpCorsPreflight,
  verifyAuthorizationCode,
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

  // Also extract client_id from HTTP Basic auth if present
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('basic ') && !params.client_id) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep > 0) {
        params.client_id = decodeURIComponent(decoded.slice(0, sep));
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
      const codeVerifier = params.code_verifier || '';

      const payload = verifyAuthorizationCode(code);
      if (!payload) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (payload.redirect_uri && redirectUri && payload.redirect_uri !== redirectUri) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'redirect_uri mismatch.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (payload.client_id && clientId && payload.client_id !== clientId) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'client_id mismatch.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      if (payload.code_challenge) {
        const method = (payload.code_challenge_method || 'S256').toUpperCase();
        const pkceOk =
          method === 'S256'
            ? verifyPkceS256(codeVerifier, payload.code_challenge)
            : Boolean(codeVerifier && codeVerifier === payload.code_challenge);
        if (!pkceOk) {
          return NextResponse.json(
            { error: 'invalid_grant', error_description: 'PKCE code_verifier verification failed.' },
            { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
          );
        }
      }

      const tokenResponse = issueTokenPair({
        clientId: payload.client_id || clientId || 'gemini',
        scope: payload.scope || MCP_SCOPE,
        resource: params.resource || payload.resource,
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
      const parsed = verifyRefreshToken(refreshToken);
      if (!parsed) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' },
          { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
        );
      }

      const tokenResponse = issueTokenPair({
        clientId: parsed.cid || params.client_id || 'gemini',
        scope: parsed.scope || MCP_SCOPE,
        resource: params.resource || parsed.aud,
      });

      return NextResponse.json(tokenResponse, {
        status: 200,
        headers: getMcpCorsHeaders({
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        }),
      });
    }

    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}` },
      { status: 400, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Token endpoint error';
    return NextResponse.json(
      { error: 'server_error', error_description: msg },
      { status: 500, headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }) }
    );
  }
}

export async function OPTIONS() {
  return mcpCorsPreflight();
}
