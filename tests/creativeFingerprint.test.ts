import { describe, it, expect } from "vitest";
import { saveFingerprint, findMostSimilarFingerprint, FINGERPRINT_SIMILARITY_THRESHOLD } from "../src/lib/creativeFingerprint";

describe("creativeFingerprint similarity (in-memory, no Neon in test env)", () => {
  it("finds no similarity against an empty registry", async () => {
    const result = await findMostSimilarFingerprint({
      theme: "solitude of an on-chain agent", structure: "single scrolling column", palette: "monochrome",
      movementType: "static", interaction: "none", emotion: "melancholy", keywords: ["never-seen-before-keyword-xyz"],
    });
    expect(result.mostSimilarWorkId).toBeNull();
    expect(result.score).toBe(0);
  });

  it("flags a near-duplicate work above the similarity threshold", async () => {
    await saveFingerprint({
      workId: "work_original_1", theme: "entropy and decay of digital memory", structure: "recursive fractal zoom",
      palette: "cold blues and greys", movementType: "slow rotation", interaction: "mouse-reactive",
      emotion: "melancholic", refs: [], avoid: [], critique: "", lesson: "", keywords: ["entropy", "decay", "fractal", "memory"],
      createdAt: Date.now(),
    });

    const similar = await findMostSimilarFingerprint({
      theme: "entropy and decay of digital memory", structure: "recursive fractal zoom",
      palette: "cold blues and greys", movementType: "slow rotation", interaction: "mouse-reactive",
      emotion: "melancholic", keywords: ["entropy", "decay", "fractal", "memory"],
    });
    expect(similar.mostSimilarWorkId).toBe("work_original_1");
    expect(similar.score).toBeGreaterThanOrEqual(FINGERPRINT_SIMILARITY_THRESHOLD);
  });

  it("does not flag a genuinely different work", async () => {
    const different = await findMostSimilarFingerprint({
      theme: "a portrait of collective governance", structure: "grid of independent cells",
      palette: "warm oranges", movementType: "cellular automaton", interaction: "none",
      emotion: "hopeful", keywords: ["governance", "cells", "collective"],
    });
    expect(different.score).toBeLessThan(FINGERPRINT_SIMILARITY_THRESHOLD);
  });
});
