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

const CHAIN   = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL = process.env.NEXT_PUBLIC_CHAIN === "base"
  ? (process.env.BASE_RPC_URL        ?? "https://mainnet.base.org")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

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

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function callAutoVote(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET not configured");
  const r = await fetch(`${appUrl()}/api/keeper/auto-vote`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
    body:    JSON.stringify(body),
  });
  const d = await r.json() as Record<string, unknown>;
  if (!r.ok) throw new Error(`auto-vote ${body.phase} failed: ${JSON.stringify(d)}`);
  return d;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret required" }, { status: 401 });
  }
  if (!CA) return NextResponse.json({ error: "ConstituentAssembly not configured" }, { status: 500 });

  const pub = createPublicClient({ chain: CHAIN, transport: http(RPC_URL, { timeout: 30_000 }) });

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
    const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: CHAIN, transport: http(RPC_URL) });
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
