/**
 * GET /api/admin/observability — compact operational dashboard added by the
 * Sept 2026 pérennisation pass: planned orchestrator windows, unsynthesized
 * backlog, vote health, works stuck in NEEDS_RETHINK, open dev-requests, this
 * month's LLM ledger, and Neon compute usage (real via the Consumption API
 * when configured, otherwise a clearly-labeled projection — see neonUsage.ts).
 *
 * Read-only, admin/cron-gated like every other keeper/admin route.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { listSalons, listSalonsDueForThresholdSynthesis, SYNTHESIS_MSG_THRESHOLD, getSalonState } from "@/lib/salonStore";
import { checkVoteHealthAlerts, listRecentVoteMetrics } from "@/lib/voteMetricsStore";
import { listDevRequests } from "@/lib/devRequests";
import { getLedgerForMonth } from "@/lib/llmLedger";
import { getMonthlyComputeUsage, classifyBudget } from "@/lib/neonUsage";
import { listWorks } from "@/lib/workStore";

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return true;
  return (await verifyAdminRequest(req)).ok;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  const [salons, dueThreshold, voteAlerts, recentVotes, devRequests, ledger, neonUsage, works] = await Promise.all([
    listSalons(),
    listSalonsDueForThresholdSynthesis(),
    checkVoteHealthAlerts(),
    listRecentVoteMetrics(5),
    listDevRequests(),
    getLedgerForMonth(),
    getMonthlyComputeUsage(),
    listWorks(),
  ]);

  const perSalonBacklog = await Promise.all(salons.map(async s => ({
    salonId: s.id, name: s.name, messagesSinceSynthesis: (await getSalonState(s.id)).messagesSinceSynthesis,
  })));

  const budgetPolicy = classifyBudget(neonUsage.computeCuHours);

  return NextResponse.json({
    orchestrator: {
      schedule: {
        everyTick: ["activity-catchup", "synthesis-threshold"],
        every2h:   ["salon-exchange", "work-lifecycle", "check-burns"],
        every6h:   ["election-cycle"],
        daily00utc: ["synthesis-daily (+ external signals)", "health-ping"],
      },
    },
    synthesis: {
      threshold: SYNTHESIS_MSG_THRESHOLD,
      salonsDueNow: dueThreshold,
      perSalonBacklog,
    },
    votes: {
      alerts: voteAlerts, // { highAbstention, highInvalidRate } per the pérennité study's thresholds
      recent: recentVotes,
    },
    works: {
      needsRethink: works.filter(w => w.state === "NEEDS_RETHINK").map(w => ({ id: w.id, title: w.title, reason: w.needsRethinkReason })),
      activeCount: works.filter(w => !["PUBLISHED", "REJECTED"].includes(w.state)).length,
    },
    devRequests: {
      open: devRequests.filter(r => !["CLOSED", "REJECTED", "DELIVERED"].includes(r.status)).length,
      byStatus: Object.fromEntries(
        ["OBSERVED", "PROPOSED", "DISCUSSING", "SELECTED", "HUMAN_REVIEW", "IN_PROGRESS", "DELIVERED", "NORMIE_TESTING", "CLOSED", "REJECTED"]
          .map(status => [status, devRequests.filter(r => r.status === status).length]),
      ),
    },
    llmLedgerThisMonth: ledger,
    neon: {
      ...neonUsage,
      budgetPolicy,
      // Thresholds from the pérennité study section 11/12 — informational only, no automatic action taken here.
      thresholds: { normal: 30, diagnose: 50, reduce: 70, economy: 85 },
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
