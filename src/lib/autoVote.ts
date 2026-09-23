/**
 * autoVote.ts — core logic for the 3-phase automated ConstituentAssembly voting flow.
 *
 *   phase=candidacy  → Each Normie picks which role(s) they run for; posts to vote salon + 1 Agora announcement
 *   phase=vote       → Each Normie votes all 6 roles (JSON LLM output, robust parsing)
 *                       Optionally accepts candidacies[] in body to avoid re-running candidacy
 *                       mode=simulate → decisions only, no tx
 *                       mode=execute  → relayer submits castVoteAsRelayer() sequentially
 *   phase=close      → relayer calls triggerClose() on ConstituentAssembly
 *
 * Used by:
 *   src/app/api/keeper/auto-vote/route.ts — the POST handler (auth + HTTP wrapper)
 *   src/app/api/keeper/election-cycle/route.ts — called directly in-process instead of
 *     a self-referential HTTP fetch (a route.ts file can only export recognized Next.js
 *     handlers, so this couldn't stay there either — see
 *     project_ana_election_cycle_self_fetch_bug memory for why the direct call matters).
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  ASSOCIATION_CORE_ABI, CONSTITUENT_ASSEMBLY_ABI,
  CONTRACT_ADDRESSES, ROLES, ROLE_LABELS,
} from "@/lib/contracts";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";
import { addMessage, createSalon, closeSalon, listSalons, AGORA_SALON_ID } from "@/lib/salonStore";
import { runProposeWork } from "@/lib/proposeWork";
import { baseRpcTransport } from "@/lib/baseRpc";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "openai/gpt-oss-120b";
const MODEL_F  = "openai/gpt-oss-120b";

const IS_MAINNET = process.env.NEXT_PUBLIC_CHAIN === "base";
const CHAIN      = IS_MAINNET ? base : baseSepolia;
// Base sepolia (testnet, no real usage) stays on a single plain endpoint —
// the failover is only worth the complexity where real traffic hits it.
const TRANSPORT  = IS_MAINNET
  ? baseRpcTransport(30_000)
  : http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", { timeout: 30_000 });

const pub  = createPublicClient({ chain: CHAIN, transport: TRANSPORT });
const CORE = CONTRACT_ADDRESSES.AssociationCore     as `0x${string}`;
const CA   = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`;

// ─── Batching for per-persona Groq calls ───────────────────────────────────────
//
// decideCandidacy() and decideAllVotes() each fire one Groq request per persona.
// At 4 members that's fine fully parallel — at hundreds or thousands it would
// fire that many concurrent requests from a single serverless invocation and
// get rate-limited by Groq. Below BATCH_THRESHOLD members, run everyone in one
// shot (unchanged behavior). Above it, split into chunks scaling with
// membership (100 members → chunks of 10, 1000 → chunks of 100, per the
// porteur's own sizing) but capped at MAX_BATCH_SIZE: Groq's own concurrency
// limit is a fixed number tied to the account, not to how many Normies are
// registered, so the chunk size can't be allowed to keep growing with N —
// without the cap, 1000+ members would still fire 100+ simultaneous requests
// and risk the exact rate-limiting this is meant to avoid.
const BATCH_THRESHOLD = 10;
const MAX_BATCH_SIZE  = 20;

function computeBatchSize(n: number): number {
  if (n <= BATCH_THRESHOLD) return n;
  return Math.min(Math.max(1, Math.ceil(n / 10)), MAX_BATCH_SIZE);
}

async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    results.push(...(await Promise.allSettled(chunk.map(fn))));
  }
  return results;
}

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
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  return d.choices[0]?.message?.content?.trim() ?? "";
}

async function groqJson(prompt: string, maxTokens = 200): Promise<Record<string, unknown>> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not configured");
  // No response_format: { type: "json_object" } here on purpose. Confirmed live:
  // openai/gpt-oss-120b (a reasoning model) returns Groq's own 400
  // json_validate_failed for that mode -- its raw output apparently doesn't
  // pass Groq's strict server-side JSON check (likely reasoning content
  // leaking into what gets validated), so the request never even reaches a
  // normal response. Falling back to plain text + our own lenient extraction
  // below, the same approach decideCandidacy()/groqText() already use
  // successfully with this exact model.
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model:       MODEL,
      messages:    [{ role: "user", content: prompt }],
      max_tokens:  maxTokens,
      temperature: 0.6,
    }),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const d = await r.json() as { choices: Array<{ message: { content: string } }> };
  const raw = d.choices[0]?.message?.content?.trim() ?? "";
  return extractJsonObject(raw);
}

/** Lenient JSON extraction from raw LLM text: strips a leading <think>...</think>
 * reasoning block if present, then tries a direct parse, falling back to the
 * substring between the first "{" and the last "}". Returns {} if nothing
 * parses -- callers already handle an empty object as "no usable data". */
