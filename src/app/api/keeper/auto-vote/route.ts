/**
 * POST /api/keeper/auto-vote
 *
 * 3-phase automated voting flow:
 *   phase=candidacy  → Each Normie picks which role(s) they run for; posts to vote salon + 1 Agora announcement
 *   phase=vote       → Each Normie votes all 6 roles (JSON LLM output, robust parsing)
 *                       Optionally accepts candidacies[] in body to avoid re-running candidacy
 *                       mode=simulate → decisions only, no tx
 *                       mode=execute  → relayer submits castVoteAsRelayer() sequentially
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
import { verifyAdminRequest } from "@/lib/adminAuth";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "meta-llama/llama-4-scout-17b-16e-instruct";
const MODEL_F  = "llama-3.1-8b-instant";

const CHAIN   = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL = process.env.NEXT_PUBLIC_CHAIN === "base"
  ? (process.env.BASE_RPC_URL        ?? "https://mainnet.base.org")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

const pub  = createPublicClient({ chain: CHAIN, transport: http(RPC_URL, { timeout: 30_000 }) });
const CORE = CONTRACT_ADDRESSES.AssociationCore     as `0x${string}`;
const CA   = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`;

// Ordered role entries — stable order matching ROLES object definition
const ORDERED_ROLE_ENTRIES = (Object.entries(ROLES) as [string, string][]).map(([, hash]) => ({
  hash,
  label: ROLE_LABELS[hash as keyof typeof ROLE_LABELS] ?? hash,
}));

export interface Candidacy {
  tokenId: number; name: string;
  roles: string[]; roleNames: string[]; reasoning: string;
}
export interface VoteDecision {
  voterTokenId: number; voterName: string;
  role: string; roleLabel: string;
  candidateTokenId: number; candidateName: string; reasoning: string;
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

async function groqText(prompt: string, fast = false): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not configured");
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model:      fast ? MODEL_F : MODEL,
      messages:   [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.7,
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  return d.choices[0]?.message?.content?.trim() ?? "";
}

async function groqJson(prompt: string, maxTokens = 200): Promise<Record<string, unknown>> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not configured");
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model:           MODEL,
      messages:        [{ role: "user", content: prompt }],
      max_tokens:      maxTokens,
      temperature:     0.6,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  const raw = d.choices[0]?.message?.content?.trim() ?? "{}";
  try { return JSON.parse(raw); } catch { return {}; }
}

// ─── Candidacy ────────────────────────────────────────────────────────────────

async function decideCandidacy(p: NormiePersona): Promise<Candidacy> {
  const roleList = ORDERED_ROLE_ENTRIES.map(r => r.label).join(", ");
  const prompt   = `You are ${p.name} (Normie #${p.tokenId}).
Persona: ${p.personaText ?? ""} Archetype: ${p.archetype ?? ""}
Traits: ${p.traits.slice(0, 4).map((t: { trait_type: string; value: string }) => `${t.trait_type}:${t.value}`).join(", ")}

ANA roles: ${roleList}
Which role(s) are you running for? (1-2 max, based on your persona)
Always write in English. Format: CANDIDATE: <role1>[, <role2>]\nREASON: <sentence>`;

  const resp       = await groqText(prompt, true);
  const candLine   = resp.match(/CANDIDATE:\s*(.+)/i)?.[1] ?? "";
  const reasoning  = resp.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? "";

  const roles: string[] = []; const roleNames: string[] = [];
  for (const { hash, label } of ORDERED_ROLE_ENTRIES) {
    if (candLine.toLowerCase().includes(label.toLowerCase())) {
      roles.push(hash);
      roleNames.push(label);
    }
  }
  return { tokenId: p.tokenId, name: p.name, roles, roleNames, reasoning };
}

// ─── Voting (JSON output — robust) ───────────────────────────────────────────

async function decideAllVotes(
  voter: NormiePersona,
  candidacies: Candidacy[],
  allPersonas: NormiePersona[],
): Promise<VoteDecision[]> {
  // Build per-role candidate list (excluding the voter themselves)
  const roleDefs = ORDERED_ROLE_ENTRIES.map(({ hash, label }) => {
    const fromCandidacies = candidacies
      .filter(c => c.tokenId !== voter.tokenId && c.roles.includes(hash))
      .map(c => c.tokenId);
    const fallback = allPersonas
      .filter(p => p.tokenId !== voter.tokenId)
      .map(p => p.tokenId);
    const validIds = [...new Set([...fromCandidacies, ...fallback])];
    return { hash, label, validIds };
  });

  const exampleVotes: Record<string, number> = {};
  for (const r of roleDefs) {
    if (r.validIds.length > 0) exampleVotes[r.label] = r.validIds[0];
  }

  const prompt = `You are ${voter.name} (#${voter.tokenId}). Persona: ${voter.personaText ?? ""} Archetype: ${voter.archetype ?? ""}

Vote for ANA's 6 roles. For each role, pick a tokenId among the listed candidates:
${roleDefs.map(r => `${r.label}: available candidates = [${r.validIds.join(", ")}]`).join("\n")}

Respond ONLY in JSON, always in English. Example: ${JSON.stringify({ votes: exampleVotes })}
Pick the tokenIds that best match the roles according to your personality.`;

  const json = await groqJson(prompt, 200);
  const votes = (json.votes ?? json) as Record<string, unknown>;

  const decisions: VoteDecision[] = [];
  for (const { hash, label, validIds } of roleDefs) {
    if (validIds.length === 0) continue;
    const raw = votes[label];
    const cid = (typeof raw === "number" && validIds.includes(raw)) ? raw : validIds[0];
    const cand = allPersonas.find(p => p.tokenId === cid);
    decisions.push({
      voterTokenId:    voter.tokenId,
      voterName:       voter.name,
      role:            hash,
      roleLabel:       label,
      candidateTokenId: cid,
      candidateName:   cand?.name ?? `#${cid}`,
      reasoning:       `${label} → #${cid}`,
    });
  }
  return decisions;
}

// ─── Salon helpers ─────────────────────────────────────────────────────────────

async function getOrCreateVoteSalon(sessionId: number): Promise<string> {
  const salonName = `Constituent Assembly — Session #${sessionId}`;
  const all = await listSalons();
  const existing = all.find(s => s.name === salonName);
  if (existing) return existing.id;
  const salon = await createSalon({
    name:        salonName,
    description: `Automatic Normie candidacies and votes for the constituent general assembly (session #${sessionId}).`,
    createdBy:   0,
    members:     [],
  });
  return salon.id;
}

// ─── Transaction execution — sequential, fresh nonce each time ────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function executeVotes(decisions: VoteDecision[]): Promise<{ ok: number; failed: string[] }> {
  const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("RELAYER_PRIVATE_KEY not configured");
  const account = privateKeyToAccount(key);
  const wallet  = createWalletClient({
    account,
    chain:     CHAIN,
    transport: http(RPC_URL, { timeout: 30_000 }),
  });

  let ok = 0;
  const failed: string[] = [];

  for (const d of decisions) {
    if (!Number.isFinite(d.voterTokenId) || d.voterTokenId <= 0) {
      failed.push(`invalid voterTokenId ${d.voterTokenId}`); continue;
    }
    if (!Number.isFinite(d.candidateTokenId) || d.candidateTokenId <= 0) {
      failed.push(`#${d.voterTokenId}→${d.roleLabel}: invalid candidateTokenId`); continue;
    }
    if (!d.role || d.role.length !== 66) {
      failed.push(`#${d.voterTokenId}→${d.roleLabel}: invalid role hash`); continue;
    }

    let attempt = 0;
    while (attempt < 3) {
      try {
        // Fresh pending nonce before each tx — avoids desync from failures
        const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
        await wallet.writeContract({
          address:      CA,
          abi:          CONSTITUENT_ASSEMBLY_ABI,
          functionName: "castVoteAsRelayer",
          args:         [BigInt(d.voterTokenId), d.role as `0x${string}`, BigInt(d.candidateTokenId)],
          nonce,
        });
        ok++;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("AlreadyVotedForRole")) { ok++; break; }
        attempt++;
        if (attempt >= 3) {
          failed.push(`#${d.voterTokenId}→${d.roleLabel}: ${msg.slice(0, 120)}`);
          console.error(`[auto-vote] FAILED #${d.voterTokenId}→${d.roleLabel}: ${msg.slice(0, 120)}`);
        } else {
          console.warn(`[auto-vote] retry ${attempt}/3 for #${d.voterTokenId}→${d.roleLabel}`);
          await sleep(2_000);
        }
      }
    }
    // 600ms between each broadcast — stays under RPC rate limits
    await sleep(600);
  }
  return { ok, failed };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // This was previously completely unauthenticated — anyone could trigger LLM-driven
  // candidacies/votes, or (mode=execute) have the relayer actually cast on-chain votes.
  // Two ways in: a wallet-signed admin proof (manual trigger from the admin panel),
  // or x-cron-secret (the automated election-cycle keeper, same secret as every
  // other scheduled route in this app — not weaker, just a different caller).
  const cronSecret = process.env.CRON_SECRET;
  const isCronCall  = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isAdminCall = isCronCall ? false : (await verifyAdminRequest(req)).ok;
  if (!isCronCall && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature is required" }, { status: 401 });
  }

  let body: { phase?: string; mode?: string; candidacies?: Candidacy[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const phase = body.phase ?? "vote";
  const mode  = body.mode  ?? "simulate";

  if (!CORE || !CA)              return NextResponse.json({ error: "Contracts not configured" }, { status: 500 });
  if (!process.env.GROQ_API_KEY) return NextResponse.json({ error: "GROQ_API_KEY missing" },   { status: 500 });

  // ── phase=close ──────────────────────────────────────────────────────────
  if (phase === "close") {
    const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) return NextResponse.json({ error: "RELAYER_PRIVATE_KEY missing" }, { status: 500 });
    try {
      const wallet = createWalletClient({
        account:   privateKeyToAccount(key),
        chain:     CHAIN,
        transport: http(RPC_URL),
      });
      const hash = await wallet.writeContract({
        address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "triggerClose", args: [],
      });
      let closedSessionId = 0;
      try {
        const raw = await pub.readContract({ address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession" });
        const t   = raw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean];
        closedSessionId = Number(t[0]);
      } catch { /* non-blocking */ }
      const salonName = `AG Constitutive — Session #${closedSessionId}`;
      const all = await listSalons();
      const voteSalon = all.find(s => s.name === salonName);
      if (voteSalon) await closeSalon(voteSalon.id, 0).catch(() => null);

      // Auto-create work with the elected Auteur — fire-and-forget. Server-to-server,
      // no wallet to sign with, so this uses the real shared secret (x-cron-secret),
      // not the admin-signature path meant for browser-initiated calls.
      const proposeUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/keeper/propose-work`;
      const cronSecret = process.env.CRON_SECRET;
      if (cronSecret) {
        fetch(proposeUrl, { method: "POST", headers: { "x-cron-secret": cronSecret, "Content-Type": "application/json" }, body: "{}" })
          .catch(() => null);
      } else {
        console.warn("[auto-vote] CRON_SECRET not configured — skipping auto propose-work after session close");
      }

      return NextResponse.json({ phase: "close", txHash: hash, postElection: "propose-work triggered" });
    } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
  }

  // ── Read session id ──────────────────────────────────────────────────────
  let sessionId = 0;
  try {
    const raw = await pub.readContract({ address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession" });
    const t   = raw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean];
    sessionId = Number(t[0]);
  } catch { /* non-blocking */ }

  const voteSalonId = await getOrCreateVoteSalon(sessionId);

  // ── Load members + personas ───────────────────────────────────────────────
  let memberIds: number[];
  try {
    const raw = await pub.readContract({ address: CORE, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberTokenIds" });
    memberIds = (raw as bigint[]).map(Number);
  } catch (e) { return NextResponse.json({ error: `Chain read failed: ${e}` }, { status: 503 }); }

  if (memberIds.length === 0) return NextResponse.json({ message: "No registered members" });

  const personaRes = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const personas   = personaRes
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);
  if (personas.length === 0) return NextResponse.json({ error: "No personas built" }, { status: 503 });

  // ── Candidacy phase (or implicit candidacy for vote phase) ────────────────
  // Use candidacies passed in body (from a previous candidacy call) OR compute fresh ones
  let candidacies: Candidacy[];
  const isExplicitCandidacy = phase === "candidacy";

  if (body.candidacies && body.candidacies.length > 0) {
    // Reuse candidacies from a previous call — no LLM re-run, no duplicate messages
    candidacies = body.candidacies;
    console.log(`[auto-vote] reusing ${candidacies.length} candidacies from body`);
  } else {
    const candRes = await Promise.allSettled(personas.map(p => decideCandidacy(p)));
    candidacies   = candRes
      .filter((r): r is PromiseFulfilledResult<Candidacy> => r.status === "fulfilled")
      .map(r => r.value);

    // Ensure every role has at least one candidate
    for (const { hash, label } of ORDERED_ROLE_ENTRIES) {
      if (!candidacies.some(c => c.roles.includes(hash)) && candidacies.length > 0) {
        const pick = candidacies[Math.floor(Math.random() * candidacies.length)];
        if (!pick.roles.includes(hash)) {
          pick.roles.push(hash);
          if (!pick.roleNames.includes(label)) pick.roleNames.push(label);
        }
      }
    }

    // Post candidacy messages to vote salon (only when we freshly computed them)
    for (const cand of candidacies) {
      const persona = personas.find(p => p.tokenId === cand.tokenId);
      const content = cand.roleNames.length > 0
        ? `🙋 I'm running for: **${cand.roleNames.join(", ")}** — ${cand.reasoning}`
        : `I'm not running for any role this time. ${cand.reasoning}`;
      await addMessage({
        salonId:   voteSalonId,
        tokenId:   cand.tokenId,
        name:      cand.name,
        imageUrl:  persona?.imageUrl ?? "",
        content,
        isLlm:     true,
        timestamp: Date.now(),
      }).catch(() => null);
      await sleep(200);
    }

    // Single Agora announcement — only on the candidacy phase to avoid duplicates
    if (isExplicitCandidacy) {
      await addMessage({
        salonId:   AGORA_SALON_ID,
        tokenId:   0,
        name:      "ANA",
        imageUrl:  "",
        content:   `🗳️ The constituent assembly (session #${sessionId}) is underway. Candidacies and votes in the dedicated salon → "Constituent Assembly — Session #${sessionId}".`,
        isLlm:     true,
        timestamp: Date.now(),
      }).catch(() => null);
    }
  }

  if (isExplicitCandidacy) {
    return NextResponse.json({ phase: "candidacy", memberCount: memberIds.length, candidacies, voteSalonId });
  }

  // ── Vote phase ────────────────────────────────────────────────────────────
  const voteRes      = await Promise.allSettled(personas.map(p => decideAllVotes(p, candidacies, personas)));
  const allDecisions = voteRes
    .filter((r): r is PromiseFulfilledResult<VoteDecision[]> => r.status === "fulfilled")
    .flatMap(r => r.value);

  // Post one vote-summary message per voter to the dedicated salon
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
    await sleep(200);
  }

  if (mode === "simulate") {
    return NextResponse.json({
      phase: "vote", mode: "simulate",
      candidacies, decisions: allDecisions,
      decisionCount: allDecisions.length,
      memberCount: personas.length,
      roleCount: ORDERED_ROLE_ENTRIES.length,
      voteSalonId,
    });
  }

  try {
    const result = await executeVotes(allDecisions);
    return NextResponse.json({
      phase: "vote", mode: "execute",
      candidacies, decisions: allDecisions,
      submitted: result.ok, failed: result.failed,
      voteSalonId,
    });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}
