import { describe, it, expect } from "vitest";
import {
  jaccardSimilarity, maxSimilarity, normalizeWords, needsResolution, advanceTopicPhase,
  ANA_TOPICS_FALLBACK, pickNextTopic,
} from "../src/lib/topicEngine";

describe("normalizeWords / jaccardSimilarity", () => {
  it("strips stopwords and short words", () => {
    const words = normalizeWords("the assembly's upcoming vote is a big deal");
    expect(words).not.toContain("the");
    expect(words).not.toContain("is");
    expect(words).not.toContain("a");
  });

  it("scores identical text as similarity 1", () => {
    expect(jaccardSimilarity("Normie identity and governance", "Normie identity and governance")).toBe(1);
  });

  it("scores disjoint vocabularies as 0", () => {
    expect(jaccardSimilarity("prime numbers and fractals", "treasury budget quarterly report")).toBe(0);
  });

  it("scores partial overlap strictly between 0 and 1", () => {
    const score = jaccardSimilarity("Normie identity and governance", "Normie identity and treasury");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("maxSimilarity returns 0 against an empty list", () => {
    expect(maxSimilarity("anything", [])).toBe(0);
  });
});

describe("needsResolution", () => {
  it("is false under the 8-message threshold and true at/above it", () => {
    expect(needsResolution(0)).toBe(false);
    expect(needsResolution(7)).toBe(false);
    expect(needsResolution(8)).toBe(true);
    expect(needsResolution(20)).toBe(true);
  });
});

describe("advanceTopicPhase", () => {
  it("moves through the sequence in order", () => {
    expect(advanceTopicPhase("EXPLORING")).toBe("DEBATING");
    expect(advanceTopicPhase("DEBATING")).toBe("OPTIONS_DEFINED");
    expect(advanceTopicPhase("OPTIONS_DEFINED")).toBe("READY_FOR_VOTE");
    expect(advanceTopicPhase("READY_FOR_VOTE")).toBe("DECIDED");
  });

  it("settles on CLOSED past the end of the sequence", () => {
    expect(advanceTopicPhase("DECIDED")).toBe("CLOSED");
  });

  it("never moves a PARKED or CLOSED topic", () => {
    expect(advanceTopicPhase("PARKED")).toBe("PARKED");
    expect(advanceTopicPhase("CLOSED")).toBe("CLOSED");
  });
});

describe("pickNextTopic", () => {
  it("falls back to ANA_TOPICS_FALLBACK when the dynamic queue is empty (no Neon in test env)", async () => {
    const topic = await pickNextTopic({ recentTopicTitles: [] });
    expect(ANA_TOPICS_FALLBACK).toContain(topic.title);
    expect(topic.origin).toBe("fallback");
  });
});
