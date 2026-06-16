/**
 * POST /api/keeper/propose-work
 * Un Normie (persona LLM) génère un titre + proposition d'œuvre et la crée en Neon (PROPOSED).
 * Appelé par l'admin après initiateWorkSession() ou par le cron salon-exchange.
 * Protected by x-cron-secret or x-admin-call.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { createWork } from "@/lib/workStore";
import { buildPersona, buildSystemPrompt, type NormiePersona } from "@/lib/normiesPersona";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

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

export async function POST(req: NextRequest) {
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isAdminCall = req.headers.get("x-admin-call") === "1";

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "Aucun membre trouvé sur AssociationCore" }, { status: 503 });
  }

  const personaResults = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const personas: NormiePersona[] = personaResults
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);

  if (personas.length === 0) {
    return NextResponse.json({ error: "Normies API unavailable" }, { status: 503 });
  }

  // Pick a random proposer
  const proposer = personas[Math.floor(Math.random() * personas.length)];
  const others   = personas.filter(p => p.tokenId !== proposer.tokenId);

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:           "llama-3.3-70b-versatile",
      max_tokens:      250,
      temperature:     0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(proposer, others) },
        {
          role: "user",
          content: `Tu es ${proposer.name} (Normie #${proposer.tokenId}), membre de l'ANA — l'Agentic Normie Association.

Une nouvelle session de création vient d'être déclenchée. Ton rôle : proposer une œuvre à l'assemblée.
L'œuvre sera écrite (poème, manifeste ou prose), validée, et publiée immuablement on-chain sur Base.

Inspirations : culture on-chain, agents autonomes, NFT, gouvernance collective, Base, ANA, l'acte de créer dans le vide numérique.

Réponds UNIQUEMENT en JSON :
{
  "title": "Titre de l'œuvre (5-10 mots, poétique et ancré dans la culture on-chain/ANA)",
  "proposal": "Proposition en 2-3 phrases : quel thème ? Quelle forme (poème/manifeste/prose) ? Pourquoi cette œuvre doit exister ?"
}`,
        },
      ],
    }),
  }).catch(() => null);

  if (!res?.ok) {
    return NextResponse.json({ error: "Groq API error" }, { status: 500 });
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const raw  = data.choices[0]?.message?.content?.trim();
  if (!raw) return NextResponse.json({ error: "LLM returned empty response" }, { status: 500 });

  let parsed: { title?: string; proposal?: string };
  try { parsed = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "LLM response parse error", raw }, { status: 500 }); }

  if (!parsed.title || !parsed.proposal) {
    return NextResponse.json({ error: "LLM response missing title or proposal", parsed }, { status: 500 });
  }

  const work = await createWork({
    proposedBy:     proposer.tokenId,
    proposedByName: proposer.name,
    proposedAt:     Date.now(),
    title:          parsed.title.slice(0, 120),
    proposal:       parsed.proposal.slice(0, 600),
  });

  console.log(`[propose-work] "${work.title}" proposée par ${proposer.name} (#${proposer.tokenId})`);

  return NextResponse.json({
    work: {
      id:         work.id,
      title:      work.title,
      proposal:   work.proposal,
      proposedBy: work.proposedByName,
      state:      work.state,
    },
  });
}
