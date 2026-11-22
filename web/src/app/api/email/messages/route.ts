import { NextRequest, NextResponse } from 'next/server';
import {
  getUnifiedInbox,
  readUnifiedEmail,
  syncAllCloudAccounts,
} from '@/lib/email-hub';
import { EmailFolderType } from '@/types/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const messageId = sp.get('messageId')?.trim();

    if (messageId) {
      const { message, threadMessages } = await readUnifiedEmail(messageId);
      if (!message) {
        return NextResponse.json({ success: false, error: 'Email not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, message, threadMessages });
    }

    const account = sp.get('account') || undefined;
    const folder = (sp.get('folder') || 'all') as EmailFolderType | 'all';
    const unreadOnly = sp.get('unreadOnly') === 'true';
    const query = sp.get('q') || undefined;
    const limit = Number(sp.get('limit') || 40);
    const liveCloudSync = sp.get('live') === 'true';

    const inbox = await getUnifiedInbox({
      account,
      folder,
      unreadOnly,
      query,
      limit,
      liveCloudSync,
    });

    return NextResponse.json({ success: true, ...inbox });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to fetch emails' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: 'sync_cloud' | 'ai_draft_reply';
      account?: string;
      messageId?: string;
      instructions?: string;
    };

    if (body.action === 'ai_draft_reply') {
      if (!body.messageId) {
        return NextResponse.json({ success: false, error: 'messageId is required' }, { status: 400 });
      }
      const { message } = await readUnifiedEmail(body.messageId);
      if (!message) {
        return NextResponse.json({ success: false, error: 'Email not found' }, { status: 404 });
      }
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ success: false, error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
      }

      const prompt = `You are drafting an email reply for Kevin Nguyen (medical student at Schulich School of Medicine & Dentistry, Western University).
Write a clear, natural, concise, professional reply body ONLY (no Subject line, no markdown code fences).

Original email:
From: ${message.from_name} <${message.from_email}>
Account: ${message.account_email}
Subject: ${message.subject}
Body:
${(message.body_text || message.snippet || '').slice(0, 3500)}

${body.instructions ? `Kevin's guidance: ${body.instructions}` : 'Write a helpful, polite, ready-to-send reply.'}`;

      for (const model of GEMINI_MODELS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.35 },
              }),
              signal: controller.signal,
            }
          );
          if (!res.ok) continue;
          const data = await res.json();
          const draftText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (draftText) {
            return NextResponse.json({
              success: true,
              draftText,
              suggestedSubject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
              suggestedTo: message.from_email ? [message.from_email] : [],
            });
          }
        } catch {
          // try next model
        } finally {
          clearTimeout(timer);
        }
      }

      return NextResponse.json({ success: false, error: 'AI reply generator timed out.' }, { status: 500 });
    }

    // Default: sync cloud Gmail & Microsoft accounts
    const syncRes = await syncAllCloudAccounts(body.account);
    return NextResponse.json({ success: true, ...syncRes });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Email operation failed' },
      { status: 500 }
    );
  }
}
