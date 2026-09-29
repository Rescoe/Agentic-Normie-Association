import { describe, it, expect, vi, beforeEach } from "vitest";

describe("persistNewsItems — regression test #15 (a save failure never marks events seen)", () => {
  it("propagates the save error and never calls markSeen", async () => {
    const { persistNewsItems } = await import("../src/lib/newsStore");
    const markSeen = vi.fn(async () => {});
    const saveNews = vi.fn(async () => { throw new Error("Neon unavailable"); });

    await expect(
      persistNewsItems(
        [{ id: "n1", sourceEventId: "work:w1:PUBLISHING:1", eventType: "WORK_PUBLISHING", title: "t", body: "b", socialText: "s", eventAt: 1, publishedAt: 1, authorTokenId: 1, authorName: "Kori", authorRole: "Rapporteur" }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { saveNews: saveNews as any, markSeen: markSeen as any },
      ),
    ).rejects.toThrow("Neon unavailable");

    expect(markSeen).not.toHaveBeenCalled();
  });

  it("marks events seen only after a successful save, with the exact sourceEventIds saved", async () => {
    const { persistNewsItems } = await import("../src/lib/newsStore");
    const markSeen = vi.fn(async () => {});
    const saveNews = vi.fn(async () => {});
    const items = [
      { id: "n1", sourceEventId: "evt-1", eventType: "X", title: "t", body: "b", socialText: "s", eventAt: 1, publishedAt: 1, authorTokenId: 1, authorName: "Kori", authorRole: "Rapporteur" as const },
      { id: "n2", sourceEventId: "evt-2", eventType: "X", title: "t2", body: "b2", socialText: "s2", eventAt: 2, publishedAt: 2, authorTokenId: 1, authorName: "Kori", authorRole: "Rapporteur" as const },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await persistNewsItems(items, { saveNews: saveNews as any, markSeen: markSeen as any });
    expect(saveNews).toHaveBeenCalledWith(items);
    expect(markSeen).toHaveBeenCalledWith(["evt-1", "evt-2"]);
  });
});

// ensureCategoryBaseline touches kv_store directly (not dependency-injected,
// unlike persistNewsItems above) — mock @/lib/db so this exercises the real
// Neon-mode branch instead of the local-dev no-op.
const store = new Map<string, string>();
vi.mock("@/lib/db", () => ({
  USE_NEON: true,
  kvGet:  vi.fn(async (key: string) => store.get(key) ?? null),
  kvSet:  vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  kvListByPrefix: vi.fn(async () => []),
}));

describe("ensureCategoryBaseline — regression test #14 (no déluge when a new fact category is introduced)", () => {
  beforeEach(() => store.clear());

  it("keeps only the most recent N and baselines (marks seen) the rest, the first time", async () => {
    const { ensureCategoryBaseline, getSeenNewsEventIds } = await import("../src/lib/newsStore");
    const ids = ["new1", "new2", "new3", "old1", "old2", "old3", "old4"]; // newest-first
    const baselined = await ensureCategoryBaseline("burn", ids, 3);
    expect(baselined).toEqual(["old1", "old2", "old3", "old4"]);
    const seen = await getSeenNewsEventIds();
    expect(seen.has("old1")).toBe(true);
    expect(seen.has("new1")).toBe(false); // the recent ones are left for the normal news pipeline to pick up
  });

  it("is a no-op on every subsequent call once the category has been baselined once", async () => {
    const { ensureCategoryBaseline } = await import("../src/lib/newsStore");
    await ensureCategoryBaseline("mint", ["a", "b", "c", "d"], 2);
    const second = await ensureCategoryBaseline("mint", ["e", "f", "g"], 2);
    expect(second).toEqual([]); // already baselined — never baselines twice
  });

  it("different categories are baselined independently", async () => {
    const { ensureCategoryBaseline } = await import("../src/lib/newsStore");
    await ensureCategoryBaseline("burn", ["b1", "b2", "b3", "b4"], 1);
    const mintResult = await ensureCategoryBaseline("mint", ["m1", "m2", "m3"], 1);
    expect(mintResult).toEqual(["m2", "m3"]); // mint's own baseline still runs — unaffected by burn's
  });
});
