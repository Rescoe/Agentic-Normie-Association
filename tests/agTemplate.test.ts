import { describe, it, expect } from "vitest";
import { buildAGReportHtml, AG_CERTIFICATE_MAX_BYTES } from "@/lib/agTemplate";
import type { ANAWork } from "@/lib/workStore";

function foundingWork(overrides: Partial<ANAWork> = {}): ANAWork {
  const history: ANAWork["stateHistory"] = [
    { state: "PUBLISHING", at: 1, note: "Approved by Kori" },
  ];
  for (let i = 0; i < 12; i++) {
    history.push({ state: "BLOCKED_TECHNICAL", at: 10 + i, note: "4 consecutive operational failures at PUBLISHING (TX_REVERTED) — autonomous retry scheduled" });
    history.push({ state: "PUBLISHING", at: 20 + i, note: "Autonomous retry after technical backoff — resumed at PUBLISHING" });
  }
  return {
    id: "work_test", title: "ANA's Founding Act", proposal: "p", proposedAt: 1, proposedBy: 1, proposedByName: "A",
    state: "PUBLISHING", stateHistory: history, votes: [], isFoundingWork: true,
    brief: "b".repeat(2200), artworkText: "a".repeat(1100),
    foundingContext: Array.from({ length: 20 }, (_, i) => ({ name: `N${i}`, content: "x".repeat(600), timestamp: i })),
    allElectedRoles: [{ roleLabel: "President", tokenId: 1, name: "A" }],
    ...overrides,
  } as ANAWork;
}

describe("buildAGReportHtml size budget", () => {
  it("stays under the on-chain publish ceiling even with a full Agora excerpt and many technical retries", () => {
    const html = buildAGReportHtml(foundingWork());
    expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(AG_CERTIFICATE_MAX_BYTES);
  });

  it("folds technical pause/retry cycles into a single trace line", () => {
    const html = buildAGReportHtml(foundingWork());
    expect(html).not.toContain("BLOCKED_TECHNICAL");
    expect(html).toContain("12 pause(s) technique(s)");
  });

  it("keeps the whole discussion when it already fits", () => {
    const html = buildAGReportHtml(foundingWork({ foundingContext: [{ name: "Kori", content: "hello", timestamp: 1 }] }));
    expect(html).toContain("hello");
  });
});
