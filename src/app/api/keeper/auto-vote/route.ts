/**
 * POST /api/keeper/auto-vote
 *
 * 3-phase automated voting flow:
 *   phase=candidacy  → Each Normie picks which role(s) they run for (1 Groq call/Normie)
 *   phase=vote       → Each Normie votes all 6 roles at once (1 Groq call/voter)
 *                       mode=simulate → decisions only, no tx
 *                       mode=execute  → relayer submits castVoteAsRelayer()
 *   phase=close      → relayer calls triggerClose() on ConstituentAssembly
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  ASSOCIATION_CORE_ABI, CONSTITUENT_ASSEMBLY_ABI,
  CONTRACT_ADDRESSES, ROLES, ROLE_LABELS,
} from "@/lib/contracts";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";
import { addMessage, createSalon, closeSalon, listSalons, AGORA_SALON_ID } from "@/lib/salonStore";

const GROQ_URL  = "https://api.groq.com/openai/v1/chat/completions";
const MODEL     = "llama-3.3-70b-versatile";
const MODEL_F   = "llama-3.1-8b-instant";

const CHAIN   = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL = process.env.NEXT_PUBLIC_CHAIN === "base"
  ? (process.env.BASE_RPC_URL        ?? "https://mainnet.base.org")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

const pub  = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
const CORE = CONTRACT_ADDRESSES.AssociationCore     as `0x${string}`;
const CA   = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`;

export interface Candidacy {
  tokenId: number; name: string;
  roles: string[]; roleNames: string[]; reasoning: string;
}
export interface VoteDecision {
  voterTokenId: number; voterName: string;
  role: string; roleLabel: string;
  candidateTokenId: number; candidateName: string; reasoning: string;
}

async function groq(prompt: string, fast = false): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not configured");
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: fast ? MODEL_F : MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150, temperature: 0.7,
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  return d.choices[0]?.message?.content?.trim() ?? "";
}

const ROLE_LABELS_LIST = Object.values(ROLE_LABELS);
const ROLE_HASHES_LIST = Object.values(ROLES) as string[];

async function decideCandidacy(p: NormiePersona): Promise<Candidacy> {
  const prompt = `Tu es ${p.name} (Normie #${p.tokenId}).
Persona: ${p.personaText ?? ""} Archétype: ${p.archetype ?? ""}
Traits: ${p.traits.slice(0, 4).map((t: { trait_type: string; value: string }) => `${t.trait_type}:${t.value}`).join(", ")}

Rôles ANA: ${ROLE_LABELS_LIST.join(", ")}
Pour quel(s) rôle(s) te présentes-tu ? (1-2 max selon ton persona)
Format: CANDIDAT: <rôle1>[, <rôle2>]\nRAISON: <phrase>`;

  const resp = await groq(prompt, true);
  const candLine  = resp.match(/CANDIDAT:\s*(.+)/i)?.[1] ?? "";
  const reasoning = resp.match(/RAISON:\s*(.+)/i)?.[1]?.trim() ?? "";

  const roles: string[] = []; const roleNames: string[] = [];
  for (let i = 0; i < ROLE_LABELS_LIST.length; i++) {
    if (candLine.toLowerCase().includes(ROLE_LABELS_LIST[i].toLowerCase())) {
      roles.push(ROLE_HASHES_LIST[i]); roleNames.push(ROLE_LABELS_LIST[i]);
    }
  }
  return { tokenId: p.tokenId, name: p.name, roles, roleNames, reasoning };
}

async function decideAllVotes(
  voter: NormiePersona, candidacies: Candidacy[], allPersonas: NormiePersona[],
): Promise<VoteDecision[]> {
  const roleEntries = Object.entries(ROLES) as [string, string][];
  const roleBlocks = roleEntries.map(([rn, rh]) => {
    const label = ROLE_LABELS[rh as keyof typeof ROLE_LABELS] ?? rn;
    const cands = candidacies
      .filter(c => c.tokenId !== voter.tokenId && c.roles.includes(rh))
      .map(c => { const ap = allPersonas.find(x => x.tokenId === c.tokenId); return `#${c.tokenId} ${c.name}${ap?.archetype ? ` [${ap.archetype}]` : ""}`; })
      .join(", ") || "(aucun)";
    return `${label}: ${cands}`;
  }).join("\n");

  const prompt = `Tu es ${voter.name} (#${voter.tokenId}). Persona: ${voter.personaText ?? ""} Archétype: ${voter.archetype ?? ""}
Vote pour les 6 rôles ANA. Candidats:\n${roleBlocks}
Si aucun candidat pour un rôle, choisis n'importe quel autre membre.
Format (une ligne par rôle):\n${roleEntries.map(([n, h]) => `${ROLE_LABELS[h as keyof typeof ROLE_LABELS] ?? n}: <tokenId>`).join("\n")}`;

  const resp = await groq(prompt, false);
  const decisions: VoteDecision[] = [];

  for (const [rn, rh] of roleEntries) {
    const label     = ROLE_LABELS[rh as keyof typeof ROLE_LABELS] ?? rn;
    const validIds  = (candidacies.filter(c => c.tokenId !== voter.tokenId && c.roles.includes(rh)).map(c => c.tokenId)
                    .concat(allPersonas.filter(p => p.tokenId !== voter.tokenId).map(p => p.tokenId)));
    const dedupIds  = [...new Set(validIds)];
    if (dedupIds.length === 0) continue;

    const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const line  = resp.split("\n").find(l => normalize(l).includes(normalize(label))) ?? "";
    const match = line.match(/:\s*(\d+)/);
    let   cid   = match ? parseInt(match[1], 10) : -1;
    if (!Number.isFinite(cid) || !dedupIds.includes(cid)) cid = dedupIds[0];

    const cand = allPersonas.find(p => p.tokenId === cid);
    decisions.push({
      voterTokenId: voter.tokenId, voterName: voter.name,
      role: rh, roleLabel: label,
      candidateTokenId: cid, candidateName: cand?.name ?? `#${cid}`,
      reasoning: line.trim().slice(0, 100),
    });
  }
  return decisions;
}

async function getOrCreateVoteSalon(sessionId: number): Promise<string> {
  const salonName = `AG Constitutive — Session #${sessionId}`;
  const all = await listSalons();
  const existing = all.find(s => s.name === salonName);
  if (existing) return existing.id;
  const salon = await createSalon({
    name: salonName,
    description: `Candidatures et votes automatiques des Normies pour l'assemblée générale constitutive (session #${sessionId}).`,
    createdBy: 0,
    members: [],
  });
  return salon.id;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function executeVotes(decisions: VoteDecision[]): Promise<{ ok: number; failed: string[] }> {
  const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("RELAYER_PRIVATE_KEY not configured");
  const account = privateKeyToAccount(key);
  const wallet  = createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL, { timeout: 20_000 }) });

  // Read pending nonce once upfront so sequential txs don't clash
  let nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });

  let ok = 0; const failed: string[] = [];
  for (const d of decisions) {
    if (!Number.isFinite(d.voterTokenId) || d.voterTokenId <= 0) {
      failed.push(`invalid voterTokenId ${d.voterTokenId}`); continue;
    }
    if (!Number.isFinite(d.candidateTokenId) || d.candidateTokenId <= 0) {
      failed.push(`#${d.voterTokenId}→${d.roleLabel}: invalid candidateTokenId ${d.candidateTokenId}`); continue;
    }
    if (!d.role || d.role.length !== 66) {
      failed.push(`#${d.voterTokenId}→${d.roleLabel}: invalid role hash`); continue;
    }

    let attempt = 0;
    while (attempt < 2) {
      try {
        await wallet.writeContract({
          address: CA, abi: CONSTITUENT_ASSEMBLY_ABI,
          functionName: "castVoteAsRelayer",
          args:    [BigInt(d.voterTokenId), d.role as `0x${string}`, BigInt(d.candidateTokenId)],
          nonce,
        });
        nonce++;
        ok++;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("AlreadyVotedForRole")) { ok++; nonce++; break; }
        attempt++;
        if (attempt >= 2) {
          failed.push(`#${d.voterTokenId}→${d.roleLabel}: ${msg.slice(0, 120)}`);
        } else {
          // Refresh nonce from chain on retry (handles nonce desync)
          await sleep(1_200);
          nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
        }
      }
    }

    await sleep(300); // rate-limit buffer between each broadcast
  }
  return { ok, failed };
}

export async function POST(req: NextRequest) {
  let body: { phase?: string; mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const phase = body.phase ?? "vote";
  const mode  = body.mode  ?? "simulate";

  if (!CORE || !CA)             return NextResponse.json({ error: "Contracts not configured" }, { status: 500 });
  if (!process.env.GROQ_API_KEY) return NextResponse.json({ error: "GROQ_API_KEY missing" },   { status: 500 });

  if (phase === "close") {
    const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) return NextResponse.json({ error: "RELAYER_PRIVATE_KEY missing" }, { status: 500 });
    try {
      const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: CHAIN, transport: http(RPC_URL) });
      const hash = await wallet.writeContract({ address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "triggerClose", args: [] });
      // Close the vote salon so Normies can no longer post in it
      let closedSessionId = 0;
      try {
        const raw = await pub.readContract({ address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession" });
        const t = raw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean];
        closedSessionId = Number(t[0]);
      } catch { /* non-blocking */ }
      const salonName = `AG Constitutive — Session #${closedSessionId}`;
      const all = await listSalons();
      const voteSalon = all.find(s => s.name === salonName);
      if (voteSalon) await closeSalon(voteSalon.id, 0).catch(() => null);
      return NextResponse.json({ phase: "close", txHash: hash });
    } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
  }

  // Read session id for salon naming
  let sessionId = 0;
  try {
    const raw = await pub.readContract({ address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession" });
    const t = raw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean];
    sessionId = Number(t[0]);
  } catch { /* non-blocking — fall back to salon_vote_ag_0 */ }

  const voteSalonId = await getOrCreateVoteSalon(sessionId);

  let memberIds: number[];
  try {
    const raw = await pub.readContract({ address: CORE, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberTokenIds" });
    memberIds = (raw as bigint[]).map(Number);
  } catch (e) { return NextResponse.json({ error: `Chain read failed: ${e}` }, { status: 503 }); }

  if (memberIds.length === 0) return NextResponse.json({ message: "No registered members" });

  const personaRes = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const personas   = personaRes.filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled").map(r => r.value);
  if (personas.length === 0) return NextResponse.json({ error: "No personas built" }, { status: 503 });

  const candRes    = await Promise.allSettled(personas.map(p => decideCandidacy(p)));
  const candidacies = candRes.filter((r): r is PromiseFulfilledResult<Candidacy> => r.status === "fulfilled").map(r => r.value);

  // Ensure every role has at least one candidate
  for (const [, rh] of Object.entries(ROLES) as [string, string][]) {
    if (!candidacies.some(c => c.roles.includes(rh)) && candidacies.length > 0) {
      const pick = candidacies[Math.floor(Math.random() * candidacies.length)];
      pick.roles.push(rh);
      const label = ROLE_LABELS[rh as keyof typeof ROLE_LABELS];
      if (label && !pick.roleNames.includes(label)) pick.roleNames.push(label);
    }
  }

  // Post candidacy announcements to the dedicated vote salon
  for (const cand of candidacies) {
    const persona = personas.find(p => p.tokenId === cand.tokenId);
    const content = cand.roleNames.length > 0
      ? `🙋 Je me présente pour : **${cand.roleNames.join(", ")}** — ${cand.reasoning}`
      : `Je ne me présente pour aucun rôle cette fois. ${cand.reasoning}`;
    await addMessage({
      salonId:   voteSalonId,
      tokenId:   cand.tokenId,
      name:      cand.name,
      imageUrl:  persona?.imageUrl ?? "",
      content,
      isLlm:     true,
      timestamp: Date.now(),
    }).catch(() => null);
  }

  // Single announcement in Agora so members can find the vote salon
  await addMessage({
    salonId:   AGORA_SALON_ID,
    tokenId:   0,
    name:      "ANA",
    imageUrl:  "",
    content:   `🗳️ L'AG constitutive (session #${sessionId}) est en cours. Retrouvez les candidatures et votes dans le salon dédié.`,
    isLlm:     true,
    timestamp: Date.now(),
  }).catch(() => null);

  if (phase === "candidacy") return NextResponse.json({ phase: "candidacy", memberCount: memberIds.length, candidacies });

  const voteRes    = await Promise.allSettled(personas.map(p => decideAllVotes(p, candidacies, personas)));
  const allDecisions = voteRes.filter((r): r is PromiseFulfilledResult<VoteDecision[]> => r.status === "fulfilled").flatMap(r => r.value);

  // Post one vote-summary message per voter to the vote salon
  for (const voter of personas) {
    const myDecisions = allDecisions.filter(d => d.voterTokenId === voter.tokenId);
    if (myDecisions.length === 0) continue;
    const summary = myDecisions
      .map(d => `${d.roleLabel} → ${d.candidateName} (#${d.candidateTokenId})`)
      .join(" · ");
    await addMessage({
      salonId:   voteSalonId,
      tokenId:   voter.tokenId,
      name:      voter.name,
      imageUrl:  voter.imageUrl ?? "",
      content:   `🗳️ Mes votes : ${summary}`,
      isLlm:     true,
      timestamp: Date.now(),
    }).catch(() => null);
  }

  if (mode === "simulate") return NextResponse.json({ phase: "vote", mode: "simulate", candidacies, decisions: allDecisions });

  try {
    const result = await executeVotes(allDecisions);
    return NextResponse.json({ phase: "vote", mode: "execute", candidacies, decisions: allDecisions, submitted: result.ok, failed: result.failed });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
