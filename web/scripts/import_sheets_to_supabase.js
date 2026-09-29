const path = require('path');
const fs = require('fs');
const { google } = require(path.join(process.cwd(), 'node_modules', 'googleapis'));
const { createClient } = require(path.join(process.cwd(), 'node_modules', '@supabase', 'supabase-js'));

const envContent = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.trim().split('=');
  const k = parts[0];
  const v = parts.slice(1).join('=');
  if (k && v) env[k.trim()] = v.trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function runImport() {
  console.log('--- Checking Supabase Tables ---');
  const { error: hCheck } = await supabase.from('habits').select('date').limit(1);
  if (hCheck) {
    console.log('⚠️ habits table does not exist yet. Please run the SQL schema first.');
    return;
  }
  console.log('✅ habits table exists! Starting import from Google Sheets...\n');

  const auth = new google.auth.JWT({
    email: env.GOOGLE_CLIENT_EMAIL,
    key: (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = '1qk4gIOjv6iIvAJH_VCQWa2npgME9-saesUNVyPbuPmA';

  // 1. Import Habits
  console.log('1. Fetching Habits from Google Sheets...');
  const hRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Habits!A1:D1100',
  });
  const hRows = hRes.data.values || [];
  if (hRows.length > 1) {
    const headers = hRows[0].map(h => String(h).trim());
    const dateIdx = headers.indexOf('Date');
    const wakeIdx = headers.indexOf('Wake Up On Time');
    const gymIdx = headers.indexOf('Gym Workout');
    const journalIdx = headers.indexOf('Journaling');

    const habitMap = new Map();
    for (let i = 1; i < hRows.length; i++) {
      const r = hRows[i];
      const d = String(r[dateIdx] || '').trim();
      if (!d || d.length < 8) continue;
      const wake = String(r[wakeIdx] || '').trim().toUpperCase() === 'TRUE';
      const gym = String(r[gymIdx] || '').trim().toUpperCase() === 'TRUE';
      const journal = String(r[journalIdx] || '').trim().toUpperCase() === 'TRUE';
      habitMap.set(d, {
        date: d,
        wake_up_on_time: wake,
        gym_workout: gym,
        journaling: journal,
      });
    }
    const habitPayloads = Array.from(habitMap.values());

    console.log(`   Upserting ${habitPayloads.length} habit records into Supabase...`);
    // Batch upsert in chunks of 100
    for (let i = 0; i < habitPayloads.length; i += 100) {
      const chunk = habitPayloads.slice(i, i + 100);
      const { error } = await supabase.from('habits').upsert(chunk, { onConflict: 'date' });
      if (error) console.error('   Batch error:', error.message);
    }
    console.log('   ✅ Habits import completed!');
  }

  // 2. Import Health Metrics / Biometrics
  const { error: bCheck } = await supabase.from('biometrics').select('date').limit(1);
  if (!bCheck) {
    console.log('\n2. Fetching Health Metrics from Google Sheets...');
    const bRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'health_metrics!A1:J1100',
    });
    const bRows = bRes.data.values || [];
    if (bRows.length > 1) {
      const headers = bRows[0].map(h => String(h).trim().toLowerCase());
      const dateIdx = headers.indexOf('date');
      const stepsIdx = headers.indexOf('steps');
      const hrvIdx = headers.indexOf('hrv');
      const sleepIdx = headers.indexOf('sleep duration');
      const rhrIdx = headers.indexOf('rhr');
      const weightIdx = headers.indexOf('bodyweight');
      const wakeIdx = headers.indexOf('wake time');
      const sleepTimeIdx = headers.indexOf('sleep time');
      const wCalIdx = headers.indexOf('workout calories');
      const wDurIdx = headers.indexOf('workout duration');

      const bioMap = new Map();
      for (let i = 1; i < bRows.length; i++) {
        const r = bRows[i];
        const d = String(r[dateIdx] || '').trim();
        if (!d || d.length < 8) continue;
        const steps = parseInt(String(r[stepsIdx] || '0').replace(/,/g, ''), 10) || 0;
        const hrv = parseFloat(String(r[hrvIdx] || '0')) || 0;
        const sleepStr = String(r[sleepIdx] || '0');
        const sleepHours = parseFloat(sleepStr) || 0;
        const rhr = parseFloat(String(r[rhrIdx] || '0')) || 0;
        const bodyweight = parseFloat(String(r[weightIdx] || '170')) || 170;
        const wakeTime = String(r[wakeIdx] || '');
        const sleepTime = String(r[sleepTimeIdx] || '');
        const wCal = parseFloat(String(r[wCalIdx] || '0')) || 0;
        const wDur = parseFloat(String(r[wDurIdx] || '0')) || 0;

        bioMap.set(d, {
          date: d,
          steps,
          hrv,
          sleep_duration: sleepStr,
          sleep_hours: sleepHours,
          rhr,
          bodyweight,
          wake_time: wakeTime,
          sleep_time: sleepTime,
          workout_calories: wCal,
          workout_duration: wDur,
        });
      }
      const biometricsPayloads = Array.from(bioMap.values());

      console.log(`   Upserting ${biometricsPayloads.length} biometrics records into Supabase...`);
      for (let i = 0; i < biometricsPayloads.length; i += 100) {
        const chunk = biometricsPayloads.slice(i, i + 100);
        const { error } = await supabase.from('biometrics').upsert(chunk, { onConflict: 'date' });
        if (error) console.error('   Biometrics batch error:', error.message);
      }
      console.log('   ✅ Biometrics import completed!');
    }
  }

  // 3. Import Journal Entries
  const { error: jCheck } = await supabase.from('journal_entries').select('date').limit(1);
  if (!jCheck) {
    console.log('\n3. Fetching Journal Entries from Google Sheets...');
    const jRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'journal_entries!A1:C500',
    });
    const jRows = jRes.data.values || [];
    if (jRows.length > 1) {
      const headers = jRows[0].map(h => String(h).trim().toLowerCase());
      const dateIdx = headers.indexOf('date');
      const entryIdx = headers.indexOf('entry');
      const photosIdx = headers.indexOf('photos');

      const journalPayloads = [];
      for (let i = 1; i < jRows.length; i++) {
        const r = jRows[i];
        const d = String(r[dateIdx] || '').trim();
        if (!d) continue;
        const entry = String(r[entryIdx] || '');
        const rawPhotos = String(r[photosIdx] || '');
        let photos = [];
        try { photos = JSON.parse(rawPhotos); } catch { photos = []; }
        journalPayloads.push({ date: d, entry, photos });
      }

      if (journalPayloads.length > 0) {
        console.log(`   Upserting ${journalPayloads.length} journal entries into Supabase...`);
        const { error } = await supabase.from('journal_entries').upsert(journalPayloads, { onConflict: 'date' });
        if (error) console.error('   Journal batch error:', error.message);
        console.log('   ✅ Journal entries import completed!');
      }
    }
  }

  console.log('\n🎉 ALL SHEETS DATA IMPORTED INTO SUPABASE SUCCESSFULLY!');
}

runImport().catch(console.error);
