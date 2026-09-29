/**
 * workPauseState.ts — single source of truth for "is this work paused by
 * infrastructure, not a creative or vote decision".
 *
 * Deliberately its own tiny, dependency-free module (no fs/path/next-cache —
 * unlike workStore.ts) so it can be imported by both server routes AND
 * client components (src/app/[locale]/admin/page.tsx) without dragging a
 * server-only module into the browser bundle.
 *
 * 29/09/2026 follow-up incident: the admin page's reconcile buttons checked
 * `state === "BLOCKED_TECHNICAL"` only, while the resume button (and the
 * server's own resumeTechnical action) already covered the legacy case too
 * (a NEEDS_RETHINK row written before BLOCKED_TECHNICAL existed, with
 * needsRethinkReason "technical") — so "Autonomous Agent's Coffee" (a legacy
 * row) could be resumed but never showed the reconcile buttons that would
 * have actually fixed it. Every caller must go through this one function.
 */

export interface PausableWork {
  state:               string;
  needsRethinkReason?: "technical" | "creative";
}

export function isTechnicalPause(w: PausableWork): boolean {
  return w.state === "BLOCKED_TECHNICAL" || (w.state === "NEEDS_RETHINK" && w.needsRethinkReason === "technical");
}
