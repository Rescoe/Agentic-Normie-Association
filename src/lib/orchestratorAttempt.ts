/**
 * orchestratorAttempt.ts — documented, testable mirror of the retry decision
 * .github/workflows/orchestrator.yml's bash loop makes around each
 * POST /api/keeper/orchestrator attempt. The workflow itself is bash/YAML
 * and can't be unit-tested by vitest; this function is the single source of
 * truth for that decision, kept in sync with the workflow by hand (see the
 * workflow file's own comment pointing back here) and exercised directly by
 * tests/orchestratorAttempt.test.ts.
 */

export type OrchestratorAttemptOutcome =
  | "success"    // stop retrying, job succeeds
  | "hard-fail"  // stop retrying, job fails immediately — a well-formed response reporting a real per-task failure, not a transport issue
  | "retry";     // transient-looking (no body, unexpected status) — worth another attempt

/**
 * httpStatus 0 means "curl itself failed" (timeout, connection refused, ...).
 * ok is the orchestrator response's own `ok` field, undefined if the body
 * didn't parse as JSON at all.
 */
export function classifyOrchestratorAttempt(httpStatus: number, ok: boolean | undefined): OrchestratorAttemptOutcome {
  if (httpStatus === 200 && ok === true) return "success";
  // 207 is the orchestrator's own deliberate "at least one due task failed"
  // signal — a well-formed response, not a transport/platform failure, so
  // retrying it would just reproduce the same per-task failure. Never
  // conflated with success just because it's a 2xx-adjacent status.
  if (httpStatus === 207) return "hard-fail";
  return "retry";
}
