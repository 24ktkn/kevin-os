const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Read .env.local
const envContent = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const lines = envContent.split(/\r?\n/);
const env = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > -1) {
    const key = trimmed.substring(0, idx).trim();
    let val = trimmed.substring(idx + 1).trim();
    env[key] = val;
  }
}

function cleanEnv(val) {
  if (!val) return '';
  return val.replace(/^["']|["']$/g, '').trim();
}

async function testAuth() {
  const rawId = env['GOOGLE_TASKS_CLIENT_ID'];
  const cleanId = cleanEnv(rawId);
  const rawSecret = env['GOOGLE_TASKS_CLIENT_SECRET'];
  const cleanSecret = cleanEnv(rawSecret);
  const rawToken = env['GOOGLE_TASKS_REFRESH_TOKEN'];
  const cleanToken = cleanEnv(rawToken);

  console.log('Testing with raw credentials:');
  console.log('rawId has quotes?:', rawId.startsWith('"'), rawId.endsWith('"'));
  console.log('cleanId has quotes?:', cleanId.startsWith('"'), cleanId.endsWith('"'));

  // Test 1: Cleaned
  console.log('\n--- Test with clean credentials ---');
  const oauth2Client = new google.auth.OAuth2(cleanId, cleanSecret);
  oauth2Client.setCredentials({ refresh_token: cleanToken });

  try {
    const { token } = await oauth2Client.getAccessToken();
    console.log('Success! Token acquired, length:', token?.length);
    const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
    const listsRes = await tasksApi.tasklists.list();
    console.log('Task lists:');
    listsRes.data.items?.forEach(l => console.log(` - ${l.title} (ID: ${l.id})`));
  } catch (err) {
    console.error('Error with clean credentials:', err.message, err.response?.data);
  }

  // Test 2: Raw (as process.env might have quotes)
  console.log('\n--- Test with raw credentials ---');
  const rawClient = new google.auth.OAuth2(rawId, rawSecret);
  rawClient.setCredentials({ refresh_token: rawToken });

  try {
    const { token } = await rawClient.getAccessToken();
    console.log('Raw credentials success!');
  } catch (err) {
    console.error('Raw credentials error:', err.message, err.response?.data);
  }
}

testAuth();
