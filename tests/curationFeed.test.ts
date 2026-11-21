import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildCurationPage, isCurationEligible, parseCurationQuery, toCurationWork, MAX_LIMIT } from "../src/lib/curationFeed";
import { toPublicWork, type ANAWork } from "../src/lib/workStore";

const SECRET = "https://provider.example/v2/LEAKED_KEY_abc123";

function work(id: number, over: Partial<ANAWork> = {}): ANAWork {
  return {
    id: `work_${id}`, proposedBy: 6848, proposedByName: "Kori", proposedAt: Date.UTC(2026, 10, 1),
    title: `Work ${id}`, proposal: "A proposal", state: "PUBLISHED", stateHistory: [], votes: [],
    artForm: "html-p5js", artworkText: "<!DOCTYPE html><html></html>",
    authorTokenId: 5271, authorName: "Ulpe", curatorTokenId: 2613, curatorName: "Sadel", rapporteurTokenId: 9630, rapporteurName: "Piwe",
    onChainWorkId: id, txHash: `0x${String(id).padStart(64, "a")}`, collectionAddress: `0x${String(id).padStart(40, "b")}`,
    publishedAt: Date.UTC(2026, 10, 6), yesCount: 4, noCount: 0, absCount: 0, totalVoters: 4, voteResult: "passed",
    // fields that must never leave through this API:
    validationNote: SECRET, operationalErrorMessage: SECRET, pipelineFailCount: 3, podSceneJson: "{secret-scene}", podCapturePixels: "AAAA",
    ...over,
  } as ANAWork;
}
const pub = (ws: ANAWork[]) => ws.map(toPublicWork);
const ORIGIN = "https://agentic-normie-association.xyz";
const REG = "0x93eaDEDB7192aE29Cb47616CEc0E3C98d99A47f5";

