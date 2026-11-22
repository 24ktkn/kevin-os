import { google, gmail_v1 } from 'googleapis';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import {
  EmailActionPayload,
  EmailActionType,
  EmailFolderRef,
  EmailFolderType,
  EmailMessageRecord,
} from '@/types/email';

export interface EmailAccountRow {
  id: string;
  provider: 'gmail' | 'microsoft' | 'thunderbird';
  email_address: string;
  display_name: string;
  account_label: string;
  provider_account_id: string | null;
  identity_id: string | null;
  oauth_refresh_token: string | null;
  oauth_access_token: string | null;
  oauth_expires_at: string | null;
  folders_json: EmailFolderRef[] | null;
  permission_mode: 'read' | 'draft_triage' | 'full_send';
  auto_send_allowed: boolean;
  auto_delete_allowed: boolean;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_device: string | null;
  last_error: string | null;
}

export interface EmailOAuthConfigRow {
  id: string;
  microsoft_client_id: string | null;
  microsoft_client_secret: string | null;
  require_approval_for_send: boolean;
  require_approval_for_delete: boolean;
}

function cleanEnv(val?: string | null): string {
  return (val || '').replace(/^["']|["']$/g, '').trim();
}

export function getGmailOAuthCredentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: cleanEnv(process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_TASKS_CLIENT_ID),
    clientSecret: cleanEnv(process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_TASKS_CLIENT_SECRET),
  };
}

export async function getEmailOAuthConfig(): Promise<EmailOAuthConfigRow> {
  const envClientId = cleanEnv(process.env.MICROSOFT_CLIENT_ID);
  const envClientSecret = cleanEnv(process.env.MICROSOFT_CLIENT_SECRET);

  const fallback: EmailOAuthConfigRow = {
    id: 'default',
    microsoft_client_id: envClientId || null,
    microsoft_client_secret: envClientSecret || null,
    require_approval_for_send: true,
    require_approval_for_delete: true,
  };

  const sb = supabaseAdmin || supabase;
  if (!sb) return fallback;

  try {
    const { data, error } = await sb
      .from('email_oauth_config')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();
    if (error || !data) return fallback;
    return {
      id: 'default',
      microsoft_client_id: envClientId || cleanEnv(data.microsoft_client_id) || null,
      microsoft_client_secret: envClientSecret || cleanEnv(data.microsoft_client_secret) || null,
      require_approval_for_send:
        typeof data.require_approval_for_send === 'boolean' ? data.require_approval_for_send : true,
      require_approval_for_delete:
        typeof data.require_approval_for_delete === 'boolean' ? data.require_approval_for_delete : true,
    };
  } catch {
    return fallback;
  }
}

export function makeEmailMessageId(provider: string, accountEmail: string, providerMsgId: string): string {
  return `${provider}:${accountEmail.toLowerCase()}:${providerMsgId}`;
}

export function makeEmailAccountId(provider: string, emailAddress: string): string {
  return `${provider}:${emailAddress.toLowerCase().trim()}`;
}

