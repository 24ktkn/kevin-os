import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const MCP_SCOPE = 'kevin-os';
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
export const AUTH_CODE_TTL_SECONDS = 5 * 60; // 5 minutes

export function getPublicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const host = (forwardedHost || req.headers.get('host') || '').split(',')[0].trim();
  const forwardedProto = (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim();

  if (host) {
    const isLocal =
      host.startsWith('localhost') ||
      host.startsWith('127.0.0.1') ||
      host.startsWith('[::1]');
    const proto = forwardedProto || (isLocal ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  return req.nextUrl.origin;
}

export function getMcpCorsHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Accept',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version',
    ...extra,
  };
}

export function withMcpCors(res: Response, extra?: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(getMcpCorsHeaders(extra))) {
    headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function mcpCorsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: getMcpCorsHeaders(),
  });
}

function getSigningKey(): Buffer {
  const raw =
    process.env.KEVIN_OS_MCP_SECRET ||
    process.env.KEVIN_OS_MCP_PASSCODE ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'kevin-os-local-dev-mcp-key';
  return crypto.createHash('sha256').update(`kevin-os-mcp-v1:${raw}`).digest();
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function signPayload(purpose: string, payload: Record<string, unknown>): string {
  const body = base64UrlEncode(JSON.stringify({ ...payload, typ: purpose }));
  const sig = base64UrlEncode(crypto.createHmac('sha256', getSigningKey()).update(body).digest());
  return `${body}.${sig}`;
}

function verifySignedPayload<T extends Record<string, unknown>>(
  token: string,
  expectedPurpose: string
): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, providedSig] = parts;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', getSigningKey()).update(body).digest()
    );
    const a = Buffer.from(providedSig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const parsed = JSON.parse(base64UrlDecode(body).toString('utf8')) as T & {
      typ?: string;
      exp?: number;
    };
    if (parsed.typ !== expectedPurpose) return null;
    if (typeof parsed.exp === 'number' && Math.floor(Date.now() / 1000) > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getConfiguredPasscode(): string {
  return (process.env.KEVIN_OS_MCP_PASSCODE || '').trim();
}

export function verifyPasscode(candidate: string): { ok: boolean; configured: boolean } {
  const configured = getConfiguredPasscode();
  if (!configured) {
    return { ok: false, configured: false };
  }
  const a = Buffer.from(candidate.trim(), 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length) return { ok: false, configured: true };
  return { ok: crypto.timingSafeEqual(a, b), configured: true };
}

export interface DynamicClientRecord {
  client_name: string;
  redirect_uris: string[];
  iat: number;
}

export function createDynamicClientId(clientName: string, redirectUris: string[]): string {
  const signed = signPayload('dcr', {
    client_name: clientName.slice(0, 80),
    redirect_uris: redirectUris.slice(0, 10),
    iat: Math.floor(Date.now() / 1000),
  });
  return `kos_dcr_${signed}`;
}

export function parseDynamicClientId(clientId: string): DynamicClientRecord | null {
  if (!clientId.startsWith('kos_dcr_')) return null;
  const raw = clientId.slice('kos_dcr_'.length);
  const parsed = verifySignedPayload<DynamicClientRecord & Record<string, unknown>>(raw, 'dcr');
  if (!parsed || !Array.isArray(parsed.redirect_uris)) return null;
  return {
    client_name: String(parsed.client_name || 'MCP Client'),
    redirect_uris: parsed.redirect_uris.map(String),
    iat: Number(parsed.iat || 0),
  };
}

export function isAllowedRedirectUri(uri: string, clientId?: string): boolean {
  try {
    const parsed = new URL(uri);
    const isLocalhost =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

    if (parsed.protocol !== 'https:' && !isLocalhost) {
      return false;
    }

    // If client was dynamically registered, enforce its registered redirect_uris
    if (clientId) {
      const dcr = parseDynamicClientId(clientId);
      if (dcr && dcr.redirect_uris.length > 0) {
        return dcr.redirect_uris.includes(uri);
      }
    }

    // Allow localhost for testing and trusted HTTPS OAuth callback hosts (Google Gemini, Claude, ChatGPT, etc.)
    if (isLocalhost) return true;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.googleapis.com') ||
      host === 'claude.ai' ||
      host.endsWith('.claude.ai') ||
      host === 'chatgpt.com' ||
      host.endsWith('.openai.com')
    );
  } catch {
    return false;
  }
}

export interface AuthCodePayload {
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope: string;
  resource?: string;
  exp: number;
  [key: string]: unknown;
}

export function createAuthorizationCode(params: Omit<AuthCodePayload, 'exp'>): string {
  return signPayload('code', {
    ...params,
    exp: Math.floor(Date.now() / 1000) + AUTH_CODE_TTL_SECONDS,
  });
}

export function verifyAuthorizationCode(code: string): AuthCodePayload | null {
  return verifySignedPayload<AuthCodePayload>(code, 'code');
}

export function verifyPkceS256(codeVerifier: string, expectedChallenge: string): boolean {
  if (!codeVerifier || !expectedChallenge) return false;
  const computed = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(expectedChallenge, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function issueTokenPair(params: {
  clientId: string;
  scope: string;
  resource?: string;
}): {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
} {
  const nowSec = Math.floor(Date.now() / 1000);
  const accessToken = signPayload('access', {
    sub: 'kevin',
    cid: params.clientId,
    scope: params.scope || MCP_SCOPE,
    aud: params.resource || '',
    iat: nowSec,
    exp: nowSec + ACCESS_TOKEN_TTL_SECONDS,
  });

  const refreshToken = signPayload('refresh', {
    sub: 'kevin',
    cid: params.clientId,
    scope: params.scope || MCP_SCOPE,
    aud: params.resource || '',
    iat: nowSec,
    exp: nowSec + REFRESH_TOKEN_TTL_SECONDS,
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: params.scope || MCP_SCOPE,
  };
}

export function verifyRefreshToken(
  token: string
): { sub: string; cid: string; scope: string; aud?: string } | null {
  return verifySignedPayload<{ sub: string; cid: string; scope: string; aud?: string }>(
    token,
    'refresh'
  );
}

export function verifyBearerRequest(req: NextRequest): {
  authorized: boolean;
  subject?: string;
  scope?: string;
} {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { authorized: false };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { authorized: false };

  // 1. Optional direct static Bearer token (for Apple Shortcuts / personal scripts)
  const staticToken = (process.env.KEVIN_OS_MCP_BEARER_TOKEN || '').trim();
  if (staticToken) {
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(staticToken, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { authorized: true, subject: 'kevin', scope: MCP_SCOPE };
    }
  }

  // 2. OAuth 2.1 signed access token
  const parsed = verifySignedPayload<{ sub?: string; scope?: string }>(token, 'access');
  if (parsed && parsed.sub === 'kevin') {
    return { authorized: true, subject: parsed.sub, scope: parsed.scope || MCP_SCOPE };
  }

  return { authorized: false };
}

export function buildProtectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Kevin-OS',
  };
}

export function buildAuthorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [MCP_SCOPE],
  };
}

export function buildUnauthorizedMcpResponse(req: NextRequest): NextResponse {
  const origin = getPublicOrigin(req);
  const resourceMetaUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
  return NextResponse.json(
    {
      error: 'unauthorized',
      error_description: 'Authentication required. Complete OAuth 2.1 sign-in to connect Kevin-OS.',
    },
    {
      status: 401,
      headers: getMcpCorsHeaders({
        'WWW-Authenticate': `Bearer realm="kevin-os", resource_metadata="${resourceMetaUrl}", scope="${MCP_SCOPE}"`,
      }),
    }
  );
}
