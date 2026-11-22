/* global messenger */
const api = typeof messenger !== 'undefined' ? messenger : browser;

const el = (id) => document.getElementById(id);

function renderStatus(status) {
  const pill = el('statePill');
  const accountsLine = el('accountsLine');
  const syncMeta = el('syncMeta');
  const errorLine = el('errorLine');

  if (!status) return;
  pill.textContent = status.state || 'idle';
  pill.className = 'pill ' + (status.state === 'connected' ? 'ok' : status.state === 'error' ? 'err' : 'idle');

  const accs = Array.isArray(status.accountsSynced) ? status.accountsSynced : [];
  accountsLine.textContent = `Accounts: ${accs.length > 0 ? accs.join(', ') : 'None matched yet'}`;
  syncMeta.textContent = status.lastSyncAt
    ? `Synced ${status.messagesSynced || 0} msgs · ${status.actionsExecuted || 0} actions · ${new Date(status.lastSyncAt).toLocaleTimeString()}`
    : 'Not synced yet';

  if (status.lastError) {
    errorLine.style.display = 'block';
    errorLine.textContent = status.lastError;
  } else {
    errorLine.style.display = 'none';
  }
}

async function init() {
  const stored = await api.storage.local.get([
    'serverUrl',
    'bridgeToken',
    'deviceName',
    'emailFilter',
  ]);
  el('serverUrl').value = stored.serverUrl || 'https://kevin-os-xr4m.vercel.app';
  el('bridgeToken').value = stored.bridgeToken || '';
  el('emailFilter').value = stored.emailFilter || '';
  el('deviceName').value = stored.deviceName || 'Thunderbird-Desktop';

  const res = await api.runtime.sendMessage({ type: 'GET_STATUS' }).catch(() => null);
  if (res?.status) renderStatus(res.status);
}

el('saveSyncBtn').addEventListener('click', async () => {
  const btn = el('saveSyncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  try {
    await api.storage.local.set({
      serverUrl: el('serverUrl').value.trim() || 'https://kevin-os-xr4m.vercel.app',
      bridgeToken: el('bridgeToken').value.trim(),
      emailFilter: el('emailFilter').value.trim(),
      deviceName: el('deviceName').value.trim() || 'Thunderbird-Desktop',
      enabled: true,
    });
    const status = await api.runtime.sendMessage({ type: 'SYNC_NOW' });
    renderStatus(status);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Sync Now';
  }
});

void init();
