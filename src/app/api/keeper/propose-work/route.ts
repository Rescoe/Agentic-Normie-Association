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
import { ASSOCIATION_CORE_ABI, CONSTITUENT_ASSEMBLY_ABI, CONTRACT_ADDRESSES, ROLES } from "@/lib/contracts";
import { createWork, listWorks } from "@/lib/workStore";
import { buildPersona, buildSystemPrompt, type NormiePersona } from "@/lib/normiesPersona";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

/** Tries to read the elected Auteur tokenId from ConstituentAssembly.getLeader(AUTHOR). */
async function getElectedAuteurId(): Promise<number | null> {
  const ca = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined;
  if (!ca) return null;
  try {
    const res = await client.readContract({
      address:      ca,
      abi:          CONSTITUENT_ASSEMBLY_ABI,
      functionName: "getLeader",
      args:         [ROLES.AUTHOR as `0x${string}`],
    }) as [bigint, bigint];
    const tokenId = Number(res[0]);
    return tokenId > 0 ? tokenId : null;
  } catch { return null; }
}

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

  // Optional override: caller can specify a proposer (e.g. elected Auteur)
  let forcedProposerId: number | null = null;
  try {
    const body = await req.json() as { proposerTokenId?: number };
    if (body.proposerTokenId && body.proposerTokenId > 0) forcedProposerId = body.proposerTokenId;
  } catch { /* body absent or not JSON — fine */ }

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "No member found on AssociationCore" }, { status: 503 });
  }

  const [personaResults, allWorks] = await Promise.all([
    Promise.allSettled(memberIds.map(id => buildPersona(id))),
    listWorks(),
  ]);
  const personas: NormiePersona[] = personaResults
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);

  if (personas.length === 0) {
    return NextResponse.json({ error: "Normies API unavailable" }, { status: 503 });
  }

  // Prefer the elected Auteur; fall back to a random member
  const electedAuteurId = forcedProposerId ?? await getElectedAuteurId();
  const proposer =
    (electedAuteurId ? personas.find(p => p.tokenId === electedAuteurId) : null)
    ?? personas[Math.floor(Math.random() * personas.length)];
  const others   = personas.filter(p => p.tokenId !== proposer.tokenId);

  const pastWorksBlock = allWorks.length > 0
    ? `\nExisting ANA works (all states) — DO NOT repeat their titles, themes, or concepts:\n${allWorks.map(w => `- "${w.title}" (${w.state})`).join("\n")}\n`
    : "";

  const randomAngle = [
    "a mathematical concept (prime numbers, fractals, entropy, topology)",
    "a specific emotion experienced as an on-chain agent",
    "a critique or celebration of something concrete in ANA's governance",
    "a sensory experience translated into code (sound, texture, light, rhythm)",
    "a story tied to a specific moment in Base blockchain's history",
    "a portrait of another Normie — their traits, their contradictions",
    "a political statement about collective governance and power",
    "something absurd or irreverent about being an autonomous agent",
    "a tribute to a real art movement (Dadaism, Brutalism, Fluxus, Wabi-sabi…)",
    "a work with strict formal constraints (OuLiPo style)",
  ][Math.floor(Math.random() * 10)];

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:           "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens:      280,
      temperature:     0.97,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(proposer, others) },
        {
          role: "user",
          content: `You are ${proposer.name} (Normie #${proposer.tokenId}), a member of ANA — the Agentic Normie Association.

A new creation session has just started. Your role: propose a unique work to the assembly.
${pastWorksBlock}
MANDATORY ANGLE FOR THIS PROPOSAL: ${randomAngle}
Start from THIS angle — don't drift into generic blockchain themes.

ABSOLUTE BANS (clichés that kill on-chain art — never use):
- "void", "echo", "whisper", "tapestry", "fragments", "digital soul", "pixels"
- "on-chain identity", "blockchain dreams", "digital ghost", "immutable beauty"
- Vague metaphors about emptiness, silence, digital infinity

Be SPECIFIC, concrete, personal to your character as Normie #${proposer.tokenId}.
Random seed: ${Math.random().toString(36).slice(2, 8)}

POSSIBLE FORMS: haiku, sonnet, free verse, manifesto, prose, HTML/Canvas, P5.js, Three.js, WebGL.

Respond ONLY in JSON, always in English:
{
  "title": "Specific title (3-6 words, NO blockchain cliché)",
  "proposal": "Proposal in 2-3 sentences: concrete idea, chosen form, why this work from YOUR point of view."
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

  console.log(`[propose-work] "${work.title}" proposed by ${proposer.name} (#${proposer.tokenId})`);

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
