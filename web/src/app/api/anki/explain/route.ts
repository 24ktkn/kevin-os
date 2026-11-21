import { NextRequest, NextResponse } from 'next/server';
import { stripClozeMarkup } from '@/lib/anki-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];

type TutorMode = 'hint' | 'explain' | 'differentials' | 'vignette' | 'mnemonic' | 'chat';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'GEMINI_API_KEY is not configured.' },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      mode?: TutorMode;
      revealed?: boolean;
      question?: string;
      history?: Array<{ role: 'user' | 'assistant'; text: string }>;
      card?: {
        deck_name?: string;
        model_name?: string;
        front_text?: string;
        back_text?: string;
        extra_text?: string;
        tags?: string[];
      };
    };

    const card = body.card;
    if (!card || (!card.front_text && !card.back_text)) {
      return NextResponse.json(
        { success: false, error: 'Card content is required.' },
        { status: 400 }
      );
    }

    const mode: TutorMode = body.mode || (body.question ? 'chat' : 'explain');
    const revealed = Boolean(body.revealed);
    const cleanFront = stripClozeMarkup(card.front_text || '');
    const cleanBack = stripClozeMarkup(card.back_text || '');
    const cleanExtra = stripClozeMarkup(card.extra_text || '');

    const cardContext = [
      `Deck: ${card.deck_name || 'Schulich'}`,
      `Type: ${card.model_name || 'Cloze'}`,
      `Front / Full Text: ${cleanFront}`,
      cleanBack && cleanBack !== cleanFront ? `Back: ${cleanBack}` : '',
      cleanExtra ? `Extra Notes: ${cleanExtra}` : '',
      Array.isArray(card.tags) && card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    let taskInstruction = '';
    if (mode === 'hint' || (!revealed && mode !== 'chat')) {
      taskInstruction =
        'Give a short, helpful conceptual HINT (1-2 sentences) to jog recall WITHOUT giving away the exact cloze/answer word(s).';
    } else if (mode === 'explain') {
      taskInstruction =
        'Explain the underlying pathophysiology/mechanism and clinical significance clearly and concisely (3-5 bullet points max) for a medical student.';
    } else if (mode === 'differentials') {
      taskInstruction =
        'Compare this concept against the 2-3 most commonly confused look-alike diseases, drugs, or lab findings, highlighting the key distinguishing exam clue for each.';
    } else if (mode === 'vignette') {
      taskInstruction =
        'Write a crisp 2-3 sentence USMLE/MCCQE-style clinical vignette demonstrating how this concept presents in a real patient, followed by a 1-sentence takeaway linking back to the card.';
    } else if (mode === 'mnemonic') {
      taskInstruction =
        'Provide a punchy, memorable medical mnemonic or conceptual anchor so this fact sticks permanently, plus a 1-line explanation of how it maps to the card.';
    } else {
      const historyText = (body.history || [])
        .slice(-6)
        .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text}`)
        .join('\n');
      taskInstruction = `${
        historyText ? `PREVIOUS CONVERSATION:\n${historyText}\n\n` : ''
      }STUDENT QUESTION: ${body.question || 'Explain this card.'}\n${
        !revealed
          ? 'Note: The student has NOT revealed the card answer yet — avoid directly spoiling the hidden cloze word unless they explicitly asked for the answer.'
          : ''
      }\nAnswer directly, concisely, and accurately at a medical-school level.`;
    }

    const prompt = `You are a high-yield medical school AI tutor embedded inside Kevin-OS Anki Reviewer for a Western University (Schulich) MD student.

ACTIVE FLASHCARD:
${cardContext}

TASK:
${taskInstruction}

Return ONLY a raw JSON object with this exact schema:
{
  "reply": "Clear, concise, scannable plain-text/markdown response (avoid long filler intros)",
  "concisePearl": "A 1-2 sentence ultra-high-yield clinical pearl summarizing the key point (suitable to append to the Anki card's Extra field)"
}`;

    for (const model of GEMINI_MODELS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.25,
                responseMimeType: 'application/json',
              },
            }),
            signal: controller.signal,
          }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned) as { reply?: string; concisePearl?: string };
        if (parsed?.reply) {
          return NextResponse.json({
            success: true,
            mode,
            reply: String(parsed.reply).trim(),
            concisePearl: String(parsed.concisePearl || parsed.reply).trim(),
          });
        }
      } catch {
        // fallback to next model
      } finally {
        clearTimeout(timer);
      }
    }

    return NextResponse.json(
      { success: false, error: 'Gemini AI Tutor timed out — please try again.' },
      { status: 502 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'AI Tutor failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
