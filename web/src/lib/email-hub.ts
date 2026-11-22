import crypto from 'node:crypto';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { isMissingAnkiTableError } from '@/lib/anki-utils';
import {
  EmailAccountRow,
  executeGmailAction,
  executeMicrosoftAction,
  getEmailOAuthConfig,
  getGmailMessageFull,
  getGmailOAuthCredentials,
  getMicrosoftMessageFull,
  searchGmailLive,
  searchMicrosoftLive,
  syncGmailAccount,
  syncMicrosoftAccount,
} from '@/lib/email-providers';
import {
  EmailAccountPublic,
  EmailActionPayload,
  EmailActionRecord,
  EmailActionType,
  EmailFolderType,
  EmailMessageRecord,
  EmailSafetyConfigPublic,
} from '@/types/email';

export function isMissingEmailTableError(err: unknown): boolean {
  return isMissingAnkiTableError(err);
}

export function toPublicAccount(
  row: EmailAccountRow,
  stats?: { unreadCount: number; totalCached: number }
): EmailAccountPublic {
  return {
    id: row.id,
    provider: row.provider,
    email_address: row.email_address,
    display_name: row.display_name || row.email_address,
    account_label: row.account_label || defaultAccountLabel(row.provider, row.email_address),
    provider_account_id: row.provider_account_id,
    identity_id: row.identity_id,
    folders_json: Array.isArray(row.folders_json) ? row.folders_json : [],
    permission_mode: row.permission_mode,
    auto_send_allowed: Boolean(row.auto_send_allowed),
    auto_delete_allowed: Boolean(row.auto_delete_allowed),
    is_active: Boolean(row.is_active),
    last_sync_at: row.last_sync_at,
    last_sync_device: row.last_sync_device,
    last_error: row.last_error,
    unreadCount: stats?.unreadCount ?? 0,
    totalCached: stats?.totalCached ?? 0,
  };
}

export function defaultAccountLabel(provider: string, email: string): string {
  const lower = email.toLowerCase();
  if (lower.includes('uwo.ca')) return 'School (UWO)';
  if (lower.includes('queensu.ca')) return "Queen's";
  if (lower.includes('.edu')) return 'School';
  if (lower.includes('hotmail') || lower.includes('outlook') || lower.includes('live.com')) {
    return 'Hotmail / Outlook';
  }
  if (provider === 'gmail' || lower.includes('gmail')) return 'Gmail';
  if (provider === 'thunderbird') return 'Thunderbird';
  return 'Email';
}

export async function getAllEmailAccountRows(): Promise<{
  accounts: EmailAccountRow[];
  needsMigration: boolean;
}> {
  const sb = supabaseAdmin || supabase;
  if (!sb) return { accounts: [], needsMigration: false };

  const { data, error } = await sb
    .from('email_accounts')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingEmailTableError(error)) return { accounts: [], needsMigration: true };
    throw new Error(error.message);
  }

  return { accounts: (data || []) as EmailAccountRow[], needsMigration: false };
}

export async function getEmailAccountsWithCounts(): Promise<{
  accounts: EmailAccountPublic[];
  safetyConfig: EmailSafetyConfigPublic;
  needsMigration: boolean;
}> {
  const [{ accounts: rows, needsMigration }, oauthCfg] = await Promise.all([
    getAllEmailAccountRows(),
    getEmailOAuthConfig(),
  ]);

  const gmailCreds = getGmailOAuthCredentials();
  const safetyConfig: EmailSafetyConfigPublic = {
    microsoftConfigured: Boolean(oauthCfg.microsoft_client_id),
    microsoftClientIdPreview: oauthCfg.microsoft_client_id
      ? `${oauthCfg.microsoft_client_id.slice(0, 8)}...`
      : null,
    gmailConfigured: Boolean(gmailCreds.clientId && gmailCreds.clientSecret),
    require_approval_for_send: oauthCfg.require_approval_for_send,
    require_approval_for_delete: oauthCfg.require_approval_for_delete,
  };

  if (needsMigration) {
    return { accounts: [], safetyConfig, needsMigration: true };
  }

  const sb = supabaseAdmin || supabase;
  const countsMap = new Map<string, { unreadCount: number; totalCached: number }>();

  if (sb && rows.length > 0) {
    const { data: msgs } = await sb
      .from('email_messages')
      .select('account_id, is_read, folder_type')
      .limit(4000);

    for (const m of msgs || []) {
      const aid = String(m.account_id);
      const entry = countsMap.get(aid) || { unreadCount: 0, totalCached: 0 };
      entry.totalCached += 1;
      if (!m.is_read && m.folder_type === 'inbox') {
        entry.unreadCount += 1;
      }
      countsMap.set(aid, entry);
    }
  }

  return {
    accounts: rows.map((r) => toPublicAccount(r, countsMap.get(r.id))),
    safetyConfig,
    needsMigration: false,
  };
}