export function stripHtmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function parseAddressHeader(raw: string): { name: string; email: string } {
  const cleaned = (raw || '').trim();
  const angleMatch = cleaned.match(/^(.*?)\s*<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1].replace(/^["']|["']$/g, '').trim();
    const email = angleMatch[2].trim();
    return { name: name || email, email };
  }
  return { name: cleaned, email: cleaned };
}

function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function decodeBase64Url(data?: string | null): string {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildRfc2822Mime(params: {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  if (params.from) lines.push(`From: ${params.from}`);
  if (params.to.length > 0) lines.push(`To: ${params.to.join(', ')}`);
  if (params.cc && params.cc.length > 0) lines.push(`Cc: ${params.cc.join(', ')}`);
  if (params.bcc && params.bcc.length > 0) lines.push(`Bcc: ${params.bcc.join(', ')}`);
  lines.push(`Subject: ${encodeMimeHeader(params.subject || '(No Subject)')}`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(params.bodyText || '');
  return lines.join('\r\n');
}

function extractGmailBody(payload?: gmail_v1.Schema$MessagePart | null): { text: string; hasAttachments: boolean } {
  if (!payload) return { text: '', hasAttachments: false };
  let plain = '';
  let html = '';
  let hasAttachments = false;

  const walk = (part: gmail_v1.Schema$MessagePart) => {
    if (part.filename && part.filename.length > 0) {
      hasAttachments = true;
    }
    const mime = (part.mimeType || '').toLowerCase();
    if (mime === 'text/plain' && part.body?.data && !plain) {
      plain = decodeBase64Url(part.body.data);
    } else if (mime === 'text/html' && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) walk(child);
    }
  };

  walk(payload);
  const text = (plain || stripHtmlToText(html) || '').trim();
  return { text: text.slice(0, 16000), hasAttachments };
}

function mapGmailFolder(labelIds: string[]): { folderName: string; folderType: EmailFolderType } {
  const set = new Set(labelIds);
  if (set.has('TRASH')) return { folderName: 'Trash', folderType: 'trash' };
  if (set.has('SPAM')) return { folderName: 'Spam', folderType: 'spam' };
  if (set.has('DRAFT')) return { folderName: 'Drafts', folderType: 'drafts' };
  if (set.has('INBOX')) return { folderName: 'Inbox', folderType: 'inbox' };
  if (set.has('SENT')) return { folderName: 'Sent', folderType: 'sent' };
  return { folderName: 'Archive', folderType: 'archive' };
}

// ============================================================================
// GMAIL PROVIDER
// ============================================================================

export function createGmailClient(account: EmailAccountRow): gmail_v1.Gmail {
  const { clientId, clientSecret } = getGmailOAuthCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_TASKS_CLIENT_ID / GOOGLE_TASKS_CLIENT_SECRET on server.');
  }
  if (!account.oauth_refresh_token) {
    throw new Error(`Gmail account ${account.email_address} is missing an OAuth refresh token.`);
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({
    refresh_token: account.oauth_refresh_token,
    access_token: account.oauth_access_token || undefined,
  });
  return google.gmail({ version: 'v1', auth });
}

function parseGmailMessageToRecord(
  account: EmailAccountRow,
  msg: gmail_v1.Schema$Message
): EmailMessageRecord {
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => (h.name || '').toLowerCase() === name.toLowerCase())?.value || '';

  const fromParsed = parseAddressHeader(getHeader('From'));
  const toList = parseAddressList(getHeader('To'));
  const ccList = parseAddressList(getHeader('Cc'));
  const subject = getHeader('Subject') || '(No Subject)';
  const labelIds = msg.labelIds || [];
  const { folderName, folderType } = mapGmailFolder(labelIds);
  const { text, hasAttachments } = extractGmailBody(msg.payload);
  const internalMs = Number(msg.internalDate || 0);
  const dateIso = internalMs > 0 ? new Date(internalMs).toISOString() : new Date().toISOString();
  const providerMsgId = String(msg.id || '');

  return {
    id: makeEmailMessageId('gmail', account.email_address, providerMsgId),
    account_id: account.id,
    provider: 'gmail',
    account_email: account.email_address,
    provider_message_id: providerMsgId,
    thread_id: msg.threadId || null,
    folder_id: folderName,
    folder_name: folderName,
    folder_type: folderType,
    subject,
    from_name: fromParsed.name,
    from_email: fromParsed.email,
    to_list: toList,
    cc_list: ccList,
    date_iso: dateIso,
    snippet: (msg.snippet || text.slice(0, 220)).trim(),
    body_text: text || msg.snippet || '',
    is_read: !labelIds.includes('UNREAD'),
    is_starred: labelIds.includes('STARRED'),
    has_attachments: hasAttachments,
    labels_json: labelIds,
    synced_at: new Date().toISOString(),
  };
}

export async function syncGmailAccount(
  account: EmailAccountRow,
  maxMessages = 45
): Promise<{ syncedCount: number; foldersCount: number }> {
  const gmail = createGmailClient(account);
  const sb = supabaseAdmin || supabase;

  const [labelsRes, inboxList, recentList] = await Promise.all([
    gmail.users.labels.list({ userId: 'me' }),
    gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: Math.min(35, maxMessages) }),
    gmail.users.messages.list({ userId: 'me', maxResults: Math.min(20, maxMessages), q: 'in:sent OR in:drafts' }),
  ]);

  const folders: EmailFolderRef[] = (labelsRes.data.labels || [])
    .filter((l) => Boolean(l.id && l.name))
    .map((l) => {
      const id = String(l.id);
      const name = String(l.name);
      const upper = id.toUpperCase();
      let type: EmailFolderType = 'custom';
      if (upper === 'INBOX') type = 'inbox';
      else if (upper === 'SENT') type = 'sent';
      else if (upper === 'DRAFT') type = 'drafts';
      else if (upper === 'TRASH') type = 'trash';
      else if (upper === 'SPAM') type = 'spam';
      return { id, name, type };
    });

  const idSet = new Set<string>();
  for (const m of inboxList.data.messages || []) if (m.id) idSet.add(m.id);
  for (const m of recentList.data.messages || []) if (m.id) idSet.add(m.id);
  const msgIds = Array.from(idSet).slice(0, maxMessages);

  const records: EmailMessageRecord[] = [];
  const BATCH = 10;
  for (let i = 0; i < msgIds.length; i += BATCH) {
    const chunk = msgIds.slice(i, i + BATCH);
    const fetched = await Promise.all(
      chunk.map((id) =>
        gmail.users.messages
          .get({ userId: 'me', id, format: 'full' })
          .then((r) => parseGmailMessageToRecord(account, r.data))
          .catch(() => null)
      )
    );
    for (const rec of fetched) {
      if (rec) records.push(rec);
    }
  }

  if (sb) {
    if (records.length > 0) {
      await sb.from('email_messages').upsert(records, { onConflict: 'id' });
    }
    await sb
      .from('email_accounts')
      .update({
        folders_json: folders,
        last_sync_at: new Date().toISOString(),
        last_sync_device: 'vercel-cloud',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);
  }

  return { syncedCount: records.length, foldersCount: folders.length };
}

export async function searchGmailLive(
  account: EmailAccountRow,
  query: string,
  limit = 15
): Promise<EmailMessageRecord[]> {
  const gmail = createGmailClient(account);
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query || undefined,
    maxResults: Math.min(25, Math.max(1, limit)),
  });
  const ids = (listRes.data.messages || []).map((m) => m.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const rows = await Promise.all(
    ids.map((id) =>
      gmail.users.messages
        .get({ userId: 'me', id, format: 'full' })
        .then((r) => parseGmailMessageToRecord(account, r.data))
        .catch(() => null)
    )
  );
  const valid = rows.filter((r): r is EmailMessageRecord => Boolean(r));
  const sb = supabaseAdmin || supabase;
  if (sb && valid.length > 0) {
    await sb.from('email_messages').upsert(valid, { onConflict: 'id' });
  }
  return valid;
}

