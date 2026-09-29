/**
 * POST /api/keeper/orchestrator
 *
 * Single entry point for GitHub Actions, called every 30 minutes (see
 * .github/workflows/orchestrator.yml). Replaces five independent cron
 * schedules (auto-exchange, work-lifecycle, election-cycle, activity-catchup,
 * check-burns) that used to fire at their own cadence, spreading Neon
 * wake-ups across the hour instead of concentrating them.
 *
 * Sept 2026 pérennisation study's calendar (section 3):
 *   every tick   → activity catchup, threshold-based synthesis
 *   every ~2h    → salon exchange, work lifecycle, burns
 *   every ~6h    → election cycle
 *   every ~24h   → daily synthesis catch-all + external signals + health ping
 *
 * "Every ~2h/6h/24h" is measured as elapsed wall-clock time since each TASK's
 * own last SUCCESS (tracked in kv_store, one key per task — see isTaskDue()),
 * NOT calendar alignment and NOT a shared per-bucket timestamp. Originally
 * this was calendar-based, tied to GitHub's own 30-minute cron schedule
 * landing near an even hour's first 15 minutes — far less reliable than
 * documented for this cadence (observed: 1 firing in a window where ~7 were
 * expected), so a calendar-aligned check meant a delayed/skipped trigger
 * could miss its entire window and silently wait another full interval.
 *
 * 29/09/2026 incident review changed two more things versus the original
 * per-bucket design:
 *   1. A group's "last run" used to be written BEFORE its tasks ran, so a
 *      task that then failed (or the whole invocation got killed by
 *      Vercel's platform timeout) still looked "recently run" and wouldn't
 *      be retried for its full nominal interval. Tracking is now per TASK
 *      and per SUCCESS only (lastSuccessAt) — a failed task is simply due
 *      again on the very next tick, no separate retry-sooner logic needed.
 *      lastAttemptAt is tracked too, for observability (admin/log only).
 *   2. Every sub-call now has an explicit timeout via AbortController,
 *      comfortably under Vercel's own ~60s function cap (see vercel.json).
 *      Before this, one slow/hung sub-route (e.g. election-cycle's O(N)
 *      sequential voting) could run right up against — or past — that
 *      platform cap while the orchestrator's OWN invocation was awaiting it,
 *      getting the whole invocation killed with no JSON response at all
 *      (observed: GitHub Actions runs failing in ~60-65s with no detail).
 *      A per-task timeout converts that into a clean, reported per-task
 *      failure instead, while every other task that already finished still
 *      makes it into the response.
 *
 * Each due task runs through Promise.allSettled — one failing task never
 * blocks the others due in the same tick, but the response's overall `ok`
 * flag (and HTTP status) reflects whether anything failed, so a monitoring
 * setup watching this one endpoint sees every failure, not just the first.
 * The GitHub workflow (.github/workflows/orchestrator.yml) reads THIS `ok`
 * field explicitly — an HTTP 207 (partial failure) is not treated as success
 * just because it's a 2xx-adjacent status.
 *
 * Sub-routes are called via a same-origin self-fetch (relative to the
 * incoming request's own host header, not an env var) — the same pattern
 * salon-exchange already uses to call work-lifecycle, chosen specifically to
 * avoid the NEXT_PUBLIC_APP_URL misconfiguration that broke the old
 * election-cycle self-fetch (see project memory:
 * project_ana_election_cycle_self_fetch_bug).
 *
 * Known remaining limit (documented, not solved here): tasks still run
 * concurrently INSIDE one Vercel function invocation rather than as fully
 * isolated calls or through a durable queue — see this route's incident
 * report for the two alternatives considered and why neither was applied
 * this pass (isolated per-task GitHub steps reintroduces the N-independent-
 * schedules problem this orchestrator was built to remove; a durable queue
 * is a bigger infra change than this fix warrants). The per-task timeout
 * above bounds the damage a single hung task can do, but doesn't eliminate
 * the shared-invocation model.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { kvSet } from "@/lib/db";
import { redactSecrets } from "@/lib/redact";
import { isTaskDue } from "@/lib/orchestratorTasks";

const HOUR = 60 * 60 * 1000;
const INTERVAL_2H  = 2 * HOUR;
const INTERVAL_6H  = 6 * HOUR;
const INTERVAL_24H = 24 * HOUR;
const INTERVAL_7D  = 7 * 24 * HOUR;

// Per-task fetch timeout — comfortably under the ~60s Vercel function cap
// (vercel.json) shared by this route and every heavy sub-route it calls, so
// one hung task gets reported as a timeout instead of taking the whole
// orchestrator invocation down with it (see file header).
const TASK_TIMEOUT_MS = 45_000;

interface TaskResult {
  task:      string;
  ran:       boolean;
  ok?:       boolean;
  status?:   number;
  error?:    string;
  body?:     unknown;
  durationMs?: number;
}

interface CallRouteResult { ok: boolean; status: number; body?: unknown; error?: string }

async function callRoute(
  req: NextRequest, cronSecret: string, path: string, method: "GET" | "POST", body?: Record<string, unknown>,
): Promise<CallRouteResult> {
  const host = req.headers.get("host");
  if (!host) return { ok: false, status: 0, error: "missing host header — cannot self-call" };
  const url = `${req.nextUrl.protocol}//${host}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
      signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    const responseBody = await res.json().catch(() => undefined);
    return { ok: res.ok, status: res.status, body: responseBody };
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    const msg = redactSecrets(e instanceof Error ? e.message : String(e));
    return { ok: false, status: 0, error: isTimeout ? `timed out after ${TASK_TIMEOUT_MS}ms` : msg };
  }
}

interface PendingTask {
  name:       string;
  intervalMs: number; // 0 = every tick
  fn:         () => Promise<CallRouteResult>;
}

/**
 * Runs every due task CONCURRENTLY (Promise.allSettled), not sequentially —
 * bounds total wall time to roughly the slowest single task instead of their
 * sum (each individually capped at TASK_TIMEOUT_MS above). lastSuccessAt for
 * a task is written ONLY after ITS OWN callRoute() reports ok:true —
 * lastAttemptAt is written for every task that actually ran, success or not,
 * for observability (admin diagnostics; never gates due-ness).
 */
