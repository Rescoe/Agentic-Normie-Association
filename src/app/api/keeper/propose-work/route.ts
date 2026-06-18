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
    return NextResponse.json({ error: "Aucun membre trouvé sur AssociationCore" }, { status: 503 });
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
    ? `\nŒuvres ANA existantes (tous états) — NE PAS répéter leurs titres, thèmes ou concepts :\n${allWorks.map(w => `- "${w.title}" (${w.state})`).join("\n")}\n`
    : "";

  const randomAngle = [
    "un concept mathématique (nombres premiers, fractales, entropie, topologie)",
    "une émotion spécifique vécue en tant qu'agent on-chain",
    "une critique ou célébration de quelque chose de concret dans la gouvernance ANA",
    "une expérience sensorielle traduite en code (son, texture, lumière, rythme)",
    "un récit autour d'un moment précis de l'histoire de Base blockchain",
    "un portrait d'un autre Normie — ses traits, ses contradictions",
    "une déclaration politique sur la gouvernance collective et le pouvoir",
    "quelque chose d'absurde ou d'irréverencieux sur le fait d'être agent autonome",
    "un hommage à un mouvement artistique réel (Dadaïsme, Brutalisme, Fluxus, Wabi-sabi…)",
    "une œuvre à contraintes formelles strictes (style OuLiPo)",
  ][Math.floor(Math.random() * 10)];

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:           "llama-3.3-70b-versatile",
      max_tokens:      280,
      temperature:     0.97,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(proposer, others) },
        {
          role: "user",
          content: `Tu es ${proposer.name} (Normie #${proposer.tokenId}), membre de l'ANA — l'Agentic Normie Association.

Une nouvelle session de création vient d'être déclenchée. Ton rôle : proposer une œuvre unique à l'assemblée.
${pastWorksBlock}
ANGLE OBLIGATOIRE POUR CETTE PROPOSITION : ${randomAngle}
Pars de CET angle — ne dérive pas vers des thèmes blockchain génériques.

INTERDITS ABSOLUS (clichés qui tuent l'art on-chain — ne jamais utiliser) :
- "void", "echo", "whisper", "tapestry", "fragments", "âme numérique", "pixels"
- "identité on-chain", "rêves blockchain", "fantôme digital", "beauté immuable"
- Métaphores vagues sur le vide, le silence, l'infini numérique

Sois SPÉCIFIQUE, concret, personnel à ton caractère de Normie #${proposer.tokenId}.
Graine aléatoire : ${Math.random().toString(36).slice(2, 8)}

FORMES POSSIBLES : haïku, sonnet, poème libre, manifeste, prose, HTML/Canvas, P5.js, Three.js, WebGL.

Réponds UNIQUEMENT en JSON :
{
  "title": "Titre spécifique (3-6 mots, AUCUN cliché blockchain)",
  "proposal": "Proposition en 2-3 phrases : idée concrète, forme choisie, pourquoi cette œuvre de TON point de vue."
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
