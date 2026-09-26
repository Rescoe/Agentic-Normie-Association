/**
 * POST /api/keeper/election-cycle
 *
 * Automates the recurring ConstituentAssembly election: a 1-month mandate for
 * the 6 roles, cycling on its own without an admin manually clicking through
 * candidacy → vote → close every time.
 *
 * One call advances the cycle by exactly one step — safe to call repeatedly
 * (idempotent), designed to run every few hours via GitHub Actions cron:
 *
 *   1. No session ever opened, OR last session resolved ≥ ELECTION_TERM_MS ago
 *        → openSession(ELECTION_TERM_SECONDS) on ConstituentAssembly
 *   2. Session active, candidacies not yet gathered for this session
 *        → call auto-vote phase=candidacy (LLM), record candidacies + mark done
 *   3. Session active, candidacies gathered, votes not yet cast
 *        → call auto-vote phase=vote mode=execute, mark done
 *   4. Session active, deadline reached
 *        → call auto-vote phase=close (triggerClose + auto propose-work)
 *   5. Otherwise: no-op, still waiting on something (deadline not reached, etc.)
 *
 * Protected by x-cron-secret header (same secret as every other keeper route).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { CONSTITUENT_ASSEMBLY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { kvGet, kvSet } from "@/lib/db";
import { FIRST_ELECTION_OPEN_AT, ELECTION_TERM_MS, ELECTION_VOTE_WINDOW_SECONDS } from "@/lib/electionSchedule";
import { runAutoVotePhase, type AutoVoteBody } from "@/lib/autoVote";
import { baseRpcTransport } from "@/lib/baseRpc";

// Base mainnet is the default; Sepolia is an explicit opt-in (26/09/2026
// audit finding — was the reverse).
const IS_MAINNET = process.env.NEXT_PUBLIC_CHAIN !== "baseSepolia";
const CHAIN      = IS_MAINNET ? base : baseSepolia;
const TRANSPORT  = IS_MAINNET
  ? baseRpcTransport(30_000)
  : http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", { timeout: 30_000 });

const CA = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`;

const CYCLE_KEY = "election-cycle-state";

interface CycleState {
  candidacyDoneForSession?: number;
  votesDoneForSession?: number;
}

async function getCycleState(): Promise<CycleState> {
  const raw = await kvGet(CYCLE_KEY);
  return raw ? JSON.parse(raw) as CycleState : {};
}

async function saveCycleState(s: CycleState): Promise<void> {
  await kvSet(CYCLE_KEY, JSON.stringify(s));
}

// Used to call directly into runAutoVotePhase() below instead of over HTTP — this used
// to be a self-referential fetch to this same app's own /api/keeper/auto-vote via
// NEXT_PUBLIC_APP_URL, which was never actually configured in Vercel and silently
// defaulted to "http://localhost:3000" — unreachable from inside a serverless function,
// so every single call failed instantly with "fetch failed". That's the real reason
// election-cycle has failed on every run since the workflow existed (roughly 4 times a
// day for ~3 months) — NOT the ConstituentAssembly authorization gap fixed earlier,
// which only explains runs before that fix. See project_ana_election_cycle_self_fetch_bug
// memory. A direct function call has no URL to get wrong.
async function callAutoVote(body: AutoVoteBody): Promise<Record<string, unknown>> {
  try {
    return await runAutoVotePhase(body);
  } catch (e) {
    throw new Error(`auto-vote ${body.phase} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret required" }, { status: 401 });
  }
  if (!CA) return NextResponse.json({ error: "ConstituentAssembly not configured" }, { status: 500 });

  const pub = createPublicClient({ chain: CHAIN, transport: TRANSPORT });

  let session: { id: number; openedAt: number; closedAt: number; deadline: number; active: boolean; resolved: boolean };
  try {
    const raw = await pub.readContract({ address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession" });
    const t   = raw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean];
    session = { id: Number(t[0]), openedAt: Number(t[1]), closedAt: Number(t[2]), deadline: Number(t[3]), active: t[4], resolved: t[5] };
  } catch (e) {
    return NextResponse.json({ error: `Chain read failed: ${e}` }, { status: 503 });
  }

  const now = Date.now();
  const cycle = await getCycleState();

  // ── Step 1: open a new session if none is active and it's due ──────────────
  // First ever session: gated by the announced constitutive AG date, not by
  // "id===0" alone — without this the very first cron run after deploy would
  // open the assembly immediately regardless of the publicly announced date.
  // Subsequent sessions: term anchored to the PREVIOUS session's openedAt, so
  // mandates recur every ELECTION_TERM_MS from when they started, not from
  // when the (much shorter) vote window happened to close.
  if (!session.active) {
    const shouldOpen = session.id === 0
      ? now >= FIRST_ELECTION_OPEN_AT
      : (session.resolved && now - session.openedAt * 1000 >= ELECTION_TERM_MS);
    if (!shouldOpen) {
      return NextResponse.json({ step: "waiting", reason: "election not due yet", session });
    }
    const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) return NextResponse.json({ error: "RELAYER_PRIVATE_KEY not configured" }, { status: 500 });
    const account = privateKeyToAccount(key);

    // openSession() accepts both owner and relayer (onlyOwnerOrRelayer modifier
    // in the redeployed ConstituentAssembly).  The relayer can now open sessions
    // autonomously; the owner retains all other Ownable powers (closeSession,
    // setElectableRoles, transferOwnership, etc.).
    const wallet = createWalletClient({ account, chain: CHAIN, transport: TRANSPORT });
    try {
      const hash = await wallet.writeContract({
        address: CA, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "openSession", args: [BigInt(ELECTION_VOTE_WINDOW_SECONDS)],
      });
      return NextResponse.json({ step: "openSession", txHash: hash });
    } catch (e) {
      return NextResponse.json({ error: `openSession failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
    }
  }

  // ── Step 4: deadline reached → close ────────────────────────────────────────
  if (now >= session.deadline * 1000) {
    try {
      const result = await callAutoVote({ phase: "close" });
      return NextResponse.json({ step: "close", result });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── Step 2: candidacies not yet gathered for this session ──────────────────
  if (cycle.candidacyDoneForSession !== session.id) {
    try {
      const result = await callAutoVote({ phase: "candidacy" });
      await saveCycleState({ ...cycle, candidacyDoneForSession: session.id });
      return NextResponse.json({ step: "candidacy", result });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── Step 3: votes not yet cast for this session ─────────────────────────────
  if (cycle.votesDoneForSession !== session.id) {
    try {
      const result = await callAutoVote({ phase: "vote", mode: "execute" });
      await saveCycleState({ ...cycle, votesDoneForSession: session.id });
      return NextResponse.json({ step: "vote", result });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  return NextResponse.json({ step: "waiting", reason: "candidacy and votes done, waiting on deadline", session });
}
