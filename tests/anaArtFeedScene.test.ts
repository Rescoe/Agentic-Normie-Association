import { describe, expect, it } from "vitest";
import { buildFeedItems } from "@/app/api/ana-art/feed/route";
import { canonicalizeSceneV1, hashArtworkSource, hashSceneV1, type AnaSceneV1 } from "@/lib/anaSceneV1";

const scene: AnaSceneV1 = {
  schema: "ana-scene-v1",
  rendererVersion: 1,
  seed: 1,
  tickRate: 5,
  durationTicks: 10,
  loopCount: 1,
  backgroundIndex: 0,
  palette: [0, 65535],
  clear: "solid",
  entities: [{
    id: 0,
    primitive: "point",
    colorIndex: 1,
    geometry: { type: "point", x: 32768, y: 32768, size: 1 },
    motion: { type: "static" },
  }],
};

function work(overrides: Record<string, unknown> = {}) {
  const artworkText = "<!DOCTYPE html><html><body><canvas></canvas></body></html>";
  const sourceHash = hashArtworkSource(artworkText);
  return {
    id: "work_scene",
    state: "PUBLISHED",
    artForm: "html-canvas",
    artworkText,
    title: "Scene work",
    proposedBy: 7,
    proposedByName: "Normie Seven",
    proposedAt: 100,
    authorTokenId: 7,
    authorName: "Normie Seven",
    publishedAt: 200,
    votes: [],
    stateHistory: [],
    podSceneJson: canonicalizeSceneV1(scene),
    podSceneHash: hashSceneV1(scene),
    podSceneSourceHash: sourceHash,
    podSceneRevision: 1,
    podCapturePixels: Buffer.alloc(128 * 160).toString("base64"),
    podCaptureWidth: 128,
    podCaptureHeight: 160,
    podCaptureAt: 150,
    podCaptureTimeMs: 500,
    podCaptureHash: "sha256:capture-a",
    podCaptureSourceHash: sourceHash,
    ...overrides,
  };
}

describe("ANA art feed generative bundle", () => {
  it("emits one content-addressed item carrying scene and capture", () => {
    const items = buildFeedItems([work() as never], []);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("generative-capture");
    expect(items[0].scene?.schema).toBe("ana-scene-v1");
    expect(items[0].capture?.width).toBe(128);
    expect(items[0].id).toMatch(/^ana-work:work_scene:generative:[0-9a-f]{64}$/);
  });

  it("keeps a scene-only item for scene-aware PoD", () => {
    const items = buildFeedItems([work({
      podCapturePixels: undefined,
      podCaptureHash: undefined,
      podCaptureSourceHash: undefined,
    }) as never], []);
    expect(items).toHaveLength(1);
    expect(items[0].scene).toBeDefined();
    expect(items[0].capture).toBeUndefined();
  });

  it("keeps capture fallback when scene source hash is stale", () => {
    const items = buildFeedItems([work({ podSceneSourceHash: "sha256:stale" }) as never], []);
    expect(items).toHaveLength(1);
    expect(items[0].scene).toBeUndefined();
    expect(items[0].capture).toBeDefined();
  });

  it("does not emit stale derivatives or unpublished works", () => {
    expect(buildFeedItems([work({ podSceneSourceHash: "sha256:stale", podCaptureSourceHash: "sha256:stale" }) as never], []))
      .toHaveLength(0);
    expect(buildFeedItems([work({ state: "VALIDATING" }) as never], [])).toHaveLength(0);
  });

  it("changes the delivery id when capture content changes", () => {
    const first = buildFeedItems([work() as never], [])[0];
    const second = buildFeedItems([work({ podCaptureHash: "sha256:capture-b" }) as never], [])[0];
    expect(second.sourceId).toBe(first.sourceId);
    expect(second.id).not.toBe(first.id);
    expect(second.contentHash).not.toBe(first.contentHash);
  });
});
