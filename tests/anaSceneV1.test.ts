import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ANA_SCENE_V1_MAX_BYTES,
  SIN_Q15_256,
  canonicalizeSceneV1,
  hashArtworkSource,
  validateSceneV1,
  xorshift32,
  type AnaSceneV1,
} from "@/lib/anaSceneV1";

function fixture(): AnaSceneV1 {
  return {
    schema: "ana-scene-v1",
    rendererVersion: 1,
    seed: 1,
    tickRate: 5,
    durationTicks: 50,
    loopCount: 3,
    backgroundIndex: 0,
    palette: [0, 65535, 63488],
    clear: "solid",
    entities: [
      {
        id: 0,
        primitive: "circle",
        colorIndex: 1,
        geometry: { type: "circle", cx: 32768, cy: 32768, r: 4096, fill: true },
        motion: { type: "orbit", radiusX: 8192, radiusY: 4096, period: 50, phase: 0 },
      },
      {
        id: 1,
        primitive: "polyline",
        colorIndex: 2,
        geometry: {
          type: "polyline",
          points: [{ x: 8192, y: 8192 }, { x: 24576, y: 16384 }, { x: 16384, y: 32768 }],
          closed: true,
          width: 1,
        },
        motion: { type: "linear", dx: 64, dy: -32, edge: "wrap" },
      },
    ],
  };
}

describe("ana-scene-v1", () => {
  it("validates and canonicalizes a bounded scene", () => {
    const result = validateSceneV1(fixture());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.canonicalJson).toBe(canonicalizeSceneV1(fixture()));
    expect(Buffer.byteLength(result.canonicalJson!, "utf8")).toBeLessThanOrEqual(ANA_SCENE_V1_MAX_BYTES);
    expect(result.sceneHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("produces the same canonical bytes and hash regardless of input key order", () => {
    const source = fixture();
    const reordered = {
      entities: source.entities.map(entity => ({
        motion: entity.motion,
        geometry: entity.geometry,
        colorIndex: entity.colorIndex,
        primitive: entity.primitive,
        id: entity.id,
      })),
      clear: source.clear,
      palette: source.palette,
      backgroundIndex: source.backgroundIndex,
      loopCount: source.loopCount,
      durationTicks: source.durationTicks,
      tickRate: source.tickRate,
      seed: source.seed,
      rendererVersion: source.rendererVersion,
      schema: source.schema,
    };
    const a = validateSceneV1(source);
    const b = validateSceneV1(reordered);
    expect(b.valid).toBe(true);
    expect(b.canonicalJson).toBe(a.canonicalJson);
    expect(b.sceneHash).toBe(a.sceneHash);
  });

  it("rejects unknown keys and floating point values instead of repairing them", () => {
    const unknown = { ...fixture(), javascript: "alert(1)" };
    const floating = { ...fixture(), tickRate: 2.5 };
    expect(validateSceneV1(unknown).errors).toContain("scene: unknown key javascript");
    expect(validateSceneV1(floating).errors).toContain("scene.tickRate: expected integer 1..5");
  });

  it("rejects unsafe entity, point, palette and motion limits", () => {
    const tooMany = fixture();
    tooMany.entities = Array.from({ length: 25 }, (_, id) => ({
      id,
      primitive: "point" as const,
      colorIndex: 0,
      geometry: { type: "point" as const, x: 1, y: 1, size: 1 },
      motion: { type: "static" as const },
    }));
    expect(validateSceneV1(tooMany).valid).toBe(false);

    const outOfBounds = fixture();
    outOfBounds.entities[0] = {
      ...outOfBounds.entities[0],
      geometry: { type: "circle", cx: 100, cy: 100, r: 500, fill: true },
    };
    expect(validateSceneV1(outOfBounds).errors.some(error => error.includes("circle exceeds"))).toBe(true);

    const badPalette = { ...fixture(), palette: [65536] };
    expect(validateSceneV1(badPalette).valid).toBe(false);

    const badPeriod = fixture();
    badPeriod.entities[0] = {
      ...badPeriod.entities[0],
      motion: { type: "orbit", radiusX: 1, radiusY: 1, period: 51, phase: 0 },
    };
    expect(validateSceneV1(badPeriod).valid).toBe(false);
  });

  it("fixes the normative xorshift32 vector", () => {
    const expected = [270369, 67634689, 2647435461, 307599695, 2398689233, 745495504, 632435482, 435756210, 2005365029, 2916098932];
    const actual: number[] = [];
    let state = 1;
    for (let index = 0; index < expected.length; index++) {
      state = xorshift32(state);
      actual.push(state);
    }
    expect(actual).toEqual(expected);
  });

  it("fixes the normative Q15 sine table bytes", () => {
    expect(SIN_Q15_256).toHaveLength(256);
    const bytes = Buffer.alloc(512);
    SIN_Q15_256.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("e6ba60bf7f71eb7ace29b911099673bd949b59f9b8d07b8d1c240f3bbfb72ba3");
  });

  it("hashes the exact UTF-8 artwork bytes", () => {
    expect(hashArtworkSource("e\u0301")).not.toBe(hashArtworkSource("é"));
    expect(hashArtworkSource("same")).toBe(hashArtworkSource("same"));
  });
});
