import type { ANAWork, WorkState } from "@/lib/workStore";

// Repeated infrastructure failures slow down progressively without ever
// becoming a permanent human gate. The final tier remains weekly forever.
export const TECHNICAL_RETRY_DELAYS_MS = [
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  72 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
] as const;

export function technicalRetryDelayMs(retryCount: number): number {
  const index = Math.max(0, Math.min(TECHNICAL_RETRY_DELAYS_MS.length - 1, retryCount - 1));
  return TECHNICAL_RETRY_DELAYS_MS[index];
}

export function nextTechnicalRetryAt(now: number, retryCount: number): number {
  return now + technicalRetryDelayMs(retryCount);
}

export function technicalResumeDestination(work: Pick<ANAWork, "pausedFromState" | "stateHistory">): WorkState | undefined {
  return work.pausedFromState
    ?? [...work.stateHistory].reverse().find(h => h.state !== "BLOCKED_TECHNICAL" && h.state !== "NEEDS_RETHINK")?.state;
}

/** Rows created before autonomous recovery have no nextRetryAt. Treat them as
 * due once after deployment so the existing blocked work heals without an
 * admin click. */
export function isTechnicalRetryDue(work: Pick<ANAWork, "nextRetryAt">, now: number): boolean {
  return work.nextRetryAt == null || work.nextRetryAt <= now;
}
