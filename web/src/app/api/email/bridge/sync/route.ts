import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { computeAnkiBridgeToken } from '@/lib/anki-utils';
import { makeEmailAccountId, makeEmailMessageId } from '@/lib/email-providers';
import { defaultAccountLabel, isMissingEmailTableError } from '@/lib/email-hub';
import { EmailFolderRef, EmailFolderType } from '@/types/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Anki-Bridge-Token, X-Email-Bridge-Token',
};

function verifyBridgeToken(req: NextRequest): boolean {
  const token =
    req.headers.get('x-email-bridge-token')?.trim() ||
    req.headers.get('x-anki-bridge-token')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  if (!token) return false;

  const expected = computeAnkiBridgeToken();
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface IncomingTbAccount {
  providerAccountId: string;
  emailAddress: string;
  displayName?: string;
  identityId?: string;
  folders?: EmailFolderRef[];
  activeProviderMessageIds?: string[];
}

interface IncomingTbMessage {
  accountEmail: string;
  providerMessageId: string;
  threadId?: string | null;
  folderId?: string | null;
  folderName?: string;
  folderType?: EmailFolderType;
  subject?: string;
  fromName?: string;
  fromEmail?: string;
  toList?: string[];
  ccList?: string[];
  dateIso?: string;
  snippet?: string;
  bodyText?: string;
  isRead?: boolean;
  isStarred?: boolean;
  hasAttachments?: boolean;
  labels?: string[];
}

interface IncomingActionResult {
  actionId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export async function POST(req: NextRequest) {
  if (!verifyBridgeToken(req)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized bridge token.' },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  try {
    const sb = supabaseAdmin || supabase;
    if (!sb) {
      return NextResponse.json(
        { success: false, error: 'Supabase not configured' },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const body = (await req.json()) as {
      deviceName?: string;
      accounts?: IncomingTbAccount[];
      messages?: IncomingTbMessage[];
      actionResults?: IncomingActionResult[];
    };

    const deviceName = (body.deviceName || 'thunderbird-bridge').slice(0, 80);
    const nowIso = new Date().toISOString();
    const accountEmailToId = new Map<string, string>();
    let accountsUpserted = 0;
    let messagesUpserted = 0;
    let messagesPruned = 0;

    // 1. Upsert Thunderbird accounts without clobbering Kevin's safety toggles/labels
    if (Array.isArray(body.accounts) && body.accounts.length > 0) {
      const { data: existingRows, error: exErr } = await sb
        .from('email_accounts')
        .select('id, email_address, account_label, permission_mode, auto_send_allowed, auto_delete_allowed')
        .eq('provider', 'thunderbird');

      if (exErr && isMissingEmailTableError(exErr)) {
        return NextResponse.json(
          { success: false, needsMigration: true, error: 'Run add_email_hub_tables.sql in Supabase first.' },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const existingMap = new Map(
        (existingRows || []).map((r) => [String(r.email_address).toLowerCase(), r])
      );

      for (const acc of body.accounts) {
        const email = String(acc.emailAddress || '').trim().toLowerCase();
        if (!email || !email.includes('@')) continue;

        const id = makeEmailAccountId('thunderbird', email);
        accountEmailToId.set(email, id);
        const prev = existingMap.get(email);

        await sb.from('email_accounts').upsert(
          {
            id,
            provider: 'thunderbird',
            email_address: email,
            display_name: acc.displayName || email,
            account_label: prev?.account_label || defaultAccountLabel('thunderbird', email),
            provider_account_id: acc.providerAccountId || null,
            identity_id: acc.identityId || null,
            folders_json: Array.isArray(acc.folders) ? acc.folders : [],
            permission_mode: prev?.permission_mode || 'full_send',
            auto_send_allowed: prev?.auto_send_allowed ?? false,
            auto_delete_allowed: prev?.auto_delete_allowed ?? false,
            is_active: true,
            last_sync_at: nowIso,
            last_sync_device: deviceName,
            last_error: null,
            updated_at: nowIso,
          },
          { onConflict: 'id' }
        );
        accountsUpserted += 1;

        // Prune deleted messages no longer present in Thunderbird sync snapshot
        if (Array.isArray(acc.activeProviderMessageIds) && acc.activeProviderMessageIds.length > 0) {
          const activeSet = new Set(acc.activeProviderMessageIds.map(String));
          const { data: cachedIds } = await sb
            .from('email_messages')
            .select('id, provider_message_id')
            .eq('account_id', id)
            .limit(1000);

          const toDelete = (cachedIds || [])
            .filter((row) => !activeSet.has(String(row.provider_message_id)))
            .map((row) => String(row.id));

          if (toDelete.length > 0) {
            for (let i = 0; i < toDelete.length; i += 200) {
              await sb.from('email_messages').delete().in('id', toDelete.slice(i, i + 200));
            }
            messagesPruned += toDelete.length;
          }
        }
      }
    }

    // 2. Upsert mirrored Thunderbird messages
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      const rows = body.messages
        .map((m) => {
          const email = String(m.accountEmail || '').trim().toLowerCase();
          const accountId = accountEmailToId.get(email) || makeEmailAccountId('thunderbird', email);
          const provId = String(m.providerMessageId || '').trim();
          if (!email || !provId) return null;
          return {
            id: makeEmailMessageId('thunderbird', email, provId),
            account_id: accountId,
            provider: 'thunderbird' as const,
            account_email: email,
            provider_message_id: provId,
            thread_id: m.threadId || null,
            folder_id: m.folderId || null,
            folder_name: m.folderName || 'Inbox',
            folder_type: m.folderType || 'inbox',
            subject: m.subject || '(No Subject)',
            from_name: m.fromName || m.fromEmail || '',
            from_email: m.fromEmail || '',
            to_list: Array.isArray(m.toList) ? m.toList : [],
            cc_list: Array.isArray(m.ccList) ? m.ccList : [],
            date_iso: m.dateIso || nowIso,
            snippet: (m.snippet || (m.bodyText || '').slice(0, 220)).trim(),
            body_text: (m.bodyText || m.snippet || '').slice(0, 16000),
            is_read: Boolean(m.isRead),
            is_starred: Boolean(m.isStarred),
            has_attachments: Boolean(m.hasAttachments),
            labels_json: Array.isArray(m.labels) ? m.labels : [],
            synced_at: nowIso,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error: msgErr } = await sb.from('email_messages').upsert(chunk, { onConflict: 'id' });
        if (!msgErr) messagesUpserted += chunk.length;
      }
    }

    // 3. Record results for previously claimed actions
    if (Array.isArray(body.actionResults) && body.actionResults.length > 0) {
      for (const r of body.actionResults) {
        if (!r.actionId) continue;
        await sb
          .from('email_actions')
          .update({
            status: r.success ? 'executed' : 'failed',
            result_json: r.result || null,
            error_message: r.success ? null : r.error || 'Thunderbird action failed',
            executed_at: r.success ? nowIso : null,
            updated_at: nowIso,
          })
          .eq('id', r.actionId);
      }
    }

    // 4. Reclaim stale claimed actions (>90s) and atomically claim queued Thunderbird actions
    const staleCutoff = new Date(Date.now() - 90_000).toISOString();
    await sb
      .from('email_actions')
      .update({ status: 'queued', device_claim_id: null, claimed_at: null, updated_at: nowIso })
      .eq('provider', 'thunderbird')
      .eq('status', 'claimed')
      .lt('claimed_at', staleCutoff);

    const claimId = `${deviceName}:${crypto.randomBytes(4).toString('hex')}`;
    const syncedAccountIds = Array.from(accountEmailToId.values());

    let candidateQuery = sb
      .from('email_actions')
      .select('*')
      .eq('provider', 'thunderbird')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(10);

    if (syncedAccountIds.length > 0) {
      candidateQuery = candidateQuery.in('account_id', syncedAccountIds);
    }

    const { data: candidates } = await candidateQuery;
    const claimedActions = [];

    for (const candidate of candidates || []) {
      const { data: claimed } = await sb
        .from('email_actions')
        .update({
          status: 'claimed',
          device_claim_id: claimId,
          claimed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', candidate.id)
        .eq('status', 'queued')
        .select('*')
        .maybeSingle();

      if (claimed) claimedActions.push(claimed);
    }

    return NextResponse.json(
      {
        success: true,
        accountsUpserted,
        messagesUpserted,
        messagesPruned,
        pendingActions: claimedActions,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Thunderbird bridge sync failed' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