async function runDueTasksConcurrently(results: TaskResult[], tasks: PendingTask[], now: number, tickId: string): Promise<void> {
  const dueFlags = await Promise.all(tasks.map(t => isTaskDue(t.name, t.intervalMs, now)));
  const due = tasks.filter((_, i) => dueFlags[i]);
  tasks.forEach((t, i) => { if (!dueFlags[i]) results.push({ task: t.name, ran: false }); });

  const settled = await Promise.allSettled(due.map(async t => {
    const startedAt = Date.now();
    const r = await t.fn();
    return { r, durationMs: Date.now() - startedAt };
  }));

  await Promise.all(settled.map(async (outcome, i) => {
    const t = due[i];
    await kvSet(`orchestrator:lastAttempt:${t.name}`, String(now)).catch(() => null);

    if (outcome.status === "fulfilled") {
      const { r, durationMs } = outcome.value;
      results.push({ task: t.name, ran: true, ok: r.ok, status: r.status, error: r.error, body: r.body, durationMs });
      console.log(`[orchestrator] tick=${tickId} task=${t.name} ok=${r.ok} status=${r.status} duration=${durationMs}ms`);
      if (r.ok) await kvSet(`orchestrator:lastSuccess:${t.name}`, String(now)).catch(() => null);
    } else {
      const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      results.push({ task: t.name, ran: true, ok: false, error: redactSecrets(error) });
      console.error(`[orchestrator] tick=${tickId} task=${t.name} threw: ${redactSecrets(error)}`);
    }
  }));
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret required" }, { status: 401 });
  }

  const now    = Date.now();
  const tickId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`; // correlation id across this tick's logs

  const results: TaskResult[] = [];

  await runDueTasksConcurrently(results, [
    // Every tick — cheap, idempotent, safe to run alongside everything else.
    { name: "activity-catchup",   intervalMs: 0, fn: () => callRoute(req, cronSecret, "/api/activity/events", "GET") },
    { name: "synthesis-threshold", intervalMs: 0, fn: () => callRoute(req, cronSecret, "/api/keeper/synthesize", "POST", { mode: "threshold" }) },

    // ~Every 2h since this task's own last SUCCESS.
    { name: "salon-exchange", intervalMs: INTERVAL_2H, fn: () => callRoute(req, cronSecret, "/api/keeper/salon-exchange", "POST", {}) },
    { name: "work-lifecycle", intervalMs: INTERVAL_2H, fn: () => callRoute(req, cronSecret, "/api/keeper/work-lifecycle", "POST", {}) },
    { name: "check-burns",    intervalMs: INTERVAL_2H, fn: () => callRoute(req, cronSecret, "/api/keeper/check-burns", "POST", {}) },
    { name: "generate-news",  intervalMs: INTERVAL_2H, fn: () => callRoute(req, cronSecret, "/api/keeper/generate-news", "POST", {}) },

    // ~Every 6h since its own last success.
    { name: "election-cycle", intervalMs: INTERVAL_6H, fn: () => callRoute(req, cronSecret, "/api/keeper/election-cycle", "POST", {}) },

    // ~Every 24h since its own last success: full synthesis catch-all + keepalive ping.
    { name: "synthesis-daily", intervalMs: INTERVAL_24H, fn: () => callRoute(req, cronSecret, "/api/keeper/synthesize", "POST", { mode: "daily" }) },
    { name: "health-ping",     intervalMs: INTERVAL_24H, fn: () => callRoute(req, cronSecret, "/api/health", "GET") },

    // ~Weekly, but launched in the same short database window as every other
    // due task rather than from an independent Sunday schedule.
    { name: "batch-memorial",  intervalMs: INTERVAL_7D, fn: () => callRoute(req, cronSecret, "/api/keeper/batch-memorial", "POST", {}) },
  ], now, tickId);

  const ranTasks = results.filter(r => r.ran);
  const failedTasks = ranTasks.filter(r => r.ok === false);
  const allOk = failedTasks.length === 0;

  return NextResponse.json({
    ok: allOk,
    tickId,
    tickUtc: new Date(now).toISOString(),
    ranCount: ranTasks.length,
    failedCount: failedTasks.length,
    results,
  }, { status: allOk ? 200 : 207 });
}
