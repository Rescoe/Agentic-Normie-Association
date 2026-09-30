import { describe, expect, it } from "vitest";
import {
  TECHNICAL_RETRY_DELAYS_MS,
  isTechnicalRetryDue,
  nextTechnicalRetryAt,
  technicalResumeDestination,
  technicalRetryDelayMs,
} from "../src/lib/technicalRetry";

describe("technical retry circuit breaker", () => {
  it("backs off from two hours to a weekly retry and caps there", () => {
    expect(technicalRetryDelayMs(1)).toBe(2 * 60 * 60 * 1000);
    expect(technicalRetryDelayMs(2)).toBe(6 * 60 * 60 * 1000);
    expect(technicalRetryDelayMs(3)).toBe(24 * 60 * 60 * 1000);
    expect(technicalRetryDelayMs(4)).toBe(72 * 60 * 60 * 1000);
    expect(technicalRetryDelayMs(99)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(TECHNICAL_RETRY_DELAYS_MS).toHaveLength(5);
  });

  it("computes the next attempt from a stable timestamp", () => {
    expect(nextTechnicalRetryAt(1_000, 2)).toBe(1_000 + 6 * 60 * 60 * 1000);
  });

  it("treats legacy paused rows without nextRetryAt as due once", () => {
    expect(isTechnicalRetryDue({}, 1_000)).toBe(true);
    expect(isTechnicalRetryDue({ nextRetryAt: 999 }, 1_000)).toBe(true);
    expect(isTechnicalRetryDue({ nextRetryAt: 1_001 }, 1_000)).toBe(false);
  });

  it("resumes the exact failed state, falling back to clean history", () => {
    expect(technicalResumeDestination({ pausedFromState: "CREATING", stateHistory: [] })).toBe("CREATING");
    expect(technicalResumeDestination({
      stateHistory: [
        { state: "CREATING", at: 1 },
        { state: "BLOCKED_TECHNICAL", at: 2 },
      ],
    })).toBe("CREATING");
  });
});
