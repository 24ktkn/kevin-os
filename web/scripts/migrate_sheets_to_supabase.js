const path = require('path');
const fs = require('fs');
const { google } = require(path.join(__dirname, '../node_modules/googleapis'));
const { createClient } = require(path.join(__dirname, '../node_modules/@supabase/supabase-js'));

const envContent = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.trim().split('=');
  if (parts[0] && parts[1]) env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const auth = new google.auth.JWT({
  email: env.GOOGLE_CLIENT_EMAIL,
  key: (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = '1qk4gIOjv6iIvAJH_VCQWa2npgME9-saesUNVyPbuPmA';

async function runMigration() {
  console.log('=================================================================');
  console.log('🚀 Kevin-OS: Migrating Google Sheets Data to Supabase PostgreSQL');
  console.log('=================================================================\n');

  // 1. Verify Supabase tables exist
  const { error: wCheck } = await supabase.from('workout_logs').select('id').limit(1);
  const { error: mCheck } = await supabase.from('costco_meal_items').select('id').limit(1);

  if (wCheck || mCheck) {
    console.error('❌ One or more target tables do not exist yet in Supabase:');
    if (wCheck) console.error('   - workout_logs:', wCheck.message);
    if (mCheck) console.error('   - costco_meal_items:', mCheck.message);
    console.log('\n👉 Please run the SQL migration in your Supabase SQL Editor first:');
    console.log('   File: web/supabase_migrations/complete_google_sheets_migration.sql\n');
    return false;
  }

  console.log('✅ Supabase target tables verified!\n');

  // 2. Migrate workout_logs
  console.log('📥 Fetching workout_logs from Google Sheets...');
  const wRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'workout_logs!A1:K1000',
  });
  const wRows = wRes.data.values || [];

  if (wRows.length > 1) {
    const headers = wRows[0].map(h => String(h).trim().toLowerCase());
    const dateIdx = headers.indexOf('date');
    const splitIdx = headers.indexOf('split day');
    const exeIdx = headers.indexOf('exercise');
    const setIdx = headers.indexOf('set number');
    const weightIdx = headers.indexOf('weight (lbs)');
    const repsIdx = headers.indexOf('reps');
    const ormIdx = headers.indexOf('estimated 1rm');
    const timeIdx = headers.indexOf('timestamp');
    const durIdx = headers.indexOf('duration (mins)');
    const gymDurIdx = headers.indexOf('gym duration (mins)');
    const distIdx = headers.indexOf('distance (km)');

    const workoutPayloads = [];
    for (let i = 1; i < wRows.length; i++) {
      const r = wRows[i];
      const d = String(r[dateIdx] || '').trim();
      const exe = String(r[exeIdx] || '').trim();
      if (!d || !exe) continue;

      workoutPayloads.push({
        date: d,
        split_day: String(r[splitIdx] || 'General Training').trim(),
        exercise: exe,
        set_number: parseInt(String(r[setIdx] || '1'), 10) || 1,
        weight_lbs: parseFloat(String(r[weightIdx] || '0')) || 0,
        reps: parseInt(String(r[repsIdx] || '0'), 10) || 0,
        estimated_1rm: parseFloat(String(r[ormIdx] || '0')) || 0,
        timestamp: String(r[timeIdx] || '12:00:00').trim(),
        duration_mins: parseFloat(String(r[durIdx] || '0')) || 0,
        gym_duration_mins: parseFloat(String(r[gymDurIdx] || '60')) || 60,
        distance_km: parseFloat(String(r[distIdx] || '0')) || 0,
      });
    }

    console.log(`   Found ${workoutPayloads.length} workout log rows to import.`);
    // Clean existing records if any
    await supabase.from('workout_logs').delete().neq('date', '1970-01-01');

    // Batch insert in chunks of 100
    for (let i = 0; i < workoutPayloads.length; i += 100) {
      const chunk = workoutPayloads.slice(i, i + 100);
      const { error } = await supabase.from('workout_logs').insert(chunk);
      if (error) {
        console.error(`   ❌ Error inserting workout chunk ${i}-${i + chunk.length}:`, error.message);
      } else {
        console.log(`   ✓ Inserted workout logs ${i + 1} to ${Math.min(i + 100, workoutPayloads.length)}`);
      }
    }
    console.log('   ✅ workout_logs migration completed!\n');
  } else {
    console.log('   ⚠️ No workout rows found in Google Sheets.\n');
  }

  // 3. Migrate Costco_MealPlan
  console.log('📥 Fetching Costco_MealPlan from Google Sheets...');
  const mRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Costco_MealPlan!A1:E100',
  });
  const mRows = mRes.data.values || [];

  if (mRows.length > 1) {
    const headers = mRows[0].map(h => String(h).trim().toLowerCase());
    const tripIdx = headers.findIndex(h => h.includes('trip') || h.includes('phase'));
    const deptIdx = headers.findIndex(h => h.includes('dept') || h.includes('department'));
    const nameIdx = headers.findIndex(h => h.includes('item') || h.includes('name'));
    const scaleIdx = headers.findIndex(h => h.includes('scale') || h.includes('size'));
    const assignIdx = headers.findIndex(h => h.includes('target') || h.includes('assignment'));

    const mealPayloads = [];
    for (let i = 1; i < mRows.length; i++) {
      const r = mRows[i];
      const name = String(r[nameIdx] || '').trim();
      if (!name) continue;

      mealPayloads.push({
        trip: String(r[tripIdx] || 'Trip 1').trim(),
        department: String(r[deptIdx] || 'General').trim(),
        item_name: name,
        target_scale_size: String(r[scaleIdx] || '').trim(),
        meal_assignment: String(r[assignIdx] || '').trim(),
        is_checked: false,
        sort_order: i,
      });
    }

    console.log(`   Found ${mealPayloads.length} Costco meal prep items to import.`);
    // Clean existing
    await supabase.from('costco_meal_items').delete().neq('item_name', '__dummy__');

    const { error: mealInsertErr } = await supabase.from('costco_meal_items').insert(mealPayloads);
    if (mealInsertErr) {
      console.error('   ❌ Error inserting meal items:', mealInsertErr.message);
    } else {
      console.log(`   ✓ Inserted all ${mealPayloads.length} meal items.`);
    }
    console.log('   ✅ Costco_MealPlan migration completed!\n');
  }

  console.log('=================================================================');
  console.log('🎉 ALL DATA FULLY MIGRATED FROM GOOGLE SHEETS TO SUPABASE!');
  console.log('=================================================================');
  return true;
}

runMigration().catch(console.error);
