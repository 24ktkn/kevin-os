import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import {
  getGoogleTasksClientAsync,
  saveGoogleTasksRefreshToken,
} from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

const OAUTH_PLAYGROUND_REDIRECT = 'https://developers.google.com/oauthplayground';

export async function GET() {
  const { tasksApi, hasCredentials, clientId } = await getGoogleTasksClientAsync();

  const authUrl = clientId
    ? `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        clientId
      )}&redirect_uri=${encodeURIComponent(
        OAUTH_PLAYGROUND_REDIRECT
      )}&response_type=code&scope=${encodeURIComponent(
        'https://www.googleapis.com/auth/tasks'
      )}&access_type=offline&prompt=consent`
    : '';

  if (!tasksApi || !hasCredentials) {
    return NextResponse.json({
      connected: false,
      authUrl,
      error: 'Missing Google Tasks OAuth credentials',
    });
  }

  try {
    await tasksApi.tasklists.list({ maxResults: 5 });
    return NextResponse.json({
      connected: true,
      authUrl,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      connected: false,
      authUrl,
      error: msg,
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawInput = String(body.tokenOrCode || body.refreshToken || '').trim();

    if (!rawInput) {
      return NextResponse.json(
        { success: false, error: 'Please paste a valid Refresh Token, Authorization Code, or Redirect URL.' },
        { status: 400 }
      );
    }

    const { clientId, clientSecret } = await getGoogleTasksClientAsync();
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { success: false, error: 'GOOGLE_TASKS_CLIENT_ID or GOOGLE_TASKS_CLIENT_SECRET is missing on server.' },
        { status: 500 }
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      OAUTH_PLAYGROUND_REDIRECT
    );

    let finalRefreshToken = rawInput.replace(/^["']|["']$/g, '').trim();

    // Check if the user pasted the full redirect URL (e.g. https://developers.google.com/oauthplayground/?code=4/0A...)
    if (finalRefreshToken.includes('code=')) {
      try {
        const url = new URL(finalRefreshToken);
        const extractedCode = url.searchParams.get('code');
        if (extractedCode) {
          finalRefreshToken = extractedCode;
        }
      } catch {
        const match = finalRefreshToken.match(/[?&]code=([^&]+)/);
        if (match && match[1]) {
          finalRefreshToken = decodeURIComponent(match[1]);
        }
      }
    }

    // If the input is an OAuth Authorization Code (typically starts with "4/"), exchange it for a refresh_token
    if (finalRefreshToken.startsWith('4/') || !finalRefreshToken.startsWith('1//')) {
      try {
        const { tokens } = await oauth2Client.getToken(finalRefreshToken);
        if (tokens.refresh_token) {
          finalRefreshToken = tokens.refresh_token;
        } else if (!finalRefreshToken.startsWith('1//')) {
          return NextResponse.json(
            {
              success: false,
              error:
                'Google did not return a refresh_token for that authorization code. Make sure you clicked the authorization link and approved access.',
            },
            { status: 400 }
          );
        }
      } catch (exchangeErr: unknown) {
        if (!finalRefreshToken.startsWith('1//')) {
          const msg = exchangeErr instanceof Error ? exchangeErr.message : String(exchangeErr);
          return NextResponse.json(
            {
              success: false,
              error: `Failed to exchange authorization code: ${msg}. Please generate a fresh code or paste a Refresh Token (1//...).`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Verify that the refresh token works with Google Tasks API
    oauth2Client.setCredentials({ refresh_token: finalRefreshToken });
    const testTasksApi = google.tasks({ version: 'v1', auth: oauth2Client });
    const listRes = await testTasksApi.tasklists.list({ maxResults: 10 });

    // Save to Supabase (__system_google_tasks_token__) and local .env.local
    await saveGoogleTasksRefreshToken(finalRefreshToken);

    return NextResponse.json({
      success: true,
      tasklistsCount: listRes.data.items?.length || 0,
      message: 'Google Tasks reconnected and saved to cloud! Syncing missing tasks now...',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: `Google Tasks verification failed: ${msg}`,
      },
      { status: 400 }
    );
  }
}
