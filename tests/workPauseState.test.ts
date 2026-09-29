import { describe, it, expect } from "vitest";
import { isTechnicalPause } from "../src/lib/workPauseState";

describe("isTechnicalPause — shared by admin reconcile/resume buttons and the server action (29/09/2026 follow-up)", () => {
  it("true for BLOCKED_TECHNICAL", () => {
    expect(isTechnicalPause({ state: "BLOCKED_TECHNICAL" })).toBe(true);
  });

  it("true for a legacy NEEDS_RETHINK row with needsRethinkReason 'technical' — the 'Coffee' case", () => {
    expect(isTechnicalPause({ state: "NEEDS_RETHINK", needsRethinkReason: "technical" })).toBe(true);
  });

  it("false for a genuine creative NEEDS_RETHINK", () => {
    expect(isTechnicalPause({ state: "NEEDS_RETHINK", needsRethinkReason: "creative" })).toBe(false);
    expect(isTechnicalPause({ state: "NEEDS_RETHINK" })).toBe(false);
  });

  it("false for any normal in-progress or terminal state", () => {
    expect(isTechnicalPause({ state: "PUBLISHING" })).toBe(false);
    expect(isTechnicalPause({ state: "PUBLISHED" })).toBe(false);
    expect(isTechnicalPause({ state: "REJECTED" })).toBe(false);
  });
});