function extractJsonObject(raw: string): Record<string, unknown> {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return {};
}

// ─── Candidacy ────────────────────────────────────────────────────────────────

async function decideCandidacy(p: NormiePersona): Promise<Candidacy> {
  try {
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
  } catch (e) {
    // Promise.allSettled/runInBatches silently drops a rejection here — without
    // this log, a Groq-side failure (rate limit, 5xx) for every persona at once
    // leaves zero trace anywhere, which is exactly what happened live: a vote
    // phase that produced 0 decisions with no way to tell why.
    console.error(`[auto-vote] decideCandidacy failed for #${p.tokenId}:`, e);
    throw e;
  }
}

// ─── Voting (JSON output — robust) ───────────────────────────────────────────

async function decideAllVotes(
  voter: NormiePersona,
  candidacies: Candidacy[],
  allPersonas: NormiePersona[],
): Promise<VoteDecision[]> {
  try {
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

Respond with ONLY the raw JSON object below, always in English — no reasoning, no explanation, no markdown code fences, nothing before or after it. Example: ${JSON.stringify({ votes: exampleVotes })}
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
  } catch (e) {
    // Same silent-drop problem as decideCandidacy above: without this log, a
    // Groq-side failure for every voter at once (rate limit right after the
    // candidacy phase's own burst of calls is the leading suspect) shows up
    // only as decisions:[] / submitted:0 with zero clue why.
    console.error(`[auto-vote] decideAllVotes failed for #${voter.tokenId}:`, e);
    throw e;
  }
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
    transport: TRANSPORT,
  });

  let ok = 0;
  const failed: string[] = [];

  // Nonce tracked locally instead of re-fetched via RPC before every single
  // transaction, with no fixed delay between broadcasts. At scale, that
  // redundant round-trip plus a flat 600ms pacing sleep on every iteration
  // meant this loop could only get through roughly 10-20 voters before
  // hitting Vercel's 60s function limit — a modest election would then need
  // several 6h cron cycles just to finish submitting votes.
  //
  // Bumped only after a transaction is actually broadcast. A revert caught at
  // gas-estimation time (e.g. AlreadyVotedForRole, the common case on a cron
  // retry) never consumes a nonce, so it must not bump the counter either —
  // that's also why this stays sequential instead of firing transactions in
  // parallel with pre-assigned nonces: on a retry, most decisions resolve to
  // AlreadyVotedForRole without ever consuming a nonce, so nonces can't be
  // safely handed out in advance without risking a permanent gap.
  let nextNonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });

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
    let done = false;
    while (attempt < 3 && !done) {
      try {
        await wallet.writeContract({
          address:      CA,
          abi:          CONSTITUENT_ASSEMBLY_ABI,
          functionName: "castVoteAsRelayer",
          args:         [BigInt(d.voterTokenId), d.role as `0x${string}`, BigInt(d.candidateTokenId)],
          nonce:        nextNonce,
        });
        nextNonce++;
        ok++;
        done = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("AlreadyVotedForRole")) { ok++; done = true; break; }
        attempt++;
        if (attempt >= 3) {
          failed.push(`#${d.voterTokenId}→${d.roleLabel}: ${msg.slice(0, 120)}`);
          console.error(`[auto-vote] FAILED #${d.voterTokenId}→${d.roleLabel}: ${msg.slice(0, 120)}`);
        } else {
          console.warn(`[auto-vote] retry ${attempt}/3 for #${d.voterTokenId}→${d.roleLabel}`);
          // Resync from chain — a real failure (unlike AlreadyVotedForRole)
          // may have left our local counter out of step with what landed.
          nextNonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
          await sleep(1_000);
        }
      }
    }
  }
  return { ok, failed };
}

