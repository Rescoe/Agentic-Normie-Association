import { describe, it, expect } from "vitest";
import { toPublicWork, ACTIVE_STATES, type ANAWork } from "../src/lib/workStore";

const SECRET = "SECRET_TEST_VALUE_xyz789";

function fullWork(overrides: Partial<ANAWork> = {}): ANAWork {
  return {
    id: "work_test_1", proposedBy: 1, proposedByName: "Kori", proposedAt: Date.now(),
    title: "Test Work", proposal: "A test proposal", state: "BLOCKED_TECHNICAL",
    stateHistory: [{ state: "PUBLISHING", at: Date.now(), note: "publishing" }],
    votes: [],
    // Diagnostic/internal fields that must NEVER reach the public DTO —
    // including one carrying the P0 test's fake secret, exactly as a raw RPC
    // error could (29/09/2026 incident).
    validationNote: `RPC call failed for https://provider.example/v2/${SECRET}`,
    operationalErrorMessage: `also mentions ${SECRET}`,
    operationalErrorCode: "RPC_READ_UNKNOWN",
    operationalFailCount: 4,
    pipelineFailCount: 4,
    similarFailureStreak: 2,
    voteInvalidOutputs: 1,
    voteProviderErrors: 1,
    voteRetries: 1,
    lastAttemptAt: Date.now(),
    nextRetryAt: Date.now(),
    rapporteurArbiterTokenId: 42,
    ...overrides,
  } as ANAWork;
}

describe("toPublicWork — allow-list DTO (P0 secret-leak fix)", () => {
  it("required test: neither validationNote nor the test's fake secret value ever appear in the public DTO", () => {
    const pub = toPublicWork(fullWork());
    const json = JSON.stringify(pub);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("validationNote");
    expect((pub as Record<string, unknown>).validationNote).toBeUndefined();
  });

  it("strips every other diagnostic/internal field too", () => {
    const pub = toPublicWork(fullWork()) as Record<string, unknown>;
    for (const field of [
      "operationalErrorMessage", "operationalErrorCode", "operationalFailCount",
      "pipelineFailCount", "similarFailureStreak",
      "voteInvalidOutputs", "voteProviderErrors", "voteRetries",
      "lastAttemptAt", "nextRetryAt", "rapporteurArbiterTokenId",
    ]) {
      expect(pub[field]).toBeUndefined();
    }
  });

  it("still exposes every field the public works UI actually renders", () => {
    const pub = toPublicWork(fullWork());
    expect(pub.id).toBe("work_test_1");
    expect(pub.title).toBe("Test Work");
    expect(pub.state).toBe("BLOCKED_TECHNICAL");
    expect(pub.stateHistory).toHaveLength(1);
    expect(pub.proposedByName).toBe("Kori");
  });

  it("a stateHistory note is passed through as stored — already redacted at write time by workStore.advanceState(), not re-redacted here", () => {
    // toPublicWork() is an allow-list of FIELDS, not a second redaction pass —
    // the actual secret-safety for free-text fields happens once, at write
    // time (updateWork()/advanceState()). This test documents that split of
    // responsibility so it isn't "fixed" by accident into double-redaction.
    const pub = toPublicWork(fullWork({ stateHistory: [{ state: "PUBLISHING", at: 1, note: "already clean" }] }));
    expect(pub.stateHistory[0].note).toBe("already clean");
  });
});

describe("ACTIVE_STATES — regression test #11 (paused works stay visible)", () => {
  it("includes both NEEDS_RETHINK and BLOCKED_TECHNICAL — a paused work is neither published nor rejected", () => {
    expect(ACTIVE_STATES).toContain("NEEDS_RETHINK");
    expect(ACTIVE_STATES).toContain("BLOCKED_TECHNICAL");
  });

  it("does not include the terminal states", () => {
    expect(ACTIVE_STATES).not.toContain("PUBLISHED");
    expect(ACTIVE_STATES).not.toContain("REJECTED");
  });
});
