import { describe, it, expect } from "vitest";
import { flagDevNeedFromMessage, listDevRequests, updateDevRequestStatus } from "../src/lib/devRequests";
import type { SalonMessage } from "../src/lib/salonStore";

function msg(overrides: Partial<SalonMessage> = {}): SalonMessage {
  return {
    id: `msg_${Math.random()}`, salonId: "salon_agora_ana", tokenId: 1, name: "Axiom",
    imageUrl: "", content: "[DEV-NEEDED] the memorial list route returns a 500 sometimes",
    isLlm: true, timestamp: Date.now(), ...overrides,
  };
}

describe("devRequests — flag and dedup (in-memory, no Neon in test env)", () => {
  it("creates a fresh OBSERVED request from a tagged message", async () => {
    const m = msg({ content: "[DEV-NEEDED] the certificate iframe never loads on Safari, unique-case-a" });
    await flagDevNeedFromMessage(m);
    const all = await listDevRequests("OBSERVED");
    const created = all.find(r => r.problem.includes("unique-case-a"));
    expect(created).toBeDefined();
    expect(created?.authorTokenId).toBe(1);
    expect(created?.supports).toContain(1);
  });

  it("folds a second similar observation into the existing request instead of duplicating it", async () => {
    const topic = "the vote endpoint occasionally times out under load, unique-case-b";
    await flagDevNeedFromMessage(msg({ tokenId: 2, name: "Nyx", content: `[DEV-NEEDED] ${topic}` }));
    const beforeCount = (await listDevRequests()).filter(r => r.problem.includes("unique-case-b")).length;
    expect(beforeCount).toBe(1);

    await flagDevNeedFromMessage(msg({ tokenId: 5, name: "Kori", content: `[DEV-NEEDED] ${topic} — confirmed again` }));
    const afterAll = await listDevRequests();
    const matching = afterAll.filter(r => r.problem.includes("unique-case-b") || r.evidence.some(e => e.includes("unique-case-b")));
    expect(matching.length).toBe(1); // still one request, not two
    expect(matching[0].supports).toContain(5);
  });

  it("moves a request through the status lifecycle", async () => {
    const m = msg({ content: "[DEV-NEEDED] a genuinely unique problem for lifecycle test, unique-case-c" });
    await flagDevNeedFromMessage(m);
    const created = (await listDevRequests()).find(r => r.problem.includes("unique-case-c"));
    expect(created).toBeDefined();

    const result = await updateDevRequestStatus(created!.id, "HUMAN_REVIEW", "Looking into it");
    expect(result.ok).toBe(true);
    const updated = (await listDevRequests()).find(r => r.id === created!.id);
    expect(updated?.status).toBe("HUMAN_REVIEW");
    expect(updated?.humanResponse).toBe("Looking into it");
  });

  it("returns an error for an unknown request id", async () => {
    const result = await updateDevRequestStatus("dn_does_not_exist", "CLOSED");
    expect(result.ok).toBe(false);
  });
});
