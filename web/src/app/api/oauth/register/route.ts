import { NextRequest, NextResponse } from 'next/server';
import {
  createDynamicClientId,
  getMcpCorsHeaders,
  mcpCorsPreflight,
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

    if (validRedirectUris.length === 0) {
      return NextResponse.json(
        { error: 'invalid_redirect_uri', error_description: 'At least one valid redirect_uri is required.' },
        { status: 400, headers: getMcpCorsHeaders() }
      );
    }

    const clientId = createDynamicClientId(clientName, validRedirectUris);

    return NextResponse.json(
      {
        client_id: clientId,
        client_name: clientName,
        redirect_uris: validRedirectUris,
        grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
        response_types: body.response_types || ['code'],
        token_endpoint_auth_method: 'none',
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      {
        status: 201,
        headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }),
      }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Registration error';
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: msg },
      { status: 400, headers: getMcpCorsHeaders() }
    );
  }
}

export async function OPTIONS() {
  return mcpCorsPreflight();
}
