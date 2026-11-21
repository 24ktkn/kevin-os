<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Kevin-OS MCP Server Maintenance
- The remote StreamableHTTP MCP server exposed to Google Gemini lives in `src/app/mcp/route.ts`, backed by shared tool implementations in `src/lib/kevin-os-tools.ts` and OAuth 2.1 + PKCE auth in `src/lib/mcp-auth.ts`.
- Whenever a new feature, data module, or Supabase table is added to Kevin-OS, add corresponding read/write tools in `src/lib/kevin-os-tools.ts` and register them in `src/app/mcp/route.ts` (and add safe public tables to `KNOWN_SAFE_TABLES`) so Gemini automatically gains access to new capabilities.

