import { NextRequest, NextResponse } from 'next/server';
import {
  createDynamicClientCredentials,
  getMcpCorsHeaders,
  mcpCorsPreflight,
  recordMcpTrace,
} from '@/lib/mcp-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      client_name?: string;
      redirect_uris?: unknown;
      grant_types?: string[];
      response_types?: string[];
      token_endpoint_auth_method?: string;
      scope?: string;
    };

    const clientName =
      typeof body.client_name === 'string' && body.client_name.trim()
        ? body.client_name.trim().slice(0, 80)
        : 'MCP Client';

    const rawRedirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const validRedirectUris: string[] = [];

    for (const raw of rawRedirectUris) {
      if (typeof raw !== 'string') continue;
      try {
        const parsed = new URL(raw);
        const isLocal =
          parsed.protocol === 'http:' &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
        if (parsed.protocol === 'https:' || isLocal) {
          validRedirectUris.push(raw);
        }
      } catch {
        // ignore invalid redirect URI
      }
    }

    const { clientId, clientSecret } = createDynamicClientCredentials();
    const requestedAuthMethod =
      typeof body.token_endpoint_auth_method === 'string' && body.token_endpoint_auth_method.trim()
        ? body.token_endpoint_auth_method.trim()
        : 'client_secret_post';

    const isPublicClient = requestedAuthMethod === 'none';

    const responsePayload: Record<string, unknown> = {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: validRedirectUris,
      grant_types: Array.isArray(body.grant_types) && body.grant_types.length > 0
        ? body.grant_types
        : ['authorization_code', 'refresh_token'],
      response_types: Array.isArray(body.response_types) && body.response_types.length > 0
        ? body.response_types
        : ['code'],
      token_endpoint_auth_method: requestedAuthMethod,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };

    if (!isPublicClient) {
      responsePayload.client_secret = clientSecret;
      responsePayload.client_secret_expires_at = 0;
    }

    await recordMcpTrace('oauth_register', 201, {
      clientName,
      authMethod: requestedAuthMethod,
      redirectCount: validRedirectUris.length,
      redirectHosts: validRedirectUris.map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return 'invalid';
        }
      }),
    });

    return NextResponse.json(responsePayload, {
      status: 201,
      headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Registration error';
    await recordMcpTrace('oauth_register_error', 400, { error: msg });
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: msg },
      { status: 400, headers: getMcpCorsHeaders() }
    );
  }
}

export async function OPTIONS() {
  return mcpCorsPreflight();
}
