const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

// 1. Read .env.local
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
    env[key] = val.replace(/^["']|["']$/g, '').trim();
  }
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_TASKS_CLIENT_ID,
  env.GOOGLE_TASKS_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: env.GOOGLE_TASKS_REFRESH_TOKEN });
const tasksApi = google.tasks({ version: 'v1', auth: oauth2Client });

const SCHOOL_TASKLIST_ID = 'ZGRiT21qM2ZCbVRWOVBlMQ';

async function backfill() {
  console.log('Fetching scheduled modules from Supabase...');
  const { data: modules, error } = await sb
    .from('school_items')
    .select('*')
    .eq('is_scheduled', true)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error || !modules) {
    console.error('Error fetching modules:', error);
    return;
  }

  console.log(`Found ${modules.length} recently scheduled modules to sync with Google Tasks:`);

  for (const m of modules) {
    const title = m.title;
    const date = m.scheduled_date || '2026-10-06';
    const time = m.scheduled_time || '10:00 AM';
    const duration = m.duration_mins || 60;

    console.log(`\nCreating Google Task for: "${title}" on ${date} at ${time}`);

    try {
      // 1. Insert into Google Tasks
      const taskRes = await tasksApi.tasks.insert({
        tasklist: SCHOOL_TASKLIST_ID,
        requestBody: {
          title,
          notes: `⏰ Scheduled: ${time} (${duration}m)`,
          due: `${date}T00:00:00.000Z`,
        },
      });

      const taskId = taskRes.data.id;
      console.log(`✓ Google Task created with ID: ${taskId}`);

      // 2. Find any matching event row in tasks table
      const { data: existingEvents } = await sb
        .from('tasks')
        .select('*')
        .eq('type', 'Event')
        .ilike('title', `%${title.replace(/^\(\s*\d+\s*(?:mins?|minutes?|hours?|hrs?)\s*\)\s*/gi, '').trim()}%`)
        .eq('due_date', date);

      const matchedEvent = existingEvents && existingEvents[0];
      const calId = matchedEvent ? matchedEvent.calendar_event_id : null;

      // 3. Upsert Task row into Supabase tasks table
      const { data: existingTask } = await sb
        .from('tasks')
        .select('id')
        .eq('type', 'Task')
        .ilike('title', `%${title}%`)
        .eq('due_date', date)
        .maybeSingle();

      if (existingTask) {
        await sb.from('tasks').update({
          google_task_id: taskId,
          calendar_event_id: calId,
          is_scheduled: true,
          updated_at: new Date().toISOString(),
        }).eq('id', existingTask.id);
        console.log(`✓ Updated existing Supabase task row ${existingTask.id}`);
      } else {
        await sb.from('tasks').insert({
          title,
          type: 'Task',
          calendar_name: 'School',
          due_date: date,
          due_time: time,
          duration_mins: duration,
          notes: `⏰ Scheduled: ${time} (${duration}m)`,
          google_task_id: taskId,
          calendar_event_id: calId,
          is_completed: false,
          is_scheduled: true,
        });
        console.log(`✓ Inserted new Supabase task row`);
      }

      // 4. Update the Event row to link to this google_task_id if present
      if (matchedEvent) {
        await sb.from('tasks').update({
          google_task_id: taskId,
          updated_at: new Date().toISOString(),
        }).eq('id', matchedEvent.id);
        console.log(`✓ Linked Event ${matchedEvent.id} to Google Task ${taskId}`);
      }

    } catch (err) {
      console.error(`Failed to create task for "${title}":`, err.message);
    }
  }

  console.log('\nBackfill completed successfully!');
}

backfill();
