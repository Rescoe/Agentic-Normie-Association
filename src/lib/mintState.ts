/**
 * mintState.ts — fail-closed state derivation for the claim/mint UI.
 *
 * Root cause this exists for (29/09/2026 incident review — "Claim free"
 * appearing/disappearing on Coffee): the free-claim and paid-mint buttons
 * were two independent React components, neither of which had a single
 * source of truth for "is it actually safe to show an action right now".
 * Concretely:
 *   - ClaimFreeEditionButton never checked initialized() before offering a claim.
 *   - Its freeClaimed() reads went through Promise.allSettled and treated a
 *     REJECTED read the same as a successful "false" read — an RPC hiccup
 *     looked exactly like "you haven't claimed yet, go ahead".
 *   - Neither component waited for a transaction receipt before declaring
 *     success — writeContractAsync() resolving only means the wallet
 *     accepted/broadcast the tx, not that it was mined, let alone that it
 *     succeeded.
 *
 * This module is the single, pure (no wagmi/network) decision function both
 * the free-claim and paid-mint UI now go through — every unknown/failed read
 * degrades to "read-error" or "loading", NEVER to "go ahead, it's eligible".
 * Kept separate from the React component so it can be unit-tested directly
 * against plain objects.
 */

export type MintUiState =
  | "loading"
  | "read-error"
  | "not-initialized"
  | "free-eligible"
  | "free-claimed"
  | "paid-available"
  | "sold-out"
  | "tx-pending"
  | "tx-confirmed"
  | "tx-reverted";

export type TriBool = boolean | "unknown";

export interface FreeClaimCandidate {
  tokenId: number;
  /** "unknown" covers both "still loading" and "the read failed/reverted" —
   * both must be treated identically: never as "not yet claimed". */
  claimed: TriBool;
}

export interface MintDerivationInput {
  /** initialized() on the ANAEditions collection. "unknown" = still loading
   * OR the read failed — never coerced to false (a failed read is not proof
   * the collection isn't initialized). */
  initialized: TriBool;
  /** Free-claim candidates owned by the connected wallet (member tokenIds
   * eligible for claimFree on THIS collection). Empty if not connected, not
   * a member, or the collection doesn't support free claims (legacy core()). */
  freeCandidates: FreeClaimCandidate[];
  /** getAvailableEditions() — "unknown" while loading/failed. */
  availableEditions: number | "unknown";
  /** In-flight write lifecycle, tracked by the caller via
   * useWriteContract()/useWaitForTransactionReceipt(). "idle" when nothing
   * has been submitted (or a previous tx's outcome was already reset). */
  txPhase: "idle" | "pending" | "confirmed" | "reverted";
}

/**
 * Pure decision function. Order matters and is deliberate:
 *   1. An in-flight/just-settled tx always wins — the UI is showing that
 *      outcome, not re-deriving from reads that may still be stale.
 *   2. initialized() must be affirmatively true before ANY action shows.
 *   3. A free-claim candidate read failing is a read-error, never "eligible".
 *   4. Only once free-claim is resolved (no candidates, or all claimed) does
 *      the paid path even get considered.
 */
export function deriveMintUiState(input: MintDerivationInput): MintUiState {
  if (input.txPhase === "pending")   return "tx-pending";
  if (input.txPhase === "reverted")  return "tx-reverted";
  if (input.txPhase === "confirmed") return "tx-confirmed";

  if (input.initialized === "unknown") return "loading";
  if (input.initialized === false)     return "not-initialized";

  if (input.freeCandidates.some(c => c.claimed === "unknown")) return "read-error";
  const unclaimed = input.freeCandidates.filter(c => c.claimed === false);
  if (unclaimed.length > 0) return "free-eligible";
  if (input.freeCandidates.length > 0) return "free-claimed";

  if (input.availableEditions === "unknown") return "loading";
  if (input.availableEditions === 0) return "sold-out";
  return "paid-available";
}

/** tokenIds still eligible for a free claim — only meaningful in "free-eligible". */
export function unclaimedFreeTokenIds(input: MintDerivationInput): number[] {
  return input.freeCandidates.filter(c => c.claimed === false).map(c => c.tokenId);
}

/**
 * Whether a just-settled (confirmed or reverted) transaction warrants an
 * on-chain refetch (totalMinted/getAvailableEditions/freeClaimed) right now
 * — exactly once per transaction, not on every re-render while its receipt
 * stays "confirmed". `lastSettledHash` is the caller's own record of the last
 * hash it already refetched for (null before any tx has settled).
 */
export function shouldRefetchAfterSettle(
  txPhase: MintDerivationInput["txPhase"],
  txHash: string | undefined,
  lastSettledHash: string | null,
): boolean {
  if (txPhase !== "confirmed" && txPhase !== "reverted") return false;
  return lastSettledHash !== (txHash ?? null);
}