describe("curation contract — what is exposed", () => {
  it("exposes a published on-chain work and nothing outside the public allow-list", () => {
    const page = buildCurationPage(pub([work(9)]), { before: null, limit: 50 }, ORIGIN, REG);
    const json = JSON.stringify(page);
    expect(page.works).toHaveLength(1);
    for (const forbidden of [SECRET, "validationNote", "operationalErrorMessage", "pipelineFailCount", "podScene", "podCapture", "secret-scene"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("describes a generative work by link, never by inlining its HTML", () => {
    const w = toCurationWork(toPublicWork(work(9)), ORIGIN, REG);
    expect(w.kind).toBe("generative");
    expect(w.text).toBeNull();
    expect(w.links.artwork).toBe(`${ORIGIN}/api/works/html/9`);
    expect(w.embeddable).toBe(false);
    expect(w.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(w)).not.toContain("<!DOCTYPE");
  });

  it("carries a literary text in full", () => {
    const w = toCurationWork(toPublicWork(work(1, { artForm: "haiku", artworkText: "old pond\nfrog leaps in\nsound of water" })), ORIGIN, REG);
    expect(w.kind).toBe("text");
    expect(w.text).toContain("frog leaps in");
    expect(w.links.artwork).toBeNull();
  });

  it("states provenance honestly and names every role", () => {
    const w = toCurationWork(toPublicWork(work(9)), ORIGIN, REG);
    expect(w.provenance.aiGenerated).toBe(true);
    expect(w.creators).toEqual({
      proposer: { tokenId: 6848, name: "Kori" }, author: { tokenId: 5271, name: "Ulpe" },
      curator: { tokenId: 2613, name: "Sadel" }, rapporteur: { tokenId: 9630, name: "Piwe" },
    });
    expect(w.cartel).toEqual({ top: "ANA · work #9 · 2026-11-06", bottom: "Ulpe — Work 9" });
    expect(w.vote).toEqual({ passed: true, yes: 4, no: 0, abstain: 0, voters: 4 });
    expect(w.onchain).toMatchObject({ chainId: 8453, network: "base", workRegistry: REG, onChainWorkId: 9 });
    expect(w.onchain.explorer.tx).toContain("https://basescan.org/tx/0x");
  });

  it("marks the founding act as such and leaves its HTML report out", () => {
    const w = toCurationWork(toPublicWork(work(6, { isFoundingWork: true, artForm: undefined, artworkText: "<html>AG</html>" })), ORIGIN, REG);
    expect(w.kind).toBe("founding-act");
    expect(w.text).toBeNull();
  });

  it("only lists works that are published, on-chain and not memorials", () => {
    const ws = pub([
      work(1), work(2, { state: "CREATING" }), work(3, { onChainWorkId: undefined }),
      work(4, { isBurnMemorial: true }), work(5, { memorialKind: "burn" } as Partial<ANAWork>),
    ]);
    expect(ws.filter(isCurationEligible).map(w => w.onChainWorkId)).toEqual([1]);
  });
});

describe("pagination", () => {
  const all = pub(Array.from({ length: 12 }, (_, i) => work(i)));
  it("is newest first with a cursor", () => {
    const first = buildCurationPage(all, { before: null, limit: 5 }, ORIGIN, REG);
    expect(first.works.map(w => w.id)).toEqual(["11", "10", "9", "8", "7"]);
    expect(first.next).toBe(7);
    const second = buildCurationPage(all, { before: first.next, limit: 5 }, ORIGIN, REG);
    expect(second.works.map(w => w.id)).toEqual(["6", "5", "4", "3", "2"]);
    const third = buildCurationPage(all, { before: second.next, limit: 5 }, ORIGIN, REG);
    expect(third.works.map(w => w.id)).toEqual(["1", "0"]);
    expect(third.next).toBeNull();
  });
  it("ends cleanly when the last page is exactly full", () => {
    expect(buildCurationPage(all, { before: null, limit: 12 }, ORIGIN, REG).next).toBeNull();
  });
  it("returns an empty list, not an error, on an empty association", () => {
    const page = buildCurationPage([], { before: null, limit: 50 }, ORIGIN, REG);
    expect(page).toMatchObject({ version: 1, source: "ana", works: [], next: null });
  });
});

describe("parseCurationQuery", () => {
  const q = (s: string) => parseCurationQuery(new URLSearchParams(s));
  it("defaults, and accepts valid values", () => {
    expect(q("")).toEqual({ before: null, limit: 50 });
    expect(q("before=7&limit=100")).toEqual({ before: 7, limit: 100 });
  });
  it("rejects nonsense with a message instead of guessing", () => {
    for (const bad of ["before=-1", "before=abc", "before=1.5", "limit=0", `limit=${MAX_LIMIT + 1}`, "limit=x"]) {
      expect(q(bad), bad).toHaveProperty("error");
    }
  });
});

describe("routes", () => {
  beforeEach(() => vi.resetModules());

  async function loadRoutes(works: ANAWork[]) {
    vi.doMock("../src/lib/workStore", async () => {
      const real = await vi.importActual<typeof import("../src/lib/workStore")>("../src/lib/workStore");
      return { ...real, listWorks: async () => works };
    });
    const list = await import("../src/app/api/v1/curation/works/route");
    const one = await import("../src/app/api/v1/curation/works/[id]/route");
    return { list, one };
  }
  const req = (path: string) => new NextRequest(`${ORIGIN}${path}`);

  it("list: public, CORS-open, edge-cached, no secret needed", async () => {
    const { list } = await loadRoutes([work(1), work(2)]);
    const res = await list.GET(req("/api/v1/curation/works?limit=1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=1800");
    const body = await res.json();
    expect(body.works).toHaveLength(1);
    expect(body.works[0].links.self).toBe(`${ORIGIN}/api/v1/curation/works/2`);
    expect(body.next).toBe(2);
  });

  it("list: a bad cursor is a 400 that is never cached", async () => {
    const { list } = await loadRoutes([]);
    const res = await list.GET(req("/api/v1/curation/works?limit=500"));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("detail: found, not found, malformed", async () => {
    const { one } = await loadRoutes([work(3), work(4, { state: "CREATING" })]);
    const ok = await one.GET(req("/api/v1/curation/works/3"), { params: { id: "3" } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).work.id).toBe("3");
    expect((await one.GET(req("/api/v1/curation/works/4"), { params: { id: "4" } })).status).toBe(404);
    expect((await one.GET(req("/api/v1/curation/works/x"), { params: { id: "x" } })).status).toBe(400);
  });

  it("answers the CORS preflight", async () => {
    const { list } = await loadRoutes([]);
    const res = list.OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