// ─── Core logic — callable directly (in-process) or via the route's POST handler ─

export interface AutoVoteBody {
  phase?: string;
  mode?: string;
  candidacies?: Candidacy[];
}

export async function runAutoVotePhase(body: AutoVoteBody): Promise<Record<string, unknown>> {
  const phase = body.phase ?? "vote";
  const mode  = body.mode  ?? "simulate";

  if (!CORE || !CA) throw new Error("Contracts not configured");
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY missing");

  // ── phase=close ──────────────────────────────────────────────────────────
  if (phase === "close") {
    const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) throw new Error("RELAYER_PRIVATE_KEY missing");
    const wallet = createWalletClient({
      account:   privateKeyToAccount(key),
      chain:     CHAIN,
      transport: TRANSPORT,
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

    // Auto-create work with the elected Auteur. Was a self-referential HTTP fetch to
    // this same app's own /api/keeper/propose-work, fired without awaiting it — in a
    // Vercel serverless function that's doubly broken: the function can freeze/exit
    // before the un-awaited fetch completes, and separately NEXT_PUBLIC_APP_URL was
    // never configured, so the fetch always failed immediately regardless. Direct,
    // awaited, in-process call instead — see project_ana_election_cycle_self_fetch_bug.
    let postElection: string;
    try {
      await runProposeWork(null);
      postElection = "created";
    } catch (e) {
      console.error("[auto-vote] auto propose-work after close failed (non-fatal):", e);
      postElection = "failed";
    }

    return { phase: "close", txHash: hash, postElection };
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
  } catch (e) { throw new Error(`Chain read failed: ${e}`); }

  if (memberIds.length === 0) return { message: "No registered members" };

  const personaRes = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const personas   = personaRes
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);
  if (personas.length === 0) throw new Error("No personas built");

  // ── Candidacy phase (or implicit candidacy for vote phase) ────────────────
  // Use candidacies passed in body (from a previous candidacy call) OR compute fresh ones
  let candidacies: Candidacy[];
  const isExplicitCandidacy = phase === "candidacy";

  if (body.candidacies && body.candidacies.length > 0) {
    // Reuse candidacies from a previous call — no LLM re-run, no duplicate messages
    candidacies = body.candidacies;
    console.log(`[auto-vote] reusing ${candidacies.length} candidacies from body`);
  } else {
    const candRes = await runInBatches(personas, computeBatchSize(personas.length), decideCandidacy);
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
    return { phase: "candidacy", memberCount: memberIds.length, candidacies, voteSalonId };
  }

  // ── Vote phase ────────────────────────────────────────────────────────────
  const voteRes      = await runInBatches(personas, computeBatchSize(personas.length), p => decideAllVotes(p, candidacies, personas));
  const allDecisions = voteRes
    .filter((r): r is PromiseFulfilledResult<VoteDecision[]> => r.status === "fulfilled")
    .flatMap(r => r.value);
  // Surfaced in the response so a total failure (0 decisions) isn't a silent
  // black box in the admin console — the real errors are now also logged
  // individually by decideAllVotes() above, but this gives an at-a-glance count.
  const voteErrors = voteRes.filter((r): r is PromiseRejectedResult => r.status === "rejected");

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
  }

  if (mode === "simulate") {
    return {
      phase: "vote", mode: "simulate",
      candidacies, decisions: allDecisions,
      decisionCount: allDecisions.length,
      memberCount: personas.length,
      roleCount: ORDERED_ROLE_ENTRIES.length,
      voteErrorCount: voteErrors.length,
      voteSalonId,
    };
  }

  const result = await executeVotes(allDecisions);
  return {
    phase: "vote", mode: "execute",
    candidacies, decisions: allDecisions,
    submitted: result.ok, failed: result.failed,
    voteErrorCount: voteErrors.length,
    voteSalonId,
  };
}
