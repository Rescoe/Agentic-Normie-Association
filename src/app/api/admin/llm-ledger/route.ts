/**
 * /api/admin/llm-ledger — look at, correct and test the LLM budget ledger.
 *
 *   GET                              → this month's 1min.ai estimate vs. its cap and per-task ceilings, the last
 *                                      real error / last success seen on a 1min.ai call, and the ledger rows.
 *   POST {"action":"set-credits","credits":N}
 *                                    → overwrites this month's ESTIMATED 1min.ai spend with N (read the real
 *                                      figure off the 1min.ai dashboard; N=0 when nothing was deducted).
 *   POST {"action":"probe","models":["..."]?}
 *                                    → one minimal real request per model, outside the governor, answering
 *                                      "why do my 1min.ai calls fail?" with the provider's own error.
 *
 * Gated like every other keeper/admin route: x-cron-secret or an AssociationCore-owner signature. Neither
 * action touches the chain, the works, or the salons.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { getLedgerForMonth, getOneMinAiCreditsSpent, setOneMinAiCreditsSpent } from "@/lib/llmLedger";
import {
  BUDGET_SHARE_BY_TASK, ESTIMATED_CREDITS_PER_CALL, monthlyCreditBudget, probeOneMinAi, readOneMinAiHealth,
} from "@/lib/oneMinAi";

const NO_STORE = { "Cache-Control": "no-store" };

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return true;
  return (await verifyAdminRequest(req)).ok;
}

async function snapshot() {
  const budget = monthlyCreditBudget();
  const [spent, health, ledger] = await Promise.all([
    getOneMinAiCreditsSpent(), readOneMinAiHealth(), getLedgerForMonth().catch(() => []),
  ]);
  return {
    month: new Date().toISOString().slice(0, 7),
    oneMinAi: {
      keyConfigured: !!process.env.ONE_MIN_AI_API_KEY,
      estimatedSpent: spent,
      monthlyBudget: budget,
      usedRatio: budget > 0 ? Math.round((spent / budget) * 1000) / 1000 : null,
      ceilingByTask: Object.fromEntries(
        (Object.keys(BUDGET_SHARE_BY_TASK) as Array<keyof typeof BUDGET_SHARE_BY_TASK>).map(t => [t, {
          ceiling: budget > 0 ? Math.round(budget * BUDGET_SHARE_BY_TASK[t]) : null, estimatedCostPerCall: ESTIMATED_CREDITS_PER_CALL[t],
        }]),
      ),
      lastError: health.lastError,
      lastSuccessAt: health.lastSuccessAt,
    },
    ledger,
  };
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  return NextResponse.json(await snapshot(), { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  let body: { action?: string; credits?: unknown; models?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body → rejected below */ }

  if (body.action === "set-credits") {
    const credits = Number(body.credits);
    if (!Number.isFinite(credits) || credits < 0 || credits > 100_000_000) {
      return NextResponse.json({ error: "credits must be a number between 0 and 100000000" }, { status: 400, headers: NO_STORE });
    }
    const previous = await setOneMinAiCreditsSpent(credits);
    return NextResponse.json({ ok: true, previous, current: Math.round(credits), ...(await snapshot()) }, { headers: NO_STORE });
  }

  if (body.action === "probe") {
    const models = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === "string" && /^[\w.\-:]{1,60}$/.test(m)).slice(0, 4) : undefined;
    return NextResponse.json({ ok: true, probe: await probeOneMinAi(models) }, { headers: NO_STORE });
  }

  return NextResponse.json({ error: 'action must be "set-credits" or "probe"' }, { status: 400, headers: NO_STORE });
}
