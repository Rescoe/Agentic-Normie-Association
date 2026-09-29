import { describe, it, expect } from "vitest";
import { deriveMintUiState, unclaimedFreeTokenIds, shouldRefetchAfterSettle, type MintDerivationInput } from "../src/lib/mintState";

function input(overrides: Partial<MintDerivationInput> = {}): MintDerivationInput {
  return {
    initialized: true,
    freeCandidates: [],
    availableEditions: 5,
    txPhase: "idle",
    ...overrides,
  };
}

describe("deriveMintUiState — fail-closed claim/mint controller (29/09/2026 incident fix)", () => {
  it("regression test #7: a rejected/failed freeClaimed() read NEVER shows as eligible — it's a read-error", () => {
    const state = deriveMintUiState(input({
      freeCandidates: [{ tokenId: 2613, claimed: "unknown" }],
    }));
    expect(state).toBe("read-error");
    expect(state).not.toBe("free-eligible");
  });

  it("regression test #8: initialized() absent/unknown NEVER shows Mint — it's loading, not paid-available", () => {
    const state = deriveMintUiState(input({ initialized: "unknown", freeCandidates: [] }));
    expect(state).toBe("loading");
    expect(state).not.toBe("paid-available");
  });

  it("initialized() affirmatively false is a distinct, honest state — still never an action button", () => {
    expect(deriveMintUiState(input({ initialized: false }))).toBe("not-initialized");
  });

  it("regression test #9: a reverted transaction is its own state, never confused with success", () => {
    const state = deriveMintUiState(input({ txPhase: "reverted" }));
    expect(state).toBe("tx-reverted");
    expect(state).not.toBe("tx-confirmed");
  });

  it("a pending transaction always wins over the underlying reads, even if they'd otherwise say eligible", () => {
    const state = deriveMintUiState(input({
      txPhase: "pending",
      freeCandidates: [{ tokenId: 1, claimed: false }],
    }));
    expect(state).toBe("tx-pending");
  });

  it("a genuinely eligible, unclaimed free candidate shows free-eligible", () => {
    const st = input({ freeCandidates: [{ tokenId: 9630, claimed: false }] });
    expect(deriveMintUiState(st)).toBe("free-eligible");
    expect(unclaimedFreeTokenIds(st)).toEqual([9630]);
  });

  it("a member who already claimed for every owned Normie shows free-claimed, not paid-available", () => {
    expect(deriveMintUiState(input({ freeCandidates: [{ tokenId: 1, claimed: true }] }))).toBe("free-claimed");
  });

  it("no free candidates at all (not a member / not connected) falls through to the paid flow", () => {
    expect(deriveMintUiState(input({ freeCandidates: [], availableEditions: 3 }))).toBe("paid-available");
    expect(deriveMintUiState(input({ freeCandidates: [], availableEditions: 0 }))).toBe("sold-out");
  });

  it("unknown availableEditions is loading, never guessed as sold-out or available", () => {
    expect(deriveMintUiState(input({ freeCandidates: [], availableEditions: "unknown" }))).toBe("loading");
  });
});

describe("shouldRefetchAfterSettle — regression test #10 (refetch after confirmation)", () => {
  it("a freshly confirmed tx warrants a refetch", () => {
    expect(shouldRefetchAfterSettle("confirmed", "0xabc", null)).toBe(true);
  });

  it("does not refetch again for the same already-handled hash", () => {
    expect(shouldRefetchAfterSettle("confirmed", "0xabc", "0xabc")).toBe(false);
  });

  it("refetches again for a genuinely new transaction hash", () => {
    expect(shouldRefetchAfterSettle("confirmed", "0xdef", "0xabc")).toBe(true);
  });

  it("a reverted tx also triggers exactly one refetch (state needs re-syncing either way)", () => {
    expect(shouldRefetchAfterSettle("reverted", "0xabc", null)).toBe(true);
  });

  it("idle/pending never trigger a refetch", () => {
    expect(shouldRefetchAfterSettle("idle", undefined, null)).toBe(false);
    expect(shouldRefetchAfterSettle("pending", "0xabc", null)).toBe(false);
  });
});