export async function getGmailMessageFull(
  account: EmailAccountRow,
  providerMessageId: string
): Promise<EmailMessageRecord | null> {
  const gmail = createGmailClient(account);
  const res = await gmail.users.messages.get({ userId: 'me', id: providerMessageId, format: 'full' });
  const record = parseGmailMessageToRecord(account, res.data);
  const sb = supabaseAdmin || supabase;
  if (sb) {
    await sb.from('email_messages').upsert(record, { onConflict: 'id' });
  }
  return record;
}

async function resolveGmailLabelId(
  gmail: gmail_v1.Gmail,
  account: EmailAccountRow,
  folderNameOrId: string
): Promise<string> {
  const target = folderNameOrId.trim();
  const cached = (account.folders_json || []).find(
    (f) => f.id === target || f.name.toLowerCase() === target.toLowerCase()
  );
  if (cached) return cached.id;

  const list = await gmail.users.labels.list({ userId: 'me' });
  const found = (list.data.labels || []).find(
    (l) => l.id === target || (l.name || '').toLowerCase() === target.toLowerCase()
  );
  if (found?.id) return found.id;

  // Create label cleanly if user asked to sort/move into a new Gmail label
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name: target, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  if (!created.data.id) throw new Error(`Could not resolve or create Gmail label "${target}"`);
  return created.data.id;
}