export async function resolveEmailAccount(
  hint?: string | null
): Promise<EmailAccountRow | null> {
  const { accounts } = await getAllEmailAccountRows();
  if (accounts.length === 0) return null;
  if (!hint || !hint.trim()) return accounts[0];

  const q = hint.trim().toLowerCase();

  // 1. Exact ID or email match
  const exact = accounts.find(
    (a) => a.id.toLowerCase() === q || a.email_address.toLowerCase() === q
  );
  if (exact) return exact;

  // 2. Partial email, label, or provider alias match ("school", "uwo", "hotmail", "outlook", "gmail")
  const alias = accounts.find((a) => {
    const email = a.email_address.toLowerCase();
    const label = (a.account_label || '').toLowerCase();
    const prov = a.provider.toLowerCase();
    if (email.includes(q) || label.includes(q) || prov === q) return true;
    if ((q === 'school' || q === 'western' || q === 'schulich' || q === 'uwo') && email.includes('uwo.ca')) {
      return true;
    }
    if ((q === 'hotmail' || q === 'outlook' || q === 'live') && prov === 'microsoft') {
      return true;
    }
    return false;
  });

  return alias || null;
}

export async function syncAllCloudAccounts(accountHint?: string): Promise<{
  results: Array<{
    accountId: string;
    email: string;
    provider: string;
    syncedCount: number;
    error?: string;
  }>;
}> {
  const { accounts } = await getAllEmailAccountRows();
  const targetAccounts = accountHint
    ? accounts.filter((a) => {
        const q = accountHint.toLowerCase();
        return (
          a.id.toLowerCase() === q ||
          a.email_address.toLowerCase().includes(q) ||
          a.provider === q ||
          (a.account_label || '').toLowerCase().includes(q)
        );
      })
    : accounts;

  const cloudAccounts = targetAccounts.filter(
    (a) => a.provider === 'gmail' || a.provider === 'microsoft'
  );

  const sb = supabaseAdmin || supabase;
  const results = await Promise.all(
    cloudAccounts.map(async (acc) => {
      try {
        const res =
          acc.provider === 'gmail'
            ? await syncGmailAccount(acc)
            : await syncMicrosoftAccount(acc);
        return {
          accountId: acc.id,
          email: acc.email_address,
          provider: acc.provider,
          syncedCount: res.syncedCount,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (sb) {
          await sb
            .from('email_accounts')
            .update({ last_error: errMsg, updated_at: new Date().toISOString() })
            .eq('id', acc.id);
        }
        return {
          accountId: acc.id,
          email: acc.email_address,
          provider: acc.provider,
          syncedCount: 0,
          error: errMsg,
        };
      }
    })
  );

  return { results };
}

export async function getUnifiedInbox(params?: {
  account?: string;
  folder?: EmailFolderType | 'all';
  unreadOnly?: boolean;
  query?: string;
  limit?: number;
  liveCloudSync?: boolean;
}): Promise<{
  accounts: EmailAccountPublic[];
  messages: EmailMessageRecord[];
  totalUnread: number;
  pendingApprovalCount: number;
  needsMigration: boolean;
}> {
  const limit = Math.min(200, Math.max(1, params?.limit || 30));

  if (params?.liveCloudSync) {
    await syncAllCloudAccounts(params.account).catch(() => {});
  }

  const { accounts, needsMigration } = await getEmailAccountsWithCounts();
  if (needsMigration) {
    return {
      accounts: [],
      messages: [],
      totalUnread: 0,
      pendingApprovalCount: 0,
      needsMigration: true,
    };
  }

  const sb = supabaseAdmin || supabase;
  if (!sb) {
    return {
      accounts,
      messages: [],
      totalUnread: 0,
      pendingApprovalCount: 0,
      needsMigration: false,
    };
  }

  let targetAccountId: string | null = null;
  if (params?.account && params.account !== 'all') {
    const resolved = await resolveEmailAccount(params.account);
    if (resolved) targetAccountId = resolved.id;
  }

  // If a search query is given AND liveCloudSync is requested, run live Gmail/Microsoft searches too
  if (params?.query && params.liveCloudSync) {
    const { accounts: rows } = await getAllEmailAccountRows();
    const cloudRows = rows.filter(
      (r) =>
        (r.provider === 'gmail' || r.provider === 'microsoft') &&
        (!targetAccountId || r.id === targetAccountId)
    );
    await Promise.all(
      cloudRows.map((acc) =>
        (acc.provider === 'gmail'
          ? searchGmailLive(acc, params.query!, Math.min(15, limit))
          : searchMicrosoftLive(acc, params.query!, Math.min(15, limit))
        ).catch(() => [])
      )
    );
  }

  let q = sb
    .from('email_messages')
    .select('*')
    .order('date_iso', { ascending: false })
    .limit(params?.query ? 250 : limit);

  if (targetAccountId) {
    q = q.eq('account_id', targetAccountId);
  }
  if (params?.folder && params.folder !== 'all') {
    q = q.eq('folder_type', params.folder);
  } else if (!params?.query) {
    // Default view hides trash/spam unless explicitly requested or searching
    q = q.not('folder_type', 'in', '("trash","spam")');
  }
  if (params?.unreadOnly) {
    q = q.eq('is_read', false);
  }

  const [{ data: msgRows }, { count: pendingCount }] = await Promise.all([
    q,
    sb
      .from('email_actions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval'),
  ]);

  let messages = (msgRows || []) as EmailMessageRecord[];

  if (params?.query && params.query.trim()) {
    const terms = params.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    messages = messages
      .filter((m) => {
        const hay = `${m.subject} ${m.from_name} ${m.from_email} ${m.snippet} ${m.body_text || ''} ${m.account_email}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, limit);
  }

  const totalUnread = accounts.reduce((acc, a) => acc + (a.unreadCount || 0), 0);

  return {
    accounts,
    messages,
    totalUnread,
    pendingApprovalCount: pendingCount || 0,
    needsMigration: false,
  };
}

export async function readUnifiedEmail(messageId: string): Promise<{
  message: EmailMessageRecord | null;
  threadMessages: EmailMessageRecord[];
}> {
  const sb = supabaseAdmin || supabase;
  if (!sb) return { message: null, threadMessages: [] };

  const { data: msg } = await sb
    .from('email_messages')
    .select('*')
    .or(`id.eq.${messageId},provider_message_id.eq.${messageId}`)
    .maybeSingle();

  let record = (msg as EmailMessageRecord | null) || null;

  // If cached record lacks full body and is a cloud account, fetch full body live
  if (record && (!record.body_text || record.body_text.length < 40)) {
    const { accounts } = await getAllEmailAccountRows();
    const acc = accounts.find((a) => a.id === record!.account_id);
    if (acc && acc.provider === 'gmail') {
      const full = await getGmailMessageFull(acc, record.provider_message_id).catch(() => null);
      if (full) record = full;
    } else if (acc && acc.provider === 'microsoft') {
      const full = await getMicrosoftMessageFull(acc, record.provider_message_id).catch(() => null);
      if (full) record = full;
    }
  }

  if (!record) return { message: null, threadMessages: [] };

  let threadMessages: EmailMessageRecord[] = [record];
  if (record.thread_id) {
    const { data: threadRows } = await sb
      .from('email_messages')
      .select('*')
      .eq('account_id', record.account_id)
      .eq('thread_id', record.thread_id)
      .order('date_iso', { ascending: true })
      .limit(20);
    if (threadRows && threadRows.length > 0) {
      threadMessages = threadRows as EmailMessageRecord[];
    }
  }

  return { message: record, threadMessages };
}

export async function proposeOrExecuteEmailAction(params: {
  accountHint?: string;
  actionType: EmailActionType;
  payload: EmailActionPayload;
  rationale?: string;
  source?: 'gemini_mcp' | 'kevin_os_ui';
  forceApproval?: boolean;
}): Promise<{
  action: EmailActionRecord;
  executedImmediately: boolean;
  requiresApproval: boolean;
  message: string;
}> {
  const sb = supabaseAdmin || supabase;
  if (!sb) throw new Error('Supabase is not configured.');

  const source = params.source || 'gemini_mcp';
  const payload: EmailActionPayload = { ...params.payload };

  // Resolve target messages first (which can also auto-identify the owning account!)
  let inferredAccountId: string | null = null;

  if (payload.replyToMessageId) {
    const { data: replyRow } = await sb
      .from('email_messages')
      .select('*')
      .or(`id.eq.${payload.replyToMessageId},provider_message_id.eq.${payload.replyToMessageId}`)
      .maybeSingle();
    if (replyRow) {
      const r = replyRow as EmailMessageRecord;
      inferredAccountId = r.account_id;
      payload.replyToMessageId = r.id;
      payload.replyToProviderMessageId = r.provider_message_id;
      payload.replyToThreadId = r.thread_id || undefined;
      if (!payload.to || payload.to.length === 0) {
        payload.to = r.from_email ? [r.from_email] : [];
      }
      if (!payload.subject) {
        payload.subject = /^re:/i.test(r.subject) ? r.subject : `Re: ${r.subject}`;
      }
    }
  }

  if (Array.isArray(payload.messageIds) && payload.messageIds.length > 0) {
    const { data: rows } = await sb
      .from('email_messages')
      .select('*')
      .in('id', payload.messageIds);
    const byId = (rows || []) as EmailMessageRecord[];

    // Also allow passing raw provider_message_ids
    let found = byId;
    if (found.length === 0) {
      const { data: byProv } = await sb
        .from('email_messages')
        .select('*')
        .in('provider_message_id', payload.messageIds);
      found = (byProv || []) as EmailMessageRecord[];
    }

    if (found.length > 0) {
      inferredAccountId = inferredAccountId || found[0].account_id;
      payload.messageIds = found.map((m) => m.id);
      payload.providerMessageIds = found.map((m) => m.provider_message_id);
      payload.messageSubjects = found.map((m) => `${m.subject} (${m.from_email})`);
    }
  }

  // Resolve the owning email account
  const { accounts } = await getAllEmailAccountRows();
  let account: EmailAccountRow | null = null;
  if (inferredAccountId) {
    account = accounts.find((a) => a.id === inferredAccountId) || null;
  }
  if (!account && params.accountHint) {
    account = await resolveEmailAccount(params.accountHint);
  }
  if (!account) {
    account = accounts[0] || null;
  }
  if (!account) {
    throw new Error(
      'No connected email accounts found. Connect Gmail, Hotmail, or Thunderbird (@uwo.ca) at /email first.'
    );
  }

  // Enforce per-account permission tier
  if (account.permission_mode === 'read') {
    throw new Error(
      `Account ${account.email_address} is set to Read-Only mode in Kevin-OS Email Settings.`
    );
  }
  const isSendAction = params.actionType === 'send' || params.actionType === 'reply_send';
  const isDeleteAction = params.actionType === 'delete';

  if (isSendAction && account.permission_mode !== 'full_send') {
    throw new Error(
      `Account ${account.email_address} is set to Draft/Triage-only mode. Use draft_email instead or change permission mode in /email.`
    );
  }

  // Safety Approval Check
  const oauthCfg = await getEmailOAuthConfig();
  let requiresApproval = Boolean(params.forceApproval);

  if (source === 'gemini_mcp') {
    if (isSendAction && (!account.auto_send_allowed || oauthCfg.require_approval_for_send && !account.auto_send_allowed)) {
      requiresApproval = true;
    }
    if (isDeleteAction && (!account.auto_delete_allowed || oauthCfg.require_approval_for_delete && !account.auto_delete_allowed)) {
      requiresApproval = true;
    }
  }

  // Note: If account explicitly enabled auto_send_allowed or auto_delete_allowed, let it run without approval!
  if (source === 'gemini_mcp' && !params.forceApproval) {
    if (isSendAction && account.auto_send_allowed) requiresApproval = false;
    if (isDeleteAction && account.auto_delete_allowed) requiresApproval = false;
  }

  const actionId = `ema_${crypto.randomBytes(8).toString('hex')}`;
  const nowIso = new Date().toISOString();
  const initialStatus = requiresApproval ? 'pending_approval' : 'queued';

  const rowToInsert: EmailActionRecord = {
    id: actionId,
    account_id: account.id,
    account_email: account.email_address,
    provider: account.provider,
    action_type: params.actionType,
    status: initialStatus,
    source,
    payload_json: payload,
    rationale: params.rationale || '',
    device_claim_id: null,
    claimed_at: null,
    result_json: null,
    error_message: null,
    created_at: nowIso,
    executed_at: null,
    updated_at: nowIso,
  };

  const { error: insertErr } = await sb.from('email_actions').insert(rowToInsert);
  if (insertErr) {
    throw new Error(`Could not save email action: ${insertErr.message}`);
  }

  if (requiresApproval) {
    return {
      action: rowToInsert,
      executedImmediately: false,
      requiresApproval: true,
      message: `Queued in Kevin-OS Email Approval Inbox (/email) for 1-click approval before ${params.actionType} on ${account.email_address}.`,
    };
  }

  // Cloud providers (Gmail & Microsoft Graph) execute immediately right here!
  if (account.provider === 'gmail' || account.provider === 'microsoft') {
    const executed = await executeCloudActionNow(rowToInsert, account);
    return {
      action: executed,
      executedImmediately: executed.status === 'executed',
      requiresApproval: false,
      message:
        executed.status === 'executed'
          ? `Executed ${params.actionType} on ${account.email_address} (${account.provider}). Changes automatically sync to Spark Mail.`
          : `Failed ${params.actionType} on ${account.email_address}: ${executed.error_message}`,
    };
  }

  // Thunderbird accounts wait for the local Thunderbird Extension bridge poll (~20s)
  return {
    action: rowToInsert,
    executedImmediately: false,
    requiresApproval: false,
    message: `Queued ${params.actionType} for ${account.email_address} via Thunderbird Bridge (will execute automatically within ~20s while Thunderbird is open and sync to Spark Mail).`,
  };
}

export async function executeCloudActionNow(
  action: EmailActionRecord,
  accountOverride?: EmailAccountRow | null
): Promise<EmailActionRecord> {
  const sb = supabaseAdmin || supabase;
  let account = accountOverride || null;
  if (!account) {
    const { accounts } = await getAllEmailAccountRows();
    account = accounts.find((a) => a.id === action.account_id) || null;
  }
  if (!account) {
    throw new Error(`Email account ${action.account_email} is no longer connected.`);
  }

  const nowIso = new Date().toISOString();
  try {
    const result =
      account.provider === 'gmail'
        ? await executeGmailAction(account, action.action_type, action.payload_json)
        : await executeMicrosoftAction(account, action.action_type, action.payload_json);

    const updated: EmailActionRecord = {
      ...action,
      status: 'executed',
      result_json: result,
      error_message: null,
      executed_at: nowIso,
      updated_at: nowIso,
    };

    if (sb) {
      await sb
        .from('email_actions')
        .update({
          status: 'executed',
          result_json: result,
          error_message: null,
          executed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', action.id);
    }

    return updated;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failed: EmailActionRecord = {
      ...action,
      status: 'failed',
      error_message: errMsg,
      updated_at: nowIso,
    };
    if (sb) {
      await sb
        .from('email_actions')
        .update({
          status: 'failed',
          error_message: errMsg,
          updated_at: nowIso,
        })
        .eq('id', action.id);
    }
    return failed;
  }
}

export async function approveOrRejectEmailAction(params: {
  actionId: string;
  decision: 'approve' | 'reject';
  editedPayload?: Partial<EmailActionPayload>;
}): Promise<EmailActionRecord> {
  const sb = supabaseAdmin || supabase;
  if (!sb) throw new Error('Supabase is not configured.');

  const { data, error } = await sb
    .from('email_actions')
    .select('*')
    .eq('id', params.actionId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Email action ${params.actionId} not found.`);
  }

  const action = data as EmailActionRecord;
  const nowIso = new Date().toISOString();

  if (params.decision === 'reject') {
    const { error: uErr } = await sb
      .from('email_actions')
      .update({ status: 'rejected', updated_at: nowIso })
      .eq('id', action.id);
    if (uErr) throw new Error(uErr.message);
    return { ...action, status: 'rejected', updated_at: nowIso };
  }

  const mergedPayload: EmailActionPayload = {
    ...action.payload_json,
    ...(params.editedPayload || {}),
  };

  const approvedAction: EmailActionRecord = {
    ...action,
    payload_json: mergedPayload,
    status: 'queued',
    error_message: null,
    updated_at: nowIso,
  };

  await sb
    .from('email_actions')
    .update({
      payload_json: mergedPayload,
      status: 'queued',
      error_message: null,
      updated_at: nowIso,
    })
    .eq('id', action.id);

  if (action.provider === 'gmail' || action.provider === 'microsoft') {
    return executeCloudActionNow(approvedAction);
  }

  return approvedAction;
}
