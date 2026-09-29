import { describe, it, expect } from "vitest";
import {
  decideInitAction, decidePostInitVerification, shouldRepublish, classifyPublishingStall,
} from "../src/lib/publishDecisions";

describe("decideInitAction — 29/09/2026 'Coffee' incident fix", () => {
  it("never calls initialize() when the initialized() read failed/is unknown", () => {
    // Regression test #1 from the incident review: initialized() fails once
    // while the collection is ALREADY initialized on-chain → this must
    // resolve to retry-unknown, never call-init, so no second initialize()
    // is ever sent.
    expect(decideInitAction("unknown")).toBe("retry-unknown");
  });

  it("skips initialize() once the read confirms it's already initialized", () => {
    // Simulates the retry after the failed read above succeeding: no second
    // initialize() call, straight to skip-init.
    expect(decideInitAction(true)).toBe("skip-init");
  });

  it("calls initialize() only when the read affirmatively says false", () => {
    expect(decideInitAction(false)).toBe("call-init");
  });

  it("a full retry sequence never calls initialize() more than the necessary once", () => {
    // Tick 1: read fails.
    const tick1 = decideInitAction("unknown");
    // Tick 2: read succeeds, collection turns out to already be initialized
    // (e.g. a prior tx succeeded but the Lambda died before persisting that).
    const tick2 = decideInitAction(true);
    const initializeCalls = [tick1, tick2].filter(d => d === "call-init").length;
    expect(initializeCalls).toBe(0);
  });
});

describe("decidePostInitVerification — regression tests #2 and #3", () => {
  const base = { expectedWorkId: 0, onChainWorkId: 0 as number | "unknown", initialized: true as boolean | "unknown", artworkContentLength: 120 as number | "unknown" };

  it("a transient read failure stays retryable — never REJECTED, never a creative rethink", () => {
    // Regression test #2: verification fails temporarily.
    expect(decidePostInitVerification({ ...base, initialized: "unknown" })).toBe("retry-unknown");
    expect(decidePostInitVerification({ ...base, onChainWorkId: "unknown" })).toBe("retry-unknown");
    expect(decidePostInitVerification({ ...base, artworkContentLength: "unknown" })).toBe("retry-unknown");
  });

  it("succeeds once every read confirms the expected values — the next retry after a transient failure", () => {
    // Regression test #3: next retry, reads succeed → verified (caller then
    // advances straight to PUBLISHED without ever calling publish() again —
    // shouldRepublish() below is what prevents that).
    expect(decidePostInitVerification(base)).toBe("verified");
  });

  it("flags a genuine mismatch distinctly from an unknown read", () => {
    // Regression test #4: a real mismatch (wrong workId recorded on-chain)
    // must be reported as such, not silently retried forever.
    expect(decidePostInitVerification({ ...base, onChainWorkId: 7 })).toBe("mismatch");
    expect(decidePostInitVerification({ ...base, initialized: false })).toBe("mismatch");
    expect(decidePostInitVerification({ ...base, artworkContentLength: 0 })).toBe("mismatch");
  });
});

describe("shouldRepublish — never republishes a work with an on-chain workId", () => {
  it("republishes only when there is genuinely no onChainWorkId yet", () => {
    expect(shouldRepublish({})).toBe(true);
    expect(shouldRepublish({ onChainWorkId: null })).toBe(true);
  });

  it("never republishes once onChainWorkId is recorded, tx hash or not", () => {
    expect(shouldRepublish({ onChainWorkId: 0 })).toBe(false); // workId 0 is falsy but a real id — must not be treated as "missing"
    expect(shouldRepublish({ onChainWorkId: 5, txHash: "0xabc" })).toBe(false);
  });
});

describe("classifyPublishingStall", () => {
  it("keeps retrying below the threshold, pauses at/above it", () => {
    expect(classifyPublishingStall(3, 4)).toBe("keep-retrying");
    expect(classifyPublishingStall(4, 4)).toBe("pause-technical");
    expect(classifyPublishingStall(5, 4)).toBe("pause-technical");
  });
});
