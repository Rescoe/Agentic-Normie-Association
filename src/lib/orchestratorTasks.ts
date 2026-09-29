/**
 * orchestratorTasks.ts — per-task due-tracking for the orchestrator
 * (src/app/api/keeper/orchestrator/route.ts). Kept out of route.ts itself
 * because Next.js's typed-routes checker rejects any export from a route
 * file other than the recognized HTTP-method/config ones — this needs its
 * own module to stay unit-testable.
 *
 * See orchestrator/route.ts's file header for the full 29/09/2026 incident
 * context this per-task (not per-bucket) design fixes.
 */
import { kvGet } from "@/lib/db";

/**
 * Due = at least `intervalMs` since this TASK's own last SUCCESS (never its
 * last attempt). Never run before → due immediately. Best-effort, not
 * lock-protected: two genuinely concurrent orchestrator invocations could
 * both read "due" before either writes success — an occasional extra run of
 * a cheap, idempotent-ish task is far cheaper than the alternative of
 * missing a window entirely.
 */
export async function isTaskDue(taskName: string, intervalMs: number, now: number): Promise<boolean> {
  if (intervalMs <= 0) return true; // every-tick tasks
  const lastSuccess = await kvGet(`orchestrator:lastSuccess:${taskName}`);
  return now - (lastSuccess ? Number(lastSuccess) : 0) >= intervalMs;
}
