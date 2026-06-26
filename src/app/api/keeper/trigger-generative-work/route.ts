/**
 * POST /api/keeper/trigger-generative-work
 *
 * Admin-only: creates ONE work pre-pinned to a generative HTML/JS form
 * (html-canvas | html-p5js | html-threejs | html-webgl picked at random,
 * or a specific one via body.artForm) and pushes it straight to BRIEFING —
 * skipping the public vote, since this is a manual one-off generative
 * commission, not a full assembly proposal.
 *
 * Does NOT create poems or any other content type. The actual generation
 * happens on the next /api/keeper/work-lifecycle tick (stepBriefing then
 * stepCreating), same pipeline and same validation as every other work —
 * this route only seeds the work and assigns roles.
 *
 * Protected by a wallet-signed admin proof (same convention as work-lifecycle).
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ROLES, ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { createWork } from "@/lib/workStore";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { addMessage, AGORA_SALON_ID } from "@/lib/salonStore";
import { GENERATIVE_FORMS, type GenerativeForm } from "@/lib/generativeArtwork";

const CORE = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address:      CORE,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

async function getElectedRole(roleHash: `0x${string}`): Promise<number | null> {
  if (!CORE) return null;
  try {
    const r = await client.readContract({
      address: CORE, abi: ASSOCIATION_CORE_ABI,
      functionName: "getRoleHolder", args: [roleHash],
    }) as { tokenId: bigint; holderAddress: string };
    if (!r || r.holderAddress === ZERO || r.tokenId <= 0n) return null;
    return Number(r.tokenId);
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const { ok: isAdminCall } = await verifyAdminRequest(req);
  if (!isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — a valid admin signature is required" }, { status: 401 });
  }
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  let body: { artForm?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const requestedForm = body.artForm;
  const artForm: GenerativeForm = (GENERATIVE_FORMS as readonly string[]).includes(requestedForm ?? "")
    ? (requestedForm as GenerativeForm)
    : GENERATIVE_FORMS[Math.floor(Math.random() * GENERATIVE_FORMS.length)];

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "Normies API/contract unavailable — no members found" }, { status: 503 });
  }

  const personaResults = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const personas: NormiePersona[] = personaResults
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);
  if (personas.length === 0) {
    return NextResponse.json({ error: "Could not build any Normie persona" }, { status: 503 });
  }

  // Prefer the elected bureau roles; fall back to distinct random members.
  const [electedAuthor, electedCurator, electedRapporteur] = await Promise.all([
    getElectedRole(ROLES.AUTHOR as `0x${string}`),
    getElectedRole(ROLES.CURATOR as `0x${string}`),
    getElectedRole(ROLES.RAPPORTEUR as `0x${string}`),
  ]);

  const findOrFallback = (tokenId: number | null, exclude: number[]): NormiePersona => {
    if (tokenId != null) {
      const found = personas.find(p => p.tokenId === tokenId);
      if (found) return found;
    }
    const pool = personas.filter(p => !exclude.includes(p.tokenId));
    return pool[Math.floor(Math.random() * pool.length)] ?? personas[0];
  };

  const author     = findOrFallback(electedAuthor, []);
  const curator    = findOrFallback(electedCurator, [author.tokenId]);
  const rapporteur = findOrFallback(electedRapporteur, [author.tokenId, curator.tokenId]);

  const title = `Generative Study #${Date.now().toString(36)}`;
  const proposal = `A standalone generative HTML/JS artwork (${artForm}), commissioned directly through the admin panel — no assembly vote, single Author/Curator/Rapporteur assignment.`;
  const brief = `Create a ${artForm.replace("html-", "")} generative visual artwork that embodies the collective identity of ANA's Normies. Be bold, abstract, alive — continuous motion, no static frame. Dark palette by default.`;

  const work = await createWork(
    {
      proposedBy:        rapporteur.tokenId,
      proposedByName:    rapporteur.name,
      proposedAt:        Date.now(),
      title,
      proposal,
      suggestedForm:     artForm,
      rapporteurTokenId: rapporteur.tokenId,
      rapporteurName:    rapporteur.name,
      authorTokenId:     author.tokenId,
      authorName:        author.name,
      curatorTokenId:    curator.tokenId,
      curatorName:       curator.name,
      artForm,
      brief,
      briefAt:           Date.now(),
      salonId:           AGORA_SALON_ID,
    },
    "CREATING",
  );

  await addMessage({
    salonId:   AGORA_SALON_ID,
    tokenId:   rapporteur.tokenId,
    name:      rapporteur.name,
    imageUrl:  rapporteur.imageUrl ?? "",
    content:   `📋 Admin-commissioned generative artwork "${title}" (${artForm}) — ${author.name} (Author) will create it, ${curator.name} (Curator) will validate it.`,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "art",
  }).catch(() => null);

  return NextResponse.json({
    work: {
      id: work.id, title: work.title, artForm, state: work.state,
      authorName: author.name, curatorName: curator.name, rapporteurName: rapporteur.name,
    },
    next: "Call /api/keeper/work-lifecycle (or click 'Déclencher work-lifecycle') to advance it through CREATING → VALIDATING → PUBLISHING → PUBLISHED.",
  });
}
