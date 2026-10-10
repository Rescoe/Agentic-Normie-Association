import { describe, expect, it } from "vitest";
import { buildCollectionIdentity } from "../src/lib/collectionIdentity";

describe("buildCollectionIdentity", () => {
  it("is deterministic for the same work", () => {
    const input = { workId: "work_1791471625814_tmd5x", title: "Unburned Roots Reveries", authorName: "Kori" };
    expect(buildCollectionIdentity(input)).toEqual(buildCollectionIdentity(input));
  });

  it("gives different contracts different names and symbols even for the same agent and title", () => {
    const shared = { title: "Untitled", authorName: "Kori" };
    const first = buildCollectionIdentity({ ...shared, workId: "work_one" });
    const second = buildCollectionIdentity({ ...shared, workId: "work_two" });

    expect(first.name).not.toBe(second.name);
    expect(first.symbol).not.toBe(second.symbol);
  });

  it("keeps the work and agent visible while producing a marketplace-safe symbol", () => {
    const identity = buildCollectionIdentity({
      workId: "work_brutalist_echoes",
      title: "Brutalist Echoes in Light",
      authorName: "Ulpe",
    });

    expect(identity.name).toContain("Brutalist Echoes in Light");
    expect(identity.name).toContain("Ulpe");
    expect(identity.symbol).toMatch(/^ANA-[A-F0-9]{8}$/);
  });

  it("normalizes control characters and supplies readable fallbacks", () => {
    const identity = buildCollectionIdentity({
      workId: "work_fallback",
      title: " \n\t ",
      authorName: "\u0000",
    });

    expect(identity.name).toContain("Untitled Work");
    expect(identity.name).toContain("ANA");
    expect(identity.name).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
});
