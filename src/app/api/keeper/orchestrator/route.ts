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
 * "Every ~2h/6h/24h" is measured as elapsed wall-clock time since each
 * group's own last run (tracked in kv_store), NOT calendar alignment (e.g.
 * "hour % 2 === 0"). Originally this was calendar-based, tied to GitHub's
 * own 30-minute cron schedule landing near an even hour's first 15 minutes.
 * That schedule trigger turned out to be far less reliable than documented
 * for this cadence (observed: 1 firing in a window where ~7 were expected),
 * so a calendar-aligned check meant a delayed or skipped trigger could miss
 * its entire window and silently wait another full interval.
 * Elapsed-time-since-last-run instead runs a group on whichever tick
 * actually happens to fire next, however irregular, as long as enough time
 * has genuinely passed -- the porteur's own call: an unpredictable but
 * eventually-running cron beats a precisely-scheduled one that often
 * doesn't fire at all.
 *
 * Each due task runs through Promise.allSettled — one failing task never
 * blocks the others due in the same tick, but the response's overall `ok`
 * flag (and HTTP status) reflects whether anything failed, so a monitoring
 * setup watching this one endpoint sees every failure, not just the first.
 *
 * Sub-routes are called via a same-origin self-fetch (relative to the
 * incoming request's own host header, not an env var) — the same pattern
 * salon-exchange already uses to call work-lifecycle, chosen specifically to
 * avoid the NEXT_PUBLIC_APP_URL misconfiguration that broke the old
 * election-cycle self-fetch (see project memory:
 * project_ana_election_cycle_self_fetch_bug).
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/db";

const HOUR = 60 * 60 * 1000;
const INTERVAL_2H  = 2 * HOUR;
const INTERVAL_6H  = 6 * HOUR;
const INTERVAL_24H = 24 * HOUR;

/**
 * Due = at least `intervalMs` since this group's last run, per kv_store
 * (never run before → due immediately). Best-effort, not lock-protected: two
 * genuinely concurrent orchestrator invocations could both read "due" before
 * either writes -- acceptable here, an occasional extra run of a cheap,
 * idempotent-ish task is far cheaper than the alternative of missing a
 * window entirely (see file header comment).
 */
async function isGroupDue(key: string, intervalMs: number, now: number): Promise<boolean> {
  const lastRun = await kvGet(key);
  return now - (lastRun ? Number(lastRun) : 0) >= intervalMs;
}

interface TaskResult {
  task: string;
  ran: boolean;
  ok?: boolean;
  status?: number;
  error?: string;
  body?: unknown;
}

async function callRoute(
  req: NextRequest, cronSecret: string, path: string, method: "GET" | "POST", body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body?: unknown; error?: string }> {
  const host = req.headers.get("host");
  if (!host) return { ok: false, status: 0, error: "missing host header — cannot self-call" };
  const url = `${req.nextUrl.protocol}//${host}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    const responseBody = await res.json().catch(() => undefined);
    return { ok: res.ok, status: res.status, body: responseBody };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

interface PendingTask {
  name: string;
  due:  boolean;
  fn:   () => Promise<{ ok: boolean; status: number; body?: unknown; error?: string }>;
}

/**
 * Runs every due task in `tasks` CONCURRENTLY (Promise.allSettled) — not
 * sequentially. This matters on Vercel: work-lifecycle alone is declared
 * with a 60s maxDuration (see vercel.json), and Vercel's Hobby plan hard-caps
 * every function at 60s regardless of what maxDuration says (see
 * activity/events/route.ts's own comment on this). Awaiting salon-exchange,
 * work-lifecycle and check-burns one after another in the SAME orchestrator
 * invocation could easily sum past that 60s ceiling and get the orchestrator
 * itself killed mid-way, silently dropping whichever tasks hadn't started
 * yet. Running them concurrently bounds total wall time to roughly the
 * SLOWEST single task instead of their sum.
 */
async function runDueTasksConcurrently(results: TaskResult[], tasks: PendingTask[]): Promise<void> {
  const due = tasks.filter(t => t.due);
  for (const t of tasks) if (!t.due) results.push({ task: t.name, ran: false });
  const settled = await Promise.allSettled(due.map(t => t.fn()));
  settled.forEach((outcome, i) => {
    const name = due[i].name;
    if (outcome.status === "fulfilled") {
      const r = outcome.value;
      results.push({ task: name, ran: true, ok: r.ok, status: r.status, error: r.error, body: r.body });
    } else {
      results.push({ task: name, ran: true, ok: false, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
    }
  });
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret required" }, { status: 401 });
  }

  const now = Date.now();
  const [due2h, due6h, due24h] = await Promise.all([
    isGroupDue("orchestrator:lastRun:2h", INTERVAL_2H, now),
    isGroupDue("orchestrator:lastRun:6h", INTERVAL_6H, now),
    isGroupDue("orchestrator:lastRun:24h", INTERVAL_24H, now),
  ]);
  // Mark due groups run BEFORE awaiting their tasks below, not after --
  // narrows (doesn't eliminate) the race window against another concurrent
  // invocation reading the same "due" state.
  await Promise.all([
    due2h  ? kvSet("orchestrator:lastRun:2h", String(now))  : Promise.resolve(),
    due6h  ? kvSet("orchestrator:lastRun:6h", String(now))  : Promise.resolve(),
    due24h ? kvSet("orchestrator:lastRun:24h", String(now)) : Promise.resolve(),
  ]);

  const results: TaskResult[] = [];

  await runDueTasksConcurrently(results, [
    // Every tick — cheap, idempotent, safe to run alongside everything else.
    { name: "activity-catchup",   due: true, fn: () => callRoute(req, cronSecret, "/api/activity/events", "GET") },
    { name: "synthesis-threshold", due: true, fn: () => callRoute(req, cronSecret, "/api/keeper/synthesize", "POST", { mode: "threshold" }) },

    // ~Every 2h since last run.
    { name: "salon-exchange", due: due2h, fn: () => callRoute(req, cronSecret, "/api/keeper/salon-exchange", "POST", {}) },
    { name: "work-lifecycle", due: due2h, fn: () => callRoute(req, cronSecret, "/api/keeper/work-lifecycle", "POST", {}) },
    { name: "check-burns",    due: due2h, fn: () => callRoute(req, cronSecret, "/api/keeper/check-burns", "POST", {}) },

    // ~Every 6h since last run.
    { name: "election-cycle", due: due6h, fn: () => callRoute(req, cronSecret, "/api/keeper/election-cycle", "POST", {}) },

    // ~Every 24h since last run: full synthesis catch-all + external signals + keepalive ping.
    { name: "synthesis-daily", due: due24h, fn: () => callRoute(req, cronSecret, "/api/keeper/synthesize", "POST", { mode: "daily" }) },
    { name: "health-ping",     due: due24h, fn: () => callRoute(req, cronSecret, "/api/health", "GET") },
  ]);

  const ranTasks = results.filter(r => r.ran);
  const failedTasks = ranTasks.filter(r => r.ok === false);
  const allOk = failedTasks.length === 0;

  return NextResponse.json({
    ok: allOk,
    tickUtc: new Date(now).toISOString(),
    ranCount: ranTasks.length,
    failedCount: failedTasks.length,
    results,
  }, { status: allOk ? 200 : 207 });
}
