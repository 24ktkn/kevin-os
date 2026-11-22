/* global messenger */
const api = typeof messenger !== 'undefined' ? messenger : browser;

const DEFAULT_CONFIG = {
  serverUrl: 'https://kevin-os-xr4m.vercel.app',
  bridgeToken: '',
  deviceName: 'Thunderbird-Desktop',
  emailFilter: '', // Empty = sync all IMAP/Exchange accounts; e.g. "uwo.ca" to sync only school email
  enabled: true,
};

const bodyCache = new Map();
let syncInFlight = false;
let lastStatus = {
  state: 'idle',
  lastSyncAt: null,
  accountsSynced: [],
  messagesSynced: 0,
  actionsExecuted: 0,
  lastError: null,
};

function normalizeFolderType(tbType, name) {
  const t = String(tbType || '').toLowerCase();
  if (t === 'inbox') return 'inbox';
  if (t === 'sent') return 'sent';
  if (t === 'drafts') return 'drafts';
  if (t === 'archives' || t === 'archive') return 'archive';
  if (t === 'trash') return 'trash';
  if (t === 'junk') return 'spam';
  const n = String(name || '').toLowerCase();
  if (n === 'inbox') return 'inbox';
  if (n.includes('sent')) return 'sent';
  if (n.includes('draft')) return 'drafts';
  if (n.includes('archive')) return 'archive';
  if (n.includes('trash') || n.includes('deleted')) return 'trash';
  if (n.includes('junk') || n.includes('spam')) return 'spam';
  return 'custom';
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
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
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function parseAddress(raw) {
  const str = String(raw || '').trim();
  const match = str.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, '').trim();
    const email = match[2].trim();
    return { name: name || email, email };
  }
  return { name: str, email: str };
}

function extractBodyFromFullPart(part) {
  if (!part) return { text: '', hasAttachments: false };
  let plain = '';
  let html = '';
  let hasAttachments = false;

  function walk(node) {
    if (!node) return;
    if (node.name && node.partName && !String(node.contentType || '').startsWith('text/')) {
      hasAttachments = true;
    }
    const ct = String(node.contentType || '').toLowerCase();
    if (ct.startsWith('text/plain') && node.body && !plain) {
      plain = String(node.body);
    } else if (ct.startsWith('text/html') && node.body && !html) {
      html = String(node.body);
    }
    if (Array.isArray(node.parts)) {
      for (const child of node.parts) walk(child);
    }
  }

  walk(part);
  const text = (plain || stripHtml(html) || '').trim().slice(0, 12000);
  return { text, hasAttachments };
}

async function collectFoldersForAccount(account) {
  const flat = [];

  async function walkFolder(folder) {
    if (!folder) return;
    const folderId = folder.id || `${account.id}:${folder.path || folder.name}`;
    flat.push({
      raw: folder,
      id: folderId,
      name: folder.name || 'Folder',
      path: folder.path || '',
      type: normalizeFolderType(folder.type, folder.name),
    });

    let children = Array.isArray(folder.subFolders) ? folder.subFolders : [];
    if (children.length === 0 && api.folders && typeof api.folders.getSubFolders === 'function') {
      try {
        children = await api.folders.getSubFolders(folder, false);
      } catch {
        children = [];
      }
    }
    for (const child of children) {
      await walkFolder(child);
    }
  }

  let rootFolders = Array.isArray(account.folders) ? account.folders : [];
  if (rootFolders.length === 0 && account.rootFolder && api.folders?.getSubFolders) {
    try {
      rootFolders = await api.folders.getSubFolders(account.rootFolder, false);
    } catch {
      rootFolders = [];
    }
  }

  for (const f of rootFolders) {
    await walkFolder(f);
  }
  return flat;
}

async function listRecentMessagesInFolder(folderRaw, maxCount) {
  const collected = [];
  try {
    let page = await api.messages.list(folderRaw.id || folderRaw);
    while (page && Array.isArray(page.messages)) {
      collected.push(...page.messages);
      if (collected.length >= maxCount || !page.id) break;
      page = await api.messages.continueList(page.id);
    }
  } catch {
    // fallback passing raw folder object for older TB 115
    try {
      let page = await api.messages.list(folderRaw);
      if (page && Array.isArray(page.messages)) {
        collected.push(...page.messages);
      }
    } catch {
      return [];
    }
  }

  collected.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });
  return collected.slice(0, maxCount);
}

async function getConfig() {
  const stored = await api.storage.local.get(Object.keys(DEFAULT_CONFIG));
  return { ...DEFAULT_CONFIG, ...stored };
}

