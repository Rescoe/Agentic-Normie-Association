/**
 * POST /api/keeper/auto-vote
 *
 * 3-phase automated voting flow — candidacy / vote / close. See @/lib/autoVote for
 * the actual logic; this file is only the auth + HTTP wrapper, since a route.ts file
 * can only export recognized Next.js handlers (GET/POST/dynamic/...), not arbitrary
 * functions meant to be called directly in-process from elsewhere (election-cycle
 * calls runAutoVotePhase directly — see project_ana_election_cycle_self_fetch_bug
 * memory for why).
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { runAutoVotePhase, type AutoVoteBody } from "@/lib/autoVote";

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

  let body: AutoVoteBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const result = await runAutoVotePhase(body);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /not configured|missing/i.test(message) ? 500 : (/Chain read failed/.test(message) ? 503 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
