/**
 * GET /api/election/next — public, unauthenticated.
 *
 * Computes the next (or currently open) constituent assembly election window
 * from on-chain ConstituentAssembly state, using the same schedule constants
 * as the election-cycle keeper (src/lib/electionSchedule.ts) so the homepage
 * can never display a date that drifts from what the cron actually does.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readCurrentSession } from "@/lib/chainReader";
import { computeNextElection } from "@/lib/electionSchedule";

export async function GET() {
  const session = await readCurrentSession();
  const next = computeNextElection(session);
  return NextResponse.json({ ...next, session });
}