export async function executeGmailAction(
  account: EmailAccountRow,
  actionType: EmailActionType,
  payload: EmailActionPayload
): Promise<Record<string, unknown>> {
  const gmail = createGmailClient(account);
  const sb = supabaseAdmin || supabase;

  if (actionType === 'draft' || actionType === 'reply_draft' || actionType === 'send' || actionType === 'reply_send') {
    let to = payload.to || [];
    let subject = payload.subject || '';
    let inReplyTo: string | undefined;
    let references: string | undefined;
    let threadId = payload.replyToThreadId;

    if ((actionType === 'reply_draft' || actionType === 'reply_send') && payload.replyToProviderMessageId) {
      const orig = await gmail.users.messages.get({
        userId: 'me',
        id: payload.replyToProviderMessageId,
        format: 'metadata',
        metadataHeaders: ['From', 'Reply-To', 'To', 'Cc', 'Subject', 'Message-ID', 'References'],
      });
      const headers = orig.data.payload?.headers || [];
      const h = (name: string) =>
        headers.find((x) => (x.name || '').toLowerCase() === name.toLowerCase())?.value || '';

      threadId = threadId || orig.data.threadId || undefined;
      const origMsgId = h('Message-ID');
      if (origMsgId) {
        inReplyTo = origMsgId;
        references = [h('References'), origMsgId].filter(Boolean).join(' ');
      }
      if (to.length === 0) {
        const replyAddr = parseAddressHeader(h('Reply-To') || h('From')).email;
        if (replyAddr) to = [replyAddr];
      }
      if (!subject) {
        const origSubj = h('Subject') || '(No Subject)';
        subject = /^re:/i.test(origSubj) ? origSubj : `Re: ${origSubj}`;
      }
    }

    if (to.length === 0 && (actionType === 'send' || actionType === 'reply_send')) {
      throw new Error('Recipient (to) is required to send an email.');
    }

    const mime = buildRfc2822Mime({
      from: account.email_address,
      to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject,
      bodyText: payload.bodyText || '',
      inReplyTo,
      references,
    });
    const raw = encodeBase64Url(mime);

    if (actionType === 'draft' || actionType === 'reply_draft') {
      const res = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: { raw, threadId },
        },
      });
      return {
        draftId: res.data.id || null,
        messageId: res.data.message?.id || null,
        threadId: res.data.message?.threadId || threadId || null,
        note: 'Draft created in Gmail (automatically synced to Spark Mail Drafts).',
      };
    }

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });
    return {
      sentMessageId: res.data.id || null,
      threadId: res.data.threadId || threadId || null,
      note: 'Email sent via Gmail API.',
    };
  }

  const ids = payload.providerMessageIds || [];
  if (ids.length === 0) {
    throw new Error(`No providerMessageIds supplied for Gmail action "${actionType}".`);
  }

  if (actionType === 'delete') {
    await Promise.all(ids.map((id) => gmail.users.messages.trash({ userId: 'me', id })));
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ folder_name: 'Trash', folder_type: 'trash', synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { trashedCount: ids.length, note: 'Moved to Gmail Trash (recoverable).' };
  }

  if (actionType === 'archive') {
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: { ids, removeLabelIds: ['INBOX'] },
    });
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ folder_name: 'Archive', folder_type: 'archive', synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { archivedCount: ids.length };
  }

  if (actionType === 'move') {
    const folder = payload.targetFolderId || payload.targetFolder;
    if (!folder) throw new Error('targetFolder is required for move action.');
    const labelId = await resolveGmailLabelId(gmail, account, folder);
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: { ids, addLabelIds: [labelId], removeLabelIds: ['INBOX'] },
    });
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({
          folder_id: labelId,
          folder_name: payload.targetFolder || labelId,
          folder_type: 'custom',
          synced_at: new Date().toISOString(),
        })
        .in('id', payload.messageIds);
    }
    return { movedCount: ids.length, labelId };
  }

  if (actionType === 'mark_read' || actionType === 'mark_unread') {
    const isRead = actionType === 'mark_read';
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: isRead ? { ids, removeLabelIds: ['UNREAD'] } : { ids, addLabelIds: ['UNREAD'] },
    });
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ is_read: isRead, synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { updatedCount: ids.length, isRead };
  }

  if (actionType === 'star' || actionType === 'unstar') {
    const isStarred = actionType === 'star';
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: isStarred ? { ids, addLabelIds: ['STARRED'] } : { ids, removeLabelIds: ['STARRED'] },
    });
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ is_starred: isStarred, synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { updatedCount: ids.length, isStarred };
  }

  throw new Error(`Unsupported Gmail action: ${actionType}`);
}

