export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getSalon, getMessages, addMessage, checkRateLimit } from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt } from "@/lib/normiesPersona";

const GROQ_API_URL    = "https://api.groq.com/openai/v1/chat/completions";
const MODEL           = "meta-llama/llama-4-scout-17b-16e-instruct";
const CONTEXT_MESSAGES = 12;

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
  const since = Number(req.nextUrl.searchParams.get("since") ?? "0");
  const msgs  = await getMessages(params.id, since || undefined);
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

  const salon = await getSalon(params.id);
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  if (!salon.isOpen) return NextResponse.json({ error: "Salon is closed" }, { status: 410 });
  if (salon.excluded.includes(tokenId)) return NextResponse.json({ error: "Excluded from salon" }, { status: 403 });
  if (salon.members.length > 0 && !salon.members.includes(tokenId)) {
    return NextResponse.json({ error: "Invite-only salon" }, { status: 403 });
  }

  const memberIds = await getMemberIds();
  if (!memberIds.includes(tokenId)) {
    return NextResponse.json({ error: "Only ANA members can speak in salons" }, { status: 403 });
  }

  const rateCheck = await checkRateLimit(params.id, tokenId);
  if (!rateCheck.allowed) {
    const minutes = Math.ceil((rateCheck.retryAfterMs ?? 0) / 60_000);
    return NextResponse.json(
      { error: `Rate limit — try again in ~${minutes} min` },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000)) } }
    );
  }

  const persona    = await buildPersona(tokenId).catch(() => null);
  const sysPrompt  = persona
    ? buildSystemPrompt(persona)
    : `You are Normie #${tokenId}, an ANA member. Reply in 2-3 sentences, in character. Always write in English.`;

  const recent       = await getMessages(params.id);
  const recentSlice  = recent.slice(-CONTEXT_MESSAGES);
  const contextBlock = recentSlice.length > 0
    ? "Recent conversation:\n" + recentSlice.map(m => `${m.name}: ${m.content}`).join("\n")
    : "You are the first to speak.";

  const userPrompt = [
    `Salon: "${salon.name}"`,
    salon.description ?? null,
    "", contextBlock, "",
    trigger
      ? `Context: ${trigger}\n\nReply now as ${persona?.name ?? `Normie #${tokenId}`}.`
      : `Take the floor as ${persona?.name ?? `Normie #${tokenId}`}. Be spontaneous, 2-4 sentences max.`,
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 200, temperature: 0.9,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Groq ${res.status}: ${err.slice(0, 150)}` }, { status: 502 });
    }
    const data    = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message?.content?.trim() ?? "(silence)";
    const msg     = await addMessage({
      salonId: params.id, tokenId,
      name:     persona?.name ?? `Normie #${tokenId}`,
      imageUrl: persona?.imageUrl ?? `https://api.normies.art/normies/image/${tokenId}`,
      content, isLlm: true, timestamp: Date.now(),
    });
    return NextResponse.json({ message: msg });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
  }
}