function accountMatchesFilter(email, filterStr) {
  const trimmed = String(filterStr || '').trim().toLowerCase();
  if (!trimmed) return true;
  const parts = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  const lower = email.toLowerCase();
  return parts.some((p) => lower.includes(p));
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeThunderbirdAction(action, accountRuntimeMap) {
  const email = String(action.account_email || '').toLowerCase();
  const runtime = accountRuntimeMap.get(email);
  const payload = action.payload_json || {};
  const actionType = action.action_type;

  if (!runtime) {
    throw new Error(`Account ${email} is not currently loaded in Thunderbird.`);
  }

  if (actionType === 'draft' || actionType === 'send') {
    const composeDetails = {
      identityId: runtime.identityId || undefined,
      to: Array.isArray(payload.to) ? payload.to : [],
      cc: Array.isArray(payload.cc) ? payload.cc : [],
      bcc: Array.isArray(payload.bcc) ? payload.bcc : [],
      subject: payload.subject || '(No Subject)',
      isPlainText: true,
      plainTextBody: payload.bodyText || '',
    };

    const tab = await api.compose.beginNew(composeDetails);
    await waitMs(350);

    if (actionType === 'draft') {
      const saved = await api.compose.saveMessage(tab.id, { mode: 'draft' });
      await waitMs(250);
      await api.tabs.remove(tab.id).catch(() => {});
      return {
        saved: true,
        draftInfo: saved || null,
        note: 'Draft saved in Thunderbird Drafts (syncs automatically to Spark Mail).',
      };
    }

    const sent = await api.compose.sendMessage(tab.id, { mode: 'sendNow' });
    return {
      sent: true,
      sendInfo: sent || null,
      note: 'Email sent via Thunderbird.',
    };
  }

  if (actionType === 'reply_draft' || actionType === 'reply_send') {
    const replyId = Number(payload.replyToProviderMessageId);
    if (!Number.isFinite(replyId) || replyId <= 0) {
      throw new Error('Valid numeric Thunderbird message ID is required to reply.');
    }
    const replyMode = payload.replyAll ? 'replyToAll' : 'replyToSender';
    const tab = await api.compose.beginReply(replyId, replyMode, {
      identityId: runtime.identityId || undefined,
      isPlainText: true,
      plainTextBody: payload.bodyText || '',
    });
    await waitMs(350);

    if (actionType === 'reply_draft') {
      const saved = await api.compose.saveMessage(tab.id, { mode: 'draft' });
      await waitMs(250);
      await api.tabs.remove(tab.id).catch(() => {});
      return {
        saved: true,
        draftInfo: saved || null,
        note: 'Reply draft saved in Thunderbird Drafts (syncs to Spark Mail).',
      };
    }

    const sent = await api.compose.sendMessage(tab.id, { mode: 'sendNow' });
    return { sent: true, sendInfo: sent || null, note: 'Reply sent via Thunderbird.' };
  }

  const numericIds = (payload.providerMessageIds || [])
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (numericIds.length === 0) {
    throw new Error(`No valid Thunderbird message IDs provided for "${actionType}".`);
  }

  if (actionType === 'archive') {
    await api.messages.archive(numericIds);
    return { archivedCount: numericIds.length };
  }

  if (actionType === 'delete') {
    // skipTrash = false moves safely to Trash folder (recoverable)
    await api.messages.delete(numericIds, false);
    return { trashedCount: numericIds.length, note: 'Moved to Thunderbird Trash.' };
  }

  if (actionType === 'move') {
    const wanted = String(payload.targetFolderId || payload.targetFolder || '').trim().toLowerCase();
    if (!wanted) throw new Error('targetFolder is required for move action.');
    const folder = runtime.folders.find(
      (f) =>
        f.id.toLowerCase() === wanted ||
        f.name.toLowerCase() === wanted ||
        f.type.toLowerCase() === wanted ||
        f.path.toLowerCase().endsWith(`/${wanted}`)
    );
    if (!folder) {
      throw new Error(`Folder "${payload.targetFolder || wanted}" not found in ${email}.`);
    }
    await api.messages.move(numericIds, folder.raw.id || folder.raw);
    return { movedCount: numericIds.length, targetFolder: folder.name };
  }

  if (actionType === 'mark_read' || actionType === 'mark_unread') {
    const read = actionType === 'mark_read';
    for (const id of numericIds) {
      await api.messages.update(id, { read });
    }
    return { updatedCount: numericIds.length, read };
  }

  if (actionType === 'star' || actionType === 'unstar') {
    const flagged = actionType === 'star';
    for (const id of numericIds) {
      await api.messages.update(id, { flagged });
    }
    return { updatedCount: numericIds.length, flagged };
  }

  throw new Error(`Unsupported Thunderbird action: ${actionType}`);
}

async function runSyncCycle(actionResultsToReport = []) {
  if (syncInFlight) return lastStatus;
  syncInFlight = true;

  try {
    const config = await getConfig();
    if (!config.enabled) {
      lastStatus = { ...lastStatus, state: 'paused' };
      return lastStatus;
    }
    if (!config.bridgeToken || !config.serverUrl) {
      lastStatus = {
        ...lastStatus,
        state: 'unconfigured',
        lastError: 'Paste your Kevin-OS Bridge Token in the popup to start syncing.',
      };
      return lastStatus;
    }

    const tbAccounts = await api.accounts.list(true);
    const outgoingAccounts = [];
    const outgoingMessages = [];
    const accountRuntimeMap = new Map();

    for (const acc of tbAccounts) {
      if (acc.type === 'none' || acc.type === 'rss' || acc.type === 'nntp') continue;
      const primaryIdentity = Array.isArray(acc.identities) ? acc.identities[0] : null;
      const email = String(primaryIdentity?.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) continue;
      if (!accountMatchesFilter(email, config.emailFilter)) continue;

      const folders = await collectFoldersForAccount(acc);
      accountRuntimeMap.set(email, {
        account: acc,
        identityId: primaryIdentity?.id || null,
        folders,
      });

      const activeProviderIds = new Set();
      const targetFolders = [
        { folder: folders.find((f) => f.type === 'inbox'), limit: 40 },
        { folder: folders.find((f) => f.type === 'drafts'), limit: 10 },
        { folder: folders.find((f) => f.type === 'sent'), limit: 12 },
      ].filter((x) => Boolean(x.folder));

      for (const { folder, limit } of targetFolders) {
        const msgs = await listRecentMessagesInFolder(folder.raw, limit);
        for (const m of msgs) {
          const provId = String(m.id);
          activeProviderIds.add(provId);

          let cachedBody = bodyCache.get(provId);
          if (!cachedBody) {
            try {
              const full = await api.messages.getFull(m.id);
              cachedBody = extractBodyFromFullPart(full);
              bodyCache.set(provId, cachedBody);
              if (bodyCache.size > 400) {
                const firstKey = bodyCache.keys().next().value;
                if (firstKey) bodyCache.delete(firstKey);
              }
            } catch {
              cachedBody = { text: '', hasAttachments: false };
            }
          }

          const fromParsed = parseAddress(m.author || '');
          const toList = Array.isArray(m.recipients) ? m.recipients : [];
          const ccList = Array.isArray(m.ccList) ? m.ccList : [];

          outgoingMessages.push({
            accountEmail: email,
            providerMessageId: provId,
            threadId: m.headerMessageId || null,
            folderId: folder.id,
            folderName: folder.name,
            folderType: folder.type,
            subject: m.subject || '(No Subject)',
            fromName: fromParsed.name,
            fromEmail: fromParsed.email,
            toList,
            ccList,
            dateIso: m.date ? new Date(m.date).toISOString() : new Date().toISOString(),
            snippet: cachedBody.text.slice(0, 220),
            bodyText: cachedBody.text,
            isRead: Boolean(m.read),
            isStarred: Boolean(m.flagged),
            hasAttachments: Boolean(cachedBody.hasAttachments),
            labels: Array.isArray(m.tags) ? m.tags : [],
          });
        }
      }

      outgoingAccounts.push({
        providerAccountId: acc.id,
        emailAddress: email,
        displayName: primaryIdentity?.name || acc.name || email,
        identityId: primaryIdentity?.id || null,
        folders: folders.map((f) => ({ id: f.id, name: f.name, type: f.type, path: f.path })),
        activeProviderMessageIds: Array.from(activeProviderIds),
      });
    }

    const endpoint = `${config.serverUrl.replace(/\/$/, '')}/api/email/bridge/sync`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Email-Bridge-Token': config.bridgeToken.trim(),
      },
      body: JSON.stringify({
        deviceName: config.deviceName || 'Thunderbird-Desktop',
        accounts: outgoingAccounts,
        messages: outgoingMessages,
        actionResults: actionResultsToReport,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Kevin-OS sync HTTP ${res.status}`);
    }

    const pendingActions = Array.isArray(data.pendingActions) ? data.pendingActions : [];
    const results = [];
    for (const act of pendingActions) {
      try {
        const execResult = await executeThunderbirdAction(act, accountRuntimeMap);
        results.push({ actionId: act.id, success: true, result: execResult });
      } catch (err) {
        results.push({
          actionId: act.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    lastStatus = {
      state: 'connected',
      lastSyncAt: new Date().toISOString(),
      accountsSynced: outgoingAccounts.map((a) => a.emailAddress),
      messagesSynced: outgoingMessages.length,
      actionsExecuted: lastStatus.actionsExecuted + results.filter((r) => r.success).length,
      lastError: null,
    };

    // Report action results immediately if any executed
    if (results.length > 0) {
      syncInFlight = false;
      return runSyncCycle(results);
    }

    return lastStatus;
  } catch (err) {
    lastStatus = {
      ...lastStatus,
      state: 'error',
      lastError: err instanceof Error ? err.message : String(err),
    };
    return lastStatus;
  } finally {
    syncInFlight = false;
  }
}

api.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'GET_STATUS') {
    return Promise.resolve({ status: lastStatus });
  }
  if (msg?.type === 'SYNC_NOW') {
    return runSyncCycle();
  }
  return undefined;
});

api.alarms.create('kevin_os_email_sync', { periodInMinutes: 1 });
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'kevin_os_email_sync') {
    void runSyncCycle();
  }
});

// Fast 25-second active poll while Thunderbird desktop is open
setInterval(() => {
  void runSyncCycle();
}, 25_000);

setTimeout(() => {
  void runSyncCycle();
}, 3_000);
