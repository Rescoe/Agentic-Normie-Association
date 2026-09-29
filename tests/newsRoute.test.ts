import { describe, it, expect } from "vitest";
import { clampNewsLimit } from "../src/lib/newsMedia";
import type { ANANewsItem } from "../src/lib/newsStore";

describe("clampNewsLimit — regression test #12 (bounded /api/news)", () => {
  it("defaults to 50 when absent", () => {
    expect(clampNewsLimit(null)).toBe(50);
  });

  it("clamps an oversized request down to 100", () => {
    expect(clampNewsLimit("100000")).toBe(100);
  });

  it("clamps a zero/negative request up to 1", () => {
    expect(clampNewsLimit("0")).toBe(1);
    expect(clampNewsLimit("-5")).toBe(1);
  });

  it("falls back to 50 for garbage input, never throws", () => {
    expect(clampNewsLimit("not-a-number")).toBe(50);
  });

  it("truncates a fractional value", () => {
    expect(clampNewsLimit("12.7")).toBe(12);
  });
});

describe("regression test #12: a public news item never carries diagnostic/secret fields", () => {
  it("ANANewsItem's own shape has no validationNote/error/RPC field to leak — it's written from scratch by newsGenerator.ts, never copied from an ANAWork", () => {
    const item: ANANewsItem = {
      id: "n1", sourceEventId: "work:w1:PUBLISHING:1", eventType: "WORK_PUBLISHING",
      title: "t", body: "b", socialText: "s", eventAt: 1, publishedAt: 1,
      authorTokenId: 1, authorName: "Kori", authorRole: "Rapporteur",
    };
    const json = JSON.stringify(item);
    for (const forbidden of ["validationNote", "operationalError", "RPC_", "rpc_url", "privateKey", "PRIVATE_KEY"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