// ============================================================================
// MICROSOFT GRAPH PROVIDER (Hotmail / Outlook.com / Live)
// ============================================================================

export async function getMicrosoftAccessToken(account: EmailAccountRow): Promise<string> {
  const nowMs = Date.now();
  if (account.oauth_access_token && account.oauth_expires_at) {
    const expMs = new Date(account.oauth_expires_at).getTime();
    if (Number.isFinite(expMs) && expMs - nowMs > 120_000) {
      return account.oauth_access_token;
    }
  }

  if (!account.oauth_refresh_token) {
    throw new Error(`Microsoft account ${account.email_address} is missing an OAuth refresh token.`);
  }

  const config = await getEmailOAuthConfig();
  if (!config.microsoft_client_id) {
    throw new Error('Microsoft OAuth Client ID is not configured yet in Kevin-OS Email Settings.');
  }

  const form = new URLSearchParams();
  form.set('client_id', config.microsoft_client_id);
  if (config.microsoft_client_secret) {
    form.set('client_secret', config.microsoft_client_secret);
  }
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', account.oauth_refresh_token);
  form.set('scope', 'offline_access User.Read Mail.ReadWrite Mail.Send');

  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Microsoft token refresh failed (${res.status}): ${data.error_description || data.error || 'Unknown error'}`
    );
  }

  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3500) * 1000).toISOString();
  const sb = supabaseAdmin || supabase;
  if (sb) {
    await sb
      .from('email_accounts')
      .update({
        oauth_access_token: data.access_token,
        oauth_refresh_token: data.refresh_token || account.oauth_refresh_token,
        oauth_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);
  }

  account.oauth_access_token = data.access_token;
  account.oauth_expires_at = expiresAt;
  return data.access_token;
}

async function msGraphFetch<T = Record<string, unknown>>(
  account: EmailAccountRow,
  path: string,
  init?: RequestInit & { preferTextBody?: boolean }
): Promise<T> {
  const token = await getMicrosoftAccessToken(account);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init?.preferTextBody ? { Prefer: 'outlook.body-content-type="text"' } : {}),
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  };

  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, { ...init, headers });
  if (res.status === 202 || res.status === 204) {
    return {} as T;
  }
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const errObj = parsed as { error?: { message?: string } };
    throw new Error(errObj?.error?.message || `Microsoft Graph HTTP ${res.status}`);
  }
  return parsed as T;
}

interface MsGraphMessage {
  id: string;
  conversationId?: string;
  parentFolderId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  flag?: { flagStatus?: string };
}

function classifyMsFolderType(displayName: string): EmailFolderType {
  const lower = displayName.toLowerCase();
  if (lower === 'inbox') return 'inbox';
  if (lower.includes('sent')) return 'sent';
  if (lower.includes('draft')) return 'drafts';
  if (lower.includes('archive')) return 'archive';
  if (lower.includes('deleted') || lower.includes('trash')) return 'trash';
  if (lower.includes('junk') || lower.includes('spam')) return 'spam';
  return 'custom';
}

function parseMsMessageToRecord(
  account: EmailAccountRow,
  m: MsGraphMessage,
  folderLookup: Map<string, EmailFolderRef>
): EmailMessageRecord {
  const folder = m.parentFolderId ? folderLookup.get(m.parentFolderId) : undefined;
  const folderType: EmailFolderType = m.isDraft ? 'drafts' : folder?.type || 'inbox';
  const folderName = m.isDraft ? 'Drafts' : folder?.name || 'Inbox';
  const rawBody = m.body?.content || '';
  const bodyText =
    m.body?.contentType?.toLowerCase() === 'html' ? stripHtmlToText(rawBody) : rawBody.trim();

  return {
    id: makeEmailMessageId('microsoft', account.email_address, m.id),
    account_id: account.id,
    provider: 'microsoft',
    account_email: account.email_address,
    provider_message_id: m.id,
    thread_id: m.conversationId || null,
    folder_id: m.parentFolderId || null,
    folder_name: folderName,
    folder_type: folderType,
    subject: m.subject || '(No Subject)',
    from_name: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
    from_email: m.from?.emailAddress?.address || '',
    to_list: (m.toRecipients || []).map((r) => r.emailAddress?.address || '').filter(Boolean),
    cc_list: (m.ccRecipients || []).map((r) => r.emailAddress?.address || '').filter(Boolean),
    date_iso: m.receivedDateTime || m.sentDateTime || new Date().toISOString(),
    snippet: (m.bodyPreview || bodyText.slice(0, 220)).trim(),
    body_text: (bodyText || m.bodyPreview || '').slice(0, 16000),
    is_read: Boolean(m.isRead),
    is_starred: m.flag?.flagStatus === 'flagged',
    has_attachments: Boolean(m.hasAttachments),
    labels_json: [folderName],
    synced_at: new Date().toISOString(),
  };
}

export async function syncMicrosoftAccount(
  account: EmailAccountRow,
  maxMessages = 45
): Promise<{ syncedCount: number; foldersCount: number }> {
  const sb = supabaseAdmin || supabase;

  const [foldersRes, inboxRes, draftsRes] = await Promise.all([
    msGraphFetch<{
      value?: Array<{ id: string; displayName: string; unreadItemCount?: number }>;
    }>(account, '/me/mailFolders?$top=50'),
    msGraphFetch<{ value?: MsGraphMessage[] }>(
      account,
      `/me/mailFolders/inbox/messages?$top=${Math.min(35, maxMessages)}&$orderby=receivedDateTime desc&$select=id,conversationId,parentFolderId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,hasAttachments,flag`,
      { preferTextBody: true }
    ),
    msGraphFetch<{ value?: MsGraphMessage[] }>(
      account,
      `/me/mailFolders/drafts/messages?$top=10&$orderby=lastModifiedDateTime desc&$select=id,conversationId,parentFolderId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,hasAttachments,flag`,
      { preferTextBody: true }
    ).catch(() => ({ value: [] as MsGraphMessage[] })),
  ]);

  const folders: EmailFolderRef[] = (foldersRes.value || []).map((f) => ({
    id: f.id,
    name: f.displayName,
    type: classifyMsFolderType(f.displayName),
    unreadCount: f.unreadItemCount,
  }));

  const folderMap = new Map<string, EmailFolderRef>(folders.map((f) => [f.id, f]));
  const combined = [...(inboxRes.value || []), ...(draftsRes.value || [])];
  const seen = new Set<string>();
  const records: EmailMessageRecord[] = [];
  for (const m of combined) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    records.push(parseMsMessageToRecord(account, m, folderMap));
  }

  if (sb) {
    if (records.length > 0) {
      await sb.from('email_messages').upsert(records, { onConflict: 'id' });
    }
    await sb
      .from('email_accounts')
      .update({
        folders_json: folders,
        last_sync_at: new Date().toISOString(),
        last_sync_device: 'vercel-cloud',
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);
  }

  return { syncedCount: records.length, foldersCount: folders.length };
}

export async function searchMicrosoftLive(
  account: EmailAccountRow,
  query: string,
  limit = 15
): Promise<EmailMessageRecord[]> {
  const safeQ = query.replace(/"/g, '').trim();
  const path = safeQ
    ? `/me/messages?$search="${encodeURIComponent(safeQ)}"&$top=${Math.min(25, limit)}&$select=id,conversationId,parentFolderId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,hasAttachments,flag`
    : `/me/mailFolders/inbox/messages?$top=${Math.min(25, limit)}&$orderby=receivedDateTime desc&$select=id,conversationId,parentFolderId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,hasAttachments,flag`;

  const res = await msGraphFetch<{ value?: MsGraphMessage[] }>(account, path, {
    preferTextBody: true,
    headers: { ConsistencyLevel: 'eventual' },
  });

  const folderMap = new Map<string, EmailFolderRef>(
    (account.folders_json || []).map((f) => [f.id, f])
  );
  const records = (res.value || []).map((m) => parseMsMessageToRecord(account, m, folderMap));
  const sb = supabaseAdmin || supabase;
  if (sb && records.length > 0) {
    await sb.from('email_messages').upsert(records, { onConflict: 'id' });
  }
  return records;
}

export async function getMicrosoftMessageFull(
  account: EmailAccountRow,
  providerMessageId: string
): Promise<EmailMessageRecord | null> {
  const m = await msGraphFetch<MsGraphMessage>(
    account,
    `/me/messages/${encodeURIComponent(providerMessageId)}?$select=id,conversationId,parentFolderId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,hasAttachments,flag`,
    { preferTextBody: true }
  );
  const folderMap = new Map<string, EmailFolderRef>(
    (account.folders_json || []).map((f) => [f.id, f])
  );
  const record = parseMsMessageToRecord(account, m, folderMap);
  const sb = supabaseAdmin || supabase;
  if (sb) {
    await sb.from('email_messages').upsert(record, { onConflict: 'id' });
  }
  return record;
}

async function resolveMsFolderId(account: EmailAccountRow, folderNameOrId: string): Promise<string> {
  const target = folderNameOrId.trim();
  const cached = (account.folders_json || []).find(
    (f) => f.id === target || f.name.toLowerCase() === target.toLowerCase()
  );
  if (cached) return cached.id;

  const list = await msGraphFetch<{ value?: Array<{ id: string; displayName: string }> }>(
    account,
    '/me/mailFolders?$top=50'
  );
  const found = (list.value || []).find(
    (f) => f.id === target || f.displayName.toLowerCase() === target.toLowerCase()
  );
  if (found?.id) return found.id;

  const created = await msGraphFetch<{ id: string }>(account, '/me/mailFolders', {
    method: 'POST',
    body: JSON.stringify({ displayName: target }),
  });
  return created.id;
}

export async function executeMicrosoftAction(
  account: EmailAccountRow,
  actionType: EmailActionType,
  payload: EmailActionPayload
): Promise<Record<string, unknown>> {
  const sb = supabaseAdmin || supabase;
  const toRecipients = (payload.to || []).map((address) => ({ emailAddress: { address } }));
  const ccRecipients = (payload.cc || []).map((address) => ({ emailAddress: { address } }));
  const bccRecipients = (payload.bcc || []).map((address) => ({ emailAddress: { address } }));

  if (actionType === 'draft') {
    const created = await msGraphFetch<{ id: string }>(account, '/me/messages', {
      method: 'POST',
      body: JSON.stringify({
        subject: payload.subject || '(No Subject)',
        body: { contentType: 'Text', content: payload.bodyText || '' },
        toRecipients,
        ccRecipients,
        bccRecipients,
      }),
    });
    return {
      draftId: created.id,
      note: 'Draft created in Outlook/Hotmail (automatically synced to Spark Mail Drafts).',
    };
  }

  if (actionType === 'reply_draft') {
    if (!payload.replyToProviderMessageId) {
      throw new Error('replyToProviderMessageId is required for reply_draft.');
    }
    const endpoint = payload.replyAll ? 'createReplyAll' : 'createReply';
    const created = await msGraphFetch<{ id: string; body?: { content?: string } }>(
      account,
      `/me/messages/${encodeURIComponent(payload.replyToProviderMessageId)}/${endpoint}`,
      { method: 'POST', body: JSON.stringify({ comment: payload.bodyText || '' }) }
    );
    return {
      draftId: created.id,
      note: 'Reply draft created in Outlook/Hotmail (automatically synced to Spark Mail Drafts).',
    };
  }

  if (actionType === 'send') {
    if (toRecipients.length === 0) throw new Error('Recipient (to) is required to send an email.');
    await msGraphFetch(account, '/me/sendMail', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: payload.subject || '(No Subject)',
          body: { contentType: 'Text', content: payload.bodyText || '' },
          toRecipients,
          ccRecipients,
          bccRecipients,
        },
        saveToSentItems: true,
      }),
    });
    return { sent: true, note: 'Email sent via Microsoft Graph API.' };
  }

  if (actionType === 'reply_send') {
    if (!payload.replyToProviderMessageId) {
      throw new Error('replyToProviderMessageId is required for reply_send.');
    }
    const endpoint = payload.replyAll ? 'replyAll' : 'reply';
    await msGraphFetch(
      account,
      `/me/messages/${encodeURIComponent(payload.replyToProviderMessageId)}/${endpoint}`,
      { method: 'POST', body: JSON.stringify({ comment: payload.bodyText || '' }) }
    );
    return { sent: true, note: 'Reply sent via Microsoft Graph API.' };
  }

  const ids = payload.providerMessageIds || [];
  if (ids.length === 0) {
    throw new Error(`No providerMessageIds supplied for Microsoft action "${actionType}".`);
  }

  if (actionType === 'delete') {
    await Promise.all(
      ids.map((id) =>
        msGraphFetch(account, `/me/messages/${encodeURIComponent(id)}/move`, {
          method: 'POST',
          body: JSON.stringify({ destinationId: 'deleteditems' }),
        })
      )
    );
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ folder_name: 'Deleted Items', folder_type: 'trash', synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { trashedCount: ids.length, note: 'Moved to Deleted Items (recoverable).' };
  }

  if (actionType === 'archive') {
    await Promise.all(
      ids.map((id) =>
        msGraphFetch(account, `/me/messages/${encodeURIComponent(id)}/move`, {
          method: 'POST',
          body: JSON.stringify({ destinationId: 'archive' }),
        })
      )
    );
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ folder_name: 'Archive', folder_type: 'archive', synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { archivedCount: ids.length };
  }

  if (actionType === 'move') {
    const folder = payload.targetFolderId || payload.targetFolder;
    if (!folder) throw new Error('targetFolder is required for move action.');
    const destId = await resolveMsFolderId(account, folder);
    await Promise.all(
      ids.map((id) =>
        msGraphFetch(account, `/me/messages/${encodeURIComponent(id)}/move`, {
          method: 'POST',
          body: JSON.stringify({ destinationId: destId }),
        })
      )
    );
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({
          folder_id: destId,
          folder_name: payload.targetFolder || destId,
          folder_type: 'custom',
          synced_at: new Date().toISOString(),
        })
        .in('id', payload.messageIds);
    }
    return { movedCount: ids.length, destinationId: destId };
  }

  if (actionType === 'mark_read' || actionType === 'mark_unread') {
    const isRead = actionType === 'mark_read';
    await Promise.all(
      ids.map((id) =>
        msGraphFetch(account, `/me/messages/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ isRead }),
        })
      )
    );
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ is_read: isRead, synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { updatedCount: ids.length, isRead };
  }

  if (actionType === 'star' || actionType === 'unstar') {
    const isStarred = actionType === 'star';
    await Promise.all(
      ids.map((id) =>
        msGraphFetch(account, `/me/messages/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ flag: { flagStatus: isStarred ? 'flagged' : 'notFlagged' } }),
        })
      )
    );
    if (sb && payload.messageIds?.length) {
      await sb
        .from('email_messages')
        .update({ is_starred: isStarred, synced_at: new Date().toISOString() })
        .in('id', payload.messageIds);
    }
    return { updatedCount: ids.length, isStarred };
  }

  throw new Error(`Unsupported Microsoft action: ${actionType}`);
}
