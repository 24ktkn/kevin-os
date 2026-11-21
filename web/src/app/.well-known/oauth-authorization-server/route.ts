import { NextRequest, NextResponse } from 'next/server';
import {
  buildAuthorizationServerMetadata,
  getMcpCorsHeaders,
  getPublicOrigin,
  mcpCorsPreflight,
} from '@/lib/mcp-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const origin = getPublicOrigin(req);
  return NextResponse.json(buildAuthorizationServerMetadata(origin), {
    headers: getMcpCorsHeaders({ 'Cache-Control': 'no-store' }),
  });
}

export async function OPTIONS() {
  return mcpCorsPreflight();
}
