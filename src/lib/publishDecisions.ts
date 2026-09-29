/**
 * publishDecisions.ts — pure idempotency decisions for the publish pipeline
 * (stepPublishing() in work-lifecycle/route.ts).
 *
 * Extracted specifically so the exact logic behind the 29/09/2026 "Coffee"
 * incident fix — a work that was genuinely published and initialized
 * on-chain got rétrogradé to a technical pause after a few flaky RPC reads —
 * can be unit-tested without mocking viem/the relayer/Next.js. Every
 * function here takes plain values in, returns a plain decision out.
 */

export type TriBool = boolean | "unknown";

export type InitDecision = "skip-init" | "call-init" | "retry-unknown";

/**
 * Whether to call ANAEditions.initialize() at all. A failed/unknown read of
 * initialized() must NEVER be treated as "not initialized" — that would risk
 * calling initialize() on a collection that's actually already correctly set
 * up. "retry-unknown" means: do nothing this tick, try the read again next
 * tick, and NEVER call initialize() in the meantime.
 */
export function decideInitAction(alreadyInitialized: TriBool): InitDecision {
  if (alreadyInitialized === "unknown") return "retry-unknown";
  return alreadyInitialized ? "skip-init" : "call-init";
}

export interface PostInitVerification {
  initialized:          TriBool;
  onChainWorkId:        number | "unknown";
  expectedWorkId:        number;
  artworkContentLength: number | "unknown";
}

export type VerificationOutcome = "verified" | "retry-unknown" | "mismatch";

/**
 * After initialize() has run (or was skipped because it was already done),
 * decide whether the on-chain state actually matches what's expected. A
 * "retry-unknown" (any of the three reads failed/timed out) must stay
 * retryable — never "mismatch" (which would look like a genuine on-chain
 * divergence) and never "verified" (which would advance to PUBLISHED on
 * unconfirmed data).
 */
export function decidePostInitVerification(v: PostInitVerification): VerificationOutcome {
  if (v.initialized === "unknown" || v.onChainWorkId === "unknown" || v.artworkContentLength === "unknown") {
    return "retry-unknown";
  }
  if (v.initialized === true && v.onChainWorkId === v.expectedWorkId && v.artworkContentLength > 0) {
    return "verified";
  }
  return "mismatch";
}

/** A work with an onChainWorkId already recorded must never call
 * WorkRegistry.publish() again — only retry whatever comes after (init,
 * verification). Matches ANAWork.onChainWorkId/txHash's own doc comment. */
export function shouldRepublish(work: { onChainWorkId?: number | null; txHash?: string | null }): boolean {
  return work.onChainWorkId == null;
}

export type StallDecision = "keep-retrying" | "pause-technical";

/** When a step keeps failing without a descriptive reason changing, this
 * decides whether it's still worth a plain retry next tick or should pause
 * as an operational incident (BLOCKED_TECHNICAL) — see MAX_PIPELINE_FAILS. */
export function classifyPublishingStall(consecutiveFails: number, maxFails: number): StallDecision {
  return consecutiveFails >= maxFails ? "pause-technical" : "keep-retrying";
}
