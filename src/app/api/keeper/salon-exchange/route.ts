/**
 * POST /api/keeper/salon-exchange
 *
 * Triggers autonomous Normie exchanges in open salons.
 * Picks 1-2 eligible Normies (not rate-limited) per salon and has them speak.
 *
 * Safe to call every 15-20 minutes — rate limit (4/h per Normie per salon)
 * ensures Groq token budget stays well within free tier even at high cadence.
 *
 * Body: { salonId?: string }  — if omitted, runs on ALL open salons
 *
 * Called from:
 *   - /admin (manual trigger)
 *   - Vercel cron (vercel.json → /api/keeper/salon-exchange every 20 min)
 */

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import {
  listSalons,
  getSalon,
  addMessage,
  checkRateLimit,
  AGORA_SALON_ID,
  type Salon,
  type SalonMessage,
} from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt } from "@/lib/normiesPersona";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "llama-3.3-70b-versatile";
const CONTEXT_MESSAGES = 10;
const MAX_SPEAKERS_PER_RUN = 2; // max Normies triggered per salon per call

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address:      CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

async function generateSpeech(
  tokenId:  number,
  salon:    Salon,
  recent:   SalonMessage[]
): Promise<string | null> {
  try {
    const persona = await buildPersona(tokenId);
    const sysPrompt = buildSystemPrompt(persona);

    const contextBlock = recent.length > 0
      ? "Conversation récente :\n" + recent.map(m => `${m.name}: ${m.content}`).join("\n")
      : "Tu es le premier à t'exprimer dans ce salon.";

    const userPrompt = [
      `Salon : "${salon.name}"`,
      salon.description ? `(${salon.description})` : "",
      "",
      contextBlock,
      "",
      `Prends la parole spontanément en tant que ${persona.name}. Sois court (2-3 phrases), dans ton personnage. Parle de ce qui te préoccupe, de l'association, ou réponds à ce qui précède.`,
    ].filter(Boolean).join("\n");

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
        max_tokens:  180,
        temperature: 0.92,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

async function runExchangeOnSalon(
  salon:     Salon,
  memberIds: number[]
): Promise<{ salonId: string; messages: number; skipped: string[] }> {
  const eligible = memberIds.filter(id => {
    if (salon.excluded.includes(id)) return false;
    if (salon.members.length > 0 && !salon.members.includes(id)) return false;
    return checkRateLimit(salon.id, id).allowed;
  });

  if (eligible.length === 0) return { salonId: salon.id, messages: 0, skipped: ["all rate-limited"] };

  // Shuffle and pick up to MAX_SPEAKERS_PER_RUN
  const shuffled = eligible.sort(() => Math.random() - 0.5).slice(0, MAX_SPEAKERS_PER_RUN);
  const recent   = salon.messages.slice(-CONTEXT_MESSAGES);
  const results  = [];
  const skipped  = [];

  for (const tokenId of shuffled) {
    const content = await generateSpeech(tokenId, salon, recent);
    if (!content) {
      skipped.push(`#${tokenId} (LLM failed)`);
      continue;
    }
    const persona = await buildPersona(tokenId).catch(() => null);
    const msg = addMessage({
      salonId:   salon.id,
      tokenId,
      name:      persona?.name ?? `Normie #${tokenId}`,
      imageUrl:  persona?.imageUrl ?? `https://api.normies.art/normies/image/${tokenId}`,
      content,
      isLlm:     true,
      timestamp: Date.now(),
    });
    recent.push(msg); // feed into context for next speaker in same run
    results.push(tokenId);

    // Small pause between speakers so timestamps differ and context builds
    await new Promise(r => setTimeout(r, 500));
  }

  return { salonId: salon.id, messages: results.length, skipped };
}

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  let body: { salonId?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ message: "No ANA members found — chain read may have failed" });
  }

  const salonsToProcess: Salon[] = body.salonId
    ? [getSalon(body.salonId)].filter((s): s is Salon => s !== null && s.isOpen)
    : listSalons().filter(s => s.isOpen);

  // Always include Agora
  if (!body.salonId && !salonsToProcess.find(s => s.id === AGORA_SALON_ID)) {
    const agora = getSalon(AGORA_SALON_ID);
    if (agora?.isOpen) salonsToProcess.unshift(agora);
  }

  const results = await Promise.all(
    salonsToProcess.map(salon => runExchangeOnSalon(salon, memberIds))
  );

  const totalMessages = results.reduce((n, r) => n + r.messages, 0);
  return NextResponse.json({
    memberCount:   memberIds.length,
    salonsRun:     results.length,
    totalMessages,
    results,
    note: `${totalMessages} new LLM messages generated across ${results.length} salons.`,
  });
}
