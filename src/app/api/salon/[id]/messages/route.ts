/**
 * GET  /api/salon/[id]/messages?since=<ms>   — poll new messages
 * POST /api/salon/[id]/messages              — Normie sends a message (triggers LLM)
 *
 * POST body: { tokenId: number, trigger?: string }
 *   trigger: optional context for the LLM (e.g. "@normie5 qu'en penses-tu ?")
 *            if omitted, Normie speaks freely based on recent conversation context.
 *
 * Flow:
 *   1. Verify tokenId is ANA member and not excluded from salon
 *   2. Check rate limit (MAX_MESSAGES_PER_HOUR LLM messages per Normie per salon)
 *   3. Fetch persona (systemPrompt from normie.art)
 *   4. Build context from last N messages
 *   5. Call Groq → non-streaming (max 200 tokens per message for salon brevity)
 *   6. Store and return the message
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getSalon, getMessages, addMessage, checkRateLimit } from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt } from "@/lib/normiesPersona";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "llama-3.3-70b-versatile";
const CONTEXT_MESSAGES = 12; // last N messages fed to LLM for context

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address: CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:     ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const since  = Number(req.nextUrl.searchParams.get("since") ?? "0");
  const msgs   = getMessages(params.id, since || undefined);
  return NextResponse.json({ messages: msgs });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  let body: { tokenId?: number; trigger?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { tokenId, trigger } = body;
  if (!tokenId) return NextResponse.json({ error: "tokenId required" }, { status: 400 });

  // Verify salon exists and is open
  const salon = getSalon(params.id);
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  if (!salon.isOpen) return NextResponse.json({ error: "Salon is closed" }, { status: 410 });

  // Verify member access
  if (salon.excluded.includes(tokenId)) {
    return NextResponse.json({ error: "You have been excluded from this salon" }, { status: 403 });
  }
  if (salon.members.length > 0 && !salon.members.includes(tokenId)) {
    return NextResponse.json({ error: "This salon is invite-only" }, { status: 403 });
  }

  // Verify ANA membership
  const memberIds = await getMemberIds();
  if (!memberIds.includes(tokenId)) {
    return NextResponse.json({ error: "Only ANA members can speak in salons" }, { status: 403 });
  }

  // Rate limit check
  const rateCheck = checkRateLimit(params.id, tokenId);
  if (!rateCheck.allowed) {
    const minutes = Math.ceil((rateCheck.retryAfterMs ?? 0) / 60_000);
    return NextResponse.json(
      { error: `Rate limit — you can speak again in ~${minutes} min (${4}/h max)` },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000)) } }
    );
  }

  // Build persona
  const persona = await buildPersona(tokenId).catch(() => null);
  const sysPrompt = persona
    ? buildSystemPrompt(persona)
    : `Tu es Normie #${tokenId}, un membre de l'ANA. Réponds en 2-3 phrases, en restant dans ton personnage.`;

  // Build conversation context from recent messages
  const recent = getMessages(params.id).slice(-CONTEXT_MESSAGES);
  const contextBlock = recent.length > 0
    ? "Conversation récente du salon :\n" + recent
        .map(m => `${m.name}: ${m.content}`)
        .join("\n")
    : "Tu es le premier à parler dans ce salon.";

  const salonContext = [
    `Salon : "${salon.name}"`,
    salon.description ? `Description : ${salon.description}` : null,
  ].filter(Boolean).join("\n");

  const userPrompt = [
    salonContext,
    "",
    contextBlock,
    "",
    trigger
      ? `Contexte supplémentaire : ${trigger}\n\nRéponds maintenant en tant que ${persona?.name ?? `Normie #${tokenId}`}.`
      : `Prends la parole maintenant en tant que ${persona?.name ?? `Normie #${tokenId}`}. Sois spontané, fidèle à ton personnage, 2-4 phrases max.`,
  ].filter(s => s !== null).join("\n");

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model:       MODEL,
        messages:    [
          { role: "system", content: sysPrompt },
          { role: "user",   content: userPrompt },
        ],
        max_tokens:  200,
        temperature: 0.9,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Groq ${res.status}: ${err.slice(0, 150)}` }, { status: 502 });
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content?.trim() ?? "(silence)";

    const msg = addMessage({
      salonId:   params.id,
      tokenId,
      name:      persona?.name ?? `Normie #${tokenId}`,
      imageUrl:  persona?.imageUrl ?? `https://api.normies.art/normies/image/${tokenId}`,
      content,
      isLlm:     true,
      timestamp: Date.now(),
    });

    return NextResponse.json({ message: msg });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "Unexpected error",
    }, { status: 500 });
  }
}
