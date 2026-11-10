import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import {
  getGoogleHealthAccessTokenAsync,
  getGoogleHealthOAuthConfig,
  OAUTH_PLAYGROUND_REDIRECT,
  saveGoogleHealthRefreshToken,
  verifyGoogleHealthToken,
} from '@/lib/google-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { accessToken, hasCredentials, authUrl, error } =
    await getGoogleHealthAccessTokenAsync();

  if (!accessToken || !hasCredentials) {
    return NextResponse.json({
      connected: false,
      authUrl,
      error: error || 'Google Health has not been connected yet.',
    });
  }

  const verification = await verifyGoogleHealthToken(accessToken);
  if (!verification.ok) {
    return NextResponse.json({
      connected: false,
      authUrl,
      error: verification.error || 'Failed to verify Google Health API access.',
    });
  }

  return NextResponse.json({
    connected: true,
    authUrl,
    identity: verification.identity,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawInput = String(body.tokenOrCode || body.refreshToken || '').trim();

    if (!rawInput) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Please paste a valid Redirect URL, Authorization Code (4/0A...), or Refresh Token (1//0...).',
        },
        { status: 400 }
      );
    }

    const { clientId, clientSecret } = getGoogleHealthOAuthConfig();
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        {
          success: false,
          error:
            'GOOGLE_TASKS_CLIENT_ID or GOOGLE_TASKS_CLIENT_SECRET is missing on server.',
        },
        { status: 500 }
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      OAUTH_PLAYGROUND_REDIRECT
    );

    let finalRefreshToken = rawInput.replace(/^["']|["']$/g, '').trim();

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
          const msg =
            exchangeErr instanceof Error ? exchangeErr.message : String(exchangeErr);
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

    oauth2Client.setCredentials({ refresh_token: finalRefreshToken });
    const tokenRes = await oauth2Client.getAccessToken();
    const accessToken = tokenRes?.token;

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'Could not generate an access token from that refresh token.',
        },
        { status: 400 }
      );
    }

    const verification = await verifyGoogleHealthToken(accessToken);
    if (!verification.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Google Health API verification failed: ${verification.error}`,
        },
        { status: 400 }
      );
    }

    await saveGoogleHealthRefreshToken(finalRefreshToken);

    return NextResponse.json({
      success: true,
      identity: verification.identity,
      message: 'Google Health API connected! Syncing your biometrics, sleep & workouts now...',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: `Google Health connection error: ${msg}`,
      },
      { status: 400 }
    );
  }
}
