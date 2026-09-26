import { describe, it, expect } from "vitest";
import {
  parseVoteChoice, computeVoteMetrics, formatTraitsForPrompt, attemptVoteTwice, getVoteQuorumRatio,
} from "../src/lib/voting";

describe("parseVoteChoice", () => {
  it("accepts a well-formed yes/no/abstain payload", () => {
    expect(parseVoteChoice({ vote: "yes", reason: "good idea" })).toEqual({ vote: "yes", reason: "good idea", interestedIn: undefined });
    expect(parseVoteChoice({ vote: "no", reason: "bad idea" })?.vote).toBe("no");
    expect(parseVoteChoice({ vote: "abstain", reason: "conflict of interest" })?.vote).toBe("abstain");
  });

  it("returns null for a missing/invalid vote field — a technical failure, never abstain", () => {
    expect(parseVoteChoice({})).toBeNull();
    expect(parseVoteChoice({ vote: "maybe" })).toBeNull();
    expect(parseVoteChoice({ reason: "no vote field at all" })).toBeNull();
  });

  it("carries interestedIn only when it's one of the three valid values", () => {
    expect(parseVoteChoice({ vote: "yes", interestedIn: "author" })?.interestedIn).toBe("author");
    expect(parseVoteChoice({ vote: "yes", interestedIn: "wizard" })?.interestedIn).toBeUndefined();
  });

  it("truncates an overlong reason to 300 chars", () => {
    const longReason = "x".repeat(500);
    expect(parseVoteChoice({ vote: "yes", reason: longReason })?.reason.length).toBe(300);
  });
});

describe("attemptVoteTwice", () => {
  it("returns the first result without retrying when it succeeds", async () => {
    let calls = 0;
    const { result, retried, invalidOutputs } = await attemptVoteTwice(async () => {
      calls++;
      return { vote: "yes" as const, reason: "ok" };
    });
    expect(calls).toBe(1);
    expect(retried).toBe(false);
    expect(invalidOutputs).toBe(0);
    expect(result?.vote).toBe("yes");
  });

  it("retries exactly once on a null (invalid) first attempt", async () => {
    let calls = 0;
    const { result, retried, invalidOutputs } = await attemptVoteTwice(async () => {
      calls++;
      return calls === 1 ? null : { vote: "no" as const, reason: "second try" };
    });
    expect(calls).toBe(2);
    expect(retried).toBe(true);
    expect(invalidOutputs).toBe(1);
    expect(result?.vote).toBe("no");
  });

  it("counts 2 invalid outputs when both attempts fail", async () => {
    const { result, invalidOutputs } = await attemptVoteTwice(async () => null);
    expect(result).toBeNull();
    expect(invalidOutputs).toBe(2);
  });
});

describe("computeVoteMetrics", () => {
  it("passes on a genuine yes majority with quorum met", () => {
    const m = computeVoteMetrics({
      eligible: 4,
      votes: [{ vote: "yes" }, { vote: "yes" }, { vote: "no" }, { vote: "abstain" }],
      invalidOutputs: 0, providerErrors: 0, retries: 0,
    });
    expect(m.passed).toBe(true);
    expect(m.quorumMet).toBe(true); // 2 yes + 1 no = 3/4 = 75% >= 50%
    expect(m.yes).toBe(2); expect(m.no).toBe(1); expect(m.abstain).toBe(1);
  });

  it("does NOT let a single yes plus abstentions pass a standard governance work — quorum gates it", () => {
    const m = computeVoteMetrics({
      eligible: 10,
      votes: [{ vote: "yes" }, { vote: "abstain" }, { vote: "abstain" }],
      invalidOutputs: 0, providerErrors: 0, retries: 0,
    });
    expect(m.quorumMet).toBe(false); // turnout is only 1/10 = 10%, well under quorum
    expect(m.passed).toBe(false); // yes(1) > no(0) alone is NOT enough without quorum (26/09 external audit finding)
  });

  it("fails a standard governance work on a tie", () => {
    const m = computeVoteMetrics({
      eligible: 2, votes: [{ vote: "yes" }, { vote: "no" }],
      invalidOutputs: 0, providerErrors: 0, retries: 0, tieBreak: "fail",
    });
    expect(m.passed).toBe(false);
  });

  it("passes a burn memorial on a tie, including 0/0", () => {
    const tie = computeVoteMetrics({ eligible: 2, votes: [{ vote: "yes" }, { vote: "no" }], invalidOutputs: 0, providerErrors: 0, retries: 0, tieBreak: "pass" });
    expect(tie.passed).toBe(true);
    const zero = computeVoteMetrics({ eligible: 4, votes: [], invalidOutputs: 0, providerErrors: 0, retries: 0, tieBreak: "pass" });
    expect(zero.passed).toBe(true);
  });

  it("respects ANA_VOTE_QUORUM_RATIO from env, defaulting to 0.5", () => {
    const original = process.env.ANA_VOTE_QUORUM_RATIO;
    try {
      delete process.env.ANA_VOTE_QUORUM_RATIO;
      expect(getVoteQuorumRatio()).toBe(0.5);
      process.env.ANA_VOTE_QUORUM_RATIO = "0.75";
      expect(getVoteQuorumRatio()).toBe(0.75);
      process.env.ANA_VOTE_QUORUM_RATIO = "not-a-number";
      expect(getVoteQuorumRatio()).toBe(0.5); // invalid value falls back to default
    } finally {
      if (original === undefined) delete process.env.ANA_VOTE_QUORUM_RATIO;
      else process.env.ANA_VOTE_QUORUM_RATIO = original;
    }
  });
});

describe("formatTraitsForPrompt", () => {
  it("never produces '[object Object]' — the Sept 2026 audit's flagged bug", () => {
    const rendered = formatTraitsForPrompt([{ trait_type: "Archetype", value: "Trickster" }, { trait_type: "Mood", value: "Curious" }]);
    expect(rendered).not.toContain("[object Object]");
    expect(rendered).toBe("Archetype: Trickster, Mood: Curious");
  });

  it("returns an em-dash placeholder for missing/empty traits", () => {
    expect(formatTraitsForPrompt(undefined)).toBe("—");
    expect(formatTraitsForPrompt([])).toBe("—");
  });
});
