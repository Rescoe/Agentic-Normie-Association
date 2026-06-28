/**
 * electionSchedule.ts — single source of truth for the constituent assembly's
 * timing, shared by the keeper (src/app/api/keeper/election-cycle) and the
 * frontend (homepage "next election" display) so they can never drift apart.
 *
 * Two distinct durations:
 *   - ELECTION_VOTE_WINDOW: how long candidacy + voting stays open within one
 *     session (matches the original constitutive AG plan: June 30 → July 7,
 *     exactly 7 days). Passed as the `durationSeconds` arg to openSession().
 *   - ELECTION_TERM: the full mandate length — time between one election
 *     OPENING and the next one opening (1 month). The elected officers hold
 *     their role for the whole term, not just the 7-day vote window.
 */

export const FIRST_ELECTION_OPEN_AT = new Date("2026-06-30T00:00:00Z").getTime();

export const ELECTION_VOTE_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const ELECTION_VOTE_WINDOW_MS      = ELECTION_VOTE_WINDOW_SECONDS * 1000;

export const ELECTION_TERM_SECONDS = 30 * 24 * 60 * 60;
export const ELECTION_TERM_MS      = ELECTION_TERM_SECONDS * 1000;

export interface SessionLike {
  id: number; openedAt: number; closedAt: number; deadline: number; active: boolean; resolved: boolean;
}

export interface NextElection {
  /** When candidacy/voting opens (ms epoch). */
  opensAt: number;
  /** When candidacy/voting closes (ms epoch). */
  closesAt: number;
  /** Whether a session is currently open for voting right now. */
  isOpen: boolean;
}

/** Computes the next (or current) election window from on-chain session state. */
export function computeNextElection(session: SessionLike | null): NextElection {
  if (!session || session.id === 0) {
    return { opensAt: FIRST_ELECTION_OPEN_AT, closesAt: FIRST_ELECTION_OPEN_AT + ELECTION_VOTE_WINDOW_MS, isOpen: false };
  }
  if (session.active) {
    return { opensAt: session.openedAt * 1000, closesAt: session.deadline * 1000, isOpen: true };
  }
  const nextOpen = session.openedAt * 1000 + ELECTION_TERM_MS;
  return { opensAt: nextOpen, closesAt: nextOpen + ELECTION_VOTE_WINDOW_MS, isOpen: false };
}
