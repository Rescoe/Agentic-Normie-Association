/**
 * POST /api/keeper/propose-work
 * Un Normie (persona LLM) génère un titre + proposition d'œuvre et la crée en Neon (PROPOSED).
 * Appelé par l'admin après initiateWorkSession() ou par le cron salon-exchange.
 * Protected by x-cron-secret or a wallet-signed admin proof (see lib/adminAuth.ts).
 *
 * Core logic lives in @/lib/proposeWork (runProposeWork) — a route.ts file can only
 * export recognized Next.js handlers (GET/POST/dynamic/...), so anything meant to be
 * called directly in-process from elsewhere (e.g. auto-vote's close phase) has to live
 * outside this file. See project_ana_election_cycle_self_fetch_bug memory.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { runProposeWork } from "@/lib/proposeWork";

export async function POST(req: NextRequest) {
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isAdminCall = (await verifyAdminRequest(req)).ok;

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  let forcedProposerId: number | null = null;
  try {
    const body = await req.json() as { proposerTokenId?: number };
    if (body.proposerTokenId && body.proposerTokenId > 0) forcedProposerId = body.proposerTokenId;
  } catch { /* body absent or not JSON — fine */ }

  try {
    const work = await runProposeWork(forcedProposerId);
    return NextResponse.json({ work });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /No member found|Normies API unavailable/.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
