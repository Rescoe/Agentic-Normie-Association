/**
 * voting.ts — shared, provider-agnostic vote parsing/tallying/quorum logic.
 *
 * Extracted from work-lifecycle's castVote()/tallyVotes() so the rules (an
 * invalid LLM output is a technical failure, never a silent abstention; a
 * quorum is explicit and measured separately from the majority check) are
 * defined once and unit-testable without spinning up Groq or Neon — see
 * tests/voting.test.ts.
 *
 * Design constraints from the Sept 2026 cognition audit:
 *   - JSON parse/shape failure → return null (caller retries next tick), NEVER
 *     record "abstain". Abstention is a real vote the model chose to cast.
 *   - Quorum is measured (eligible members who cast yes/no) and reported
 *     separately from the yes>no majority check — a single "yes" plus a pile
 *     of abstentions must not silently pass as if quorum were met.
 *   - Every outcome (valid vote, invalid output, provider error, retry) is
 *     counted so /api/admin/observability can alert on abstention>50% or
 *     invalid-output-rate>10% across recent votes (see llmLedger.ts sibling
 *     concerns — this file only computes the numbers, it doesn't store them).
 */

export type VoteChoice = "yes" | "no" | "abstain";

export interface ParsedVote {
  vote:   VoteChoice;
  reason: string;
  interestedIn?: "author" | "curator" | "none";
}

/**
 * Strict shape check on an already-JSON-extracted object. Returns null for
 * anything that isn't a genuine, explicit yes/no/abstain — a missing or
 * malformed `vote` field is a parsing/technical failure, not a decision.
 */
export function parseVoteChoice(raw: Record<string, unknown>): ParsedVote | null {
  const vote = raw.vote;
  if (vote !== "yes" && vote !== "no" && vote !== "abstain") return null;
  const reasonRaw = raw.reason;
  const reason = typeof reasonRaw === "string" ? reasonRaw.slice(0, 300) : "";
  const interestedRaw = raw.interestedIn;
  const interestedIn = (interestedRaw === "author" || interestedRaw === "curator" || interestedRaw === "none")
    ? interestedRaw
    : undefined;
  return { vote, reason, interestedIn };
}

/**
 * Runs `attempt` up to twice: once, and — only if it returns null (a parse/
 * shape failure, distinguished from a thrown provider error) — one immediate
 * short retry. A thrown error is NOT retried here; it propagates so the
 * caller can count it as a providerError distinctly from an invalidOutput.
 * Mirrors the audit's rule: "a JSON error gets one immediate retry; after two
 * failures, providerError, retried at the next cycle" — the *next cycle*
 * part is naturally satisfied because the caller (stepVoteOpen) re-attempts
 * any member who still hasn't voted on every subsequent tick.
 */
export async function attemptVoteTwice(
  attempt: () => Promise<ParsedVote | null>,
): Promise<{ result: ParsedVote | null; retried: boolean; invalidOutputs: number }> {
  const first = await attempt();
  if (first) return { result: first, retried: false, invalidOutputs: 0 };
  const second = await attempt();
  return { result: second, retried: true, invalidOutputs: second ? 1 : 2 };
}

export interface VoteMetricsInput {
  eligible:        number;
  votes:           Array<{ vote: VoteChoice }>;
  invalidOutputs:  number;
  providerErrors:  number;
  retries:         number;
  /** Memorials pass on a tie (moderation, not governance) — see workStore.tallyVotes' own note. */
  tieBreak?: "pass" | "fail";
}

export interface VoteMetrics {
  eligible:        number;
  validVotes:      number;
  yes:             number;
  no:              number;
  abstain:         number;
  invalidOutputs:  number;
  providerErrors:  number;
  retries:         number;
  /** Fraction of eligible members who cast a yes/no (abstentions don't count toward quorum). */
  turnoutRatio:    number;
  quorumMet:       boolean;
  passed:          boolean;
}

// Default per the pérennité study: at least 50% of eligible members must have
// expressed yes/no (not abstain) before the yes>no majority check is treated
// as a confident decision. Configurable via env so this can be tuned without
// a code change as membership scales.
export function getVoteQuorumRatio(): number {
  const raw = Number(process.env.ANA_VOTE_QUORUM_RATIO);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.5;
}

export function computeVoteMetrics(input: VoteMetricsInput): VoteMetrics {
  const yes     = input.votes.filter(v => v.vote === "yes").length;
  const no      = input.votes.filter(v => v.vote === "no").length;
  const abstain = input.votes.filter(v => v.vote === "abstain").length;
  const validVotes = yes + no + abstain;

  const turnout = yes + no;
  const turnoutRatio = input.eligible > 0 ? turnout / input.eligible : 0;
  const quorumMet = turnoutRatio >= getVoteQuorumRatio();

  const tieBreak = input.tieBreak ?? "fail";
  const majorityPassed = yes === no ? tieBreak === "pass" : yes > no;
  // Quorum actually GATES standard governance votes — a first external audit
  // (26/09/2026, after this quorum measurement first shipped) correctly
  // flagged that computing quorumMet and then resolving on majority
  // regardless meant "1 yes + 3 abstentions" could still pass a 4-member
  // vote. tieBreak:"pass" is only ever passed for burn memorials (see
  // work-lifecycle's stepVoteOpen) — those are moderation of an
  // already-created piece, not a governance decision, and are meant to pass
  // even on 0/0 turnout (an LLM outage shouldn't block honoring a burn) — so
  // memorials are deliberately exempt from the quorum gate, everything else
  // is not.
  const passed = tieBreak === "pass" ? majorityPassed : (quorumMet && majorityPassed);

  return {
    eligible:       input.eligible,
    validVotes,
    yes, no, abstain,
    invalidOutputs: input.invalidOutputs,
    providerErrors: input.providerErrors,
    retries:        input.retries,
    turnoutRatio,
    quorumMet,
    passed,
  };
}

/** Formats a persona's traits for an LLM prompt — `trait_type: value`, never
 *  a bare `.join()` on an array of objects (that produced literal
 *  "[object Object]" strings in vote/creation prompts — Sept 2026 audit §5). */
export function formatTraitsForPrompt(
  traits: Array<{ trait_type: string; value: string }> | undefined,
): string {
  if (!traits || traits.length === 0) return "—";
  return traits.slice(0, 6).map(t => `${t.trait_type}: ${t.value}`).join(", ");
}
