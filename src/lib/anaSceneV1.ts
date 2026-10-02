import { createHash } from "node:crypto";

export const ANA_SCENE_V1_SCHEMA = "ana-scene-v1" as const;
export const ANA_SCENE_V1_RENDERER_VERSION = 1 as const;
export const ANA_SCENE_V1_MAX_BYTES = 4_096;
export const ANA_SCENE_V1_MAX_ENTITIES = 24;
export const ANA_SCENE_V1_MAX_POINTS = 16;
export const ANA_SCENE_V1_MAX_TICKS = 50;
export const ANA_SCENE_V1_MAX_OPERATIONS_PER_TICK = 256;

export type ScenePrimitiveV1 = "point" | "line" | "rect" | "circle" | "polyline";

export type SceneMotionV1 =
  | { type: "static" }
  | { type: "linear"; dx: number; dy: number; edge: "wrap" }
  | { type: "oscillate-x" | "oscillate-y"; amplitude: number; period: number; phase: number }
  | { type: "orbit"; radiusX: number; radiusY: number; period: number; phase: number };

export type SceneGeometryV1 =
  | { type: "point"; x: number; y: number; size: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; width: number }
  | { type: "rect"; x0: number; y0: number; x1: number; y1: number; fill: boolean }
  | { type: "circle"; cx: number; cy: number; r: number; fill: boolean }
  | { type: "polyline"; points: Array<{ x: number; y: number }>; closed: boolean; width: number };

export interface SceneEntityV1 {
  id: number;
  primitive: ScenePrimitiveV1;
  colorIndex: number;
  geometry: SceneGeometryV1;
  motion: SceneMotionV1;
}

export interface AnaSceneV1 {
  schema: typeof ANA_SCENE_V1_SCHEMA;
  rendererVersion: typeof ANA_SCENE_V1_RENDERER_VERSION;
  seed: number;
  tickRate: number;
  durationTicks: number;
  loopCount: number;
  backgroundIndex: number;
  palette: number[]; // RGB565, 0..65535
  clear: "solid";
  entities: SceneEntityV1[];
}

export interface SceneValidationResult {
  valid: boolean;
  errors: string[];
  scene?: AnaSceneV1;
  canonicalJson?: string;
  sceneHash?: string;
}

const SCENE_KEYS = ["schema", "rendererVersion", "seed", "tickRate", "durationTicks", "loopCount", "backgroundIndex", "palette", "clear", "entities"];
const ENTITY_KEYS = ["id", "primitive", "colorIndex", "geometry", "motion"];
const GEOMETRY_KEYS: Record<ScenePrimitiveV1, string[]> = {
  point: ["type", "x", "y", "size"],
  line: ["type", "x1", "y1", "x2", "y2", "width"],
  rect: ["type", "x0", "y0", "x1", "y1", "fill"],
  circle: ["type", "cx", "cy", "r", "fill"],
  polyline: ["type", "points", "closed", "width"],
};
const MOTION_KEYS: Record<SceneMotionV1["type"], string[]> = {
  static: ["type"],
  linear: ["type", "dx", "dy", "edge"],
  "oscillate-x": ["type", "amplitude", "period", "phase"],
  "oscillate-y": ["type", "amplitude", "period", "phase"],
  orbit: ["type", "radiusX", "radiusY", "period", "phase"],
};

// Normative signed Q15 sine table. PoD's TypeScript renderer and both firmware
// implementations must copy these exact 256 integers; no runtime floating point
// trigonometry is part of the scene contract.
export const SIN_Q15_256 = [
  0, 804, 1608, 2410, 3212, 4011, 4808, 5602, 6393, 7179, 7962, 8739, 9512, 10278, 11039, 11793,
  12539, 13279, 14010, 14732, 15446, 16151, 16846, 17530, 18204, 18868, 19519, 20159, 20787, 21403, 22005, 22594,
  23170, 23731, 24279, 24811, 25329, 25832, 26319, 26790, 27245, 27683, 28105, 28510, 28898, 29268, 29621, 29956,
  30273, 30571, 30852, 31113, 31356, 31580, 31785, 31971, 32137, 32285, 32412, 32521, 32609, 32678, 32728, 32757,
  32767, 32757, 32728, 32678, 32609, 32521, 32412, 32285, 32137, 31971, 31785, 31580, 31356, 31113, 30852, 30571,
  30273, 29956, 29621, 29268, 28898, 28510, 28105, 27683, 27245, 26790, 26319, 25832, 25329, 24811, 24279, 23731,
  23170, 22594, 22005, 21403, 20787, 20159, 19519, 18868, 18204, 17530, 16846, 16151, 15446, 14732, 14010, 13279,
  12539, 11793, 11039, 10278, 9512, 8739, 7962, 7179, 6393, 5602, 4808, 4011, 3212, 2410, 1608, 804,
  0, -804, -1608, -2410, -3212, -4011, -4808, -5602, -6393, -7179, -7962, -8739, -9512, -10278, -11039, -11793,
  -12539, -13279, -14010, -14732, -15446, -16151, -16846, -17530, -18204, -18868, -19519, -20159, -20787, -21403, -22005, -22594,
  -23170, -23731, -24279, -24811, -25329, -25832, -26319, -26790, -27245, -27683, -28105, -28510, -28898, -29268, -29621, -29956,
  -30273, -30571, -30852, -31113, -31356, -31580, -31785, -31971, -32137, -32285, -32412, -32521, -32609, -32678, -32728, -32757,
  -32767, -32757, -32728, -32678, -32609, -32521, -32412, -32285, -32137, -31971, -31785, -31580, -31356, -31113, -30852, -30571,
  -30273, -29956, -29621, -29268, -28898, -28510, -28105, -27683, -27245, -26790, -26319, -25832, -25329, -24811, -24279, -23731,
  -23170, -22594, -22005, -21403, -20787, -20159, -19519, -18868, -18204, -17530, -16846, -16151, -15446, -14732, -14010, -13279,
  -12539, -11793, -11039, -10278, -9512, -8739, -7962, -7179, -6393, -5602, -4808, -4011, -3212, -2410, -1608, -804,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string, errors: string[]): void {
  const actual = Object.keys(value);
  for (const key of actual) if (!expected.includes(key)) errors.push(`${path}: unknown key ${key}`);
  for (const key of expected) if (!(key in value)) errors.push(`${path}: missing key ${key}`);
}

function integer(value: unknown, min: number, max: number, path: string, errors: string[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    errors.push(`${path}: expected integer ${min}..${max}`);
    return false;
  }
  return true;
}

function boolean(value: unknown, path: string, errors: string[]): value is boolean {
  if (typeof value !== "boolean") {
    errors.push(`${path}: expected boolean`);
    return false;
  }
  return true;
}

function validateMotion(raw: unknown, durationTicks: number, path: string, errors: string[]): SceneMotionV1 | null {
  if (!isRecord(raw) || typeof raw.type !== "string" || !(raw.type in MOTION_KEYS)) {
    errors.push(`${path}: unsupported motion`);
    return null;
  }
  const type = raw.type as SceneMotionV1["type"];
  exactKeys(raw, MOTION_KEYS[type], path, errors);
  if (type === "static") return { type };
  if (type === "linear") {
    const dxOk = integer(raw.dx, -32768, 32767, `${path}.dx`, errors);
    const dyOk = integer(raw.dy, -32768, 32767, `${path}.dy`, errors);
    const ok = dxOk && dyOk;
    if (raw.edge !== "wrap") errors.push(`${path}.edge: expected wrap`);
    return ok && raw.edge === "wrap" ? { type, dx: raw.dx as number, dy: raw.dy as number, edge: "wrap" } : null;
  }
  const periodOk = integer(raw.period, 2, durationTicks, `${path}.period`, errors);
  const phaseOk = periodOk && integer(raw.phase, 0, (raw.period as number) - 1, `${path}.phase`, errors);
  if (type === "orbit") {
    const radiusXOk = integer(raw.radiusX, 0, 32767, `${path}.radiusX`, errors);
    const radiusYOk = integer(raw.radiusY, 0, 32767, `${path}.radiusY`, errors);
    const radiusOk = radiusXOk && radiusYOk;
    return radiusOk && phaseOk ? {
      type, radiusX: raw.radiusX as number, radiusY: raw.radiusY as number,
      period: raw.period as number, phase: raw.phase as number,
    } : null;
  }
  const amplitudeOk = integer(raw.amplitude, 0, 32767, `${path}.amplitude`, errors);
  return amplitudeOk && phaseOk ? {
    type, amplitude: raw.amplitude as number, period: raw.period as number, phase: raw.phase as number,
  } : null;
}

function validateGeometry(raw: unknown, primitive: ScenePrimitiveV1, path: string, errors: string[]): SceneGeometryV1 | null {
  if (!isRecord(raw)) {
    errors.push(`${path}: expected object`);
    return null;
  }
  exactKeys(raw, GEOMETRY_KEYS[primitive], path, errors);
  if (raw.type !== primitive) errors.push(`${path}.type: must equal primitive ${primitive}`);
  const u16 = (key: string) => integer(raw[key], 0, 65535, `${path}.${key}`, errors);
  if (primitive === "point") {
    return u16("x") && u16("y") && integer(raw.size, 1, 4, `${path}.size`, errors) && raw.type === primitive
      ? { type: primitive, x: raw.x as number, y: raw.y as number, size: raw.size as number } : null;
  }
  if (primitive === "line") {
    return u16("x1") && u16("y1") && u16("x2") && u16("y2")
      && integer(raw.width, 1, 4, `${path}.width`, errors) && raw.type === primitive
      ? { type: primitive, x1: raw.x1 as number, y1: raw.y1 as number, x2: raw.x2 as number, y2: raw.y2 as number, width: raw.width as number } : null;
  }
  if (primitive === "rect") {
    const ok = u16("x0") && u16("y0") && u16("x1") && u16("y1") && boolean(raw.fill, `${path}.fill`, errors);
    if (ok && ((raw.x0 as number) > (raw.x1 as number) || (raw.y0 as number) > (raw.y1 as number))) errors.push(`${path}: rect bounds are reversed`);
    return ok && (raw.x0 as number) <= (raw.x1 as number) && (raw.y0 as number) <= (raw.y1 as number) && raw.type === primitive
      ? { type: primitive, x0: raw.x0 as number, y0: raw.y0 as number, x1: raw.x1 as number, y1: raw.y1 as number, fill: raw.fill as boolean } : null;
  }
  if (primitive === "circle") {
    const ok = u16("cx") && u16("cy") && integer(raw.r, 1, 32767, `${path}.r`, errors) && boolean(raw.fill, `${path}.fill`, errors);
    if (ok && ((raw.cx as number) < (raw.r as number) || (raw.cy as number) < (raw.r as number)
      || (raw.cx as number) + (raw.r as number) > 65535 || (raw.cy as number) + (raw.r as number) > 65535)) {
      errors.push(`${path}: circle exceeds normalized canvas`);
    }
    return ok && raw.type === primitive ? { type: primitive, cx: raw.cx as number, cy: raw.cy as number, r: raw.r as number, fill: raw.fill as boolean } : null;
  }
  if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > ANA_SCENE_V1_MAX_POINTS) {
    errors.push(`${path}.points: expected 2..${ANA_SCENE_V1_MAX_POINTS} points`);
    return null;
  }
  const points: Array<{ x: number; y: number }> = [];
  raw.points.forEach((point, index) => {
    const pointPath = `${path}.points[${index}]`;
    if (!isRecord(point)) return errors.push(`${pointPath}: expected object`);
    exactKeys(point, ["x", "y"], pointPath, errors);
    if (integer(point.x, 0, 65535, `${pointPath}.x`, errors) && integer(point.y, 0, 65535, `${pointPath}.y`, errors)) {
      points.push({ x: point.x, y: point.y });
    }
  });
  const restOk = boolean(raw.closed, `${path}.closed`, errors) && integer(raw.width, 1, 4, `${path}.width`, errors);
  return points.length === raw.points.length && restOk && raw.type === primitive
    ? { type: primitive, points, closed: raw.closed as boolean, width: raw.width as number } : null;
}

function geometryBounds(geometry: SceneGeometryV1): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (geometry.type) {
    case "point": return { minX: geometry.x, minY: geometry.y, maxX: geometry.x, maxY: geometry.y };
    case "line": return { minX: Math.min(geometry.x1, geometry.x2), minY: Math.min(geometry.y1, geometry.y2), maxX: Math.max(geometry.x1, geometry.x2), maxY: Math.max(geometry.y1, geometry.y2) };
    case "rect": return { minX: geometry.x0, minY: geometry.y0, maxX: geometry.x1, maxY: geometry.y1 };
    case "circle": return { minX: geometry.cx - geometry.r, minY: geometry.cy - geometry.r, maxX: geometry.cx + geometry.r, maxY: geometry.cy + geometry.r };
    case "polyline": return {
      minX: Math.min(...geometry.points.map(p => p.x)), minY: Math.min(...geometry.points.map(p => p.y)),
      maxX: Math.max(...geometry.points.map(p => p.x)), maxY: Math.max(...geometry.points.map(p => p.y)),
    };
  }
}

function validateMotionBounds(entity: SceneEntityV1, path: string, errors: string[]): void {
  const bounds = geometryBounds(entity.geometry);
  const motion = entity.motion;
  const fitsX = (radius: number) => bounds.minX >= radius && bounds.maxX + radius <= 65535;
  const fitsY = (radius: number) => bounds.minY >= radius && bounds.maxY + radius <= 65535;
  if (motion.type === "oscillate-x" && !fitsX(motion.amplitude)) errors.push(`${path}.motion: oscillation exceeds horizontal canvas`);
  if (motion.type === "oscillate-y" && !fitsY(motion.amplitude)) errors.push(`${path}.motion: oscillation exceeds vertical canvas`);
  if (motion.type === "orbit" && (!fitsX(motion.radiusX) || !fitsY(motion.radiusY))) errors.push(`${path}.motion: orbit exceeds normalized canvas`);
}

function operationCost(entity: SceneEntityV1): number {
  switch (entity.primitive) {
    case "point": return 1;
    case "line": return 1;
    case "rect": return 4;
    case "circle": return 8;
    case "polyline": return entity.geometry.type === "polyline" ? entity.geometry.points.length + (entity.geometry.closed ? 1 : 0) : 0;
  }
}

function canonicalGeometry(geometry: SceneGeometryV1): SceneGeometryV1 {
  switch (geometry.type) {
    case "point": return { type: geometry.type, x: geometry.x, y: geometry.y, size: geometry.size };
    case "line": return { type: geometry.type, x1: geometry.x1, y1: geometry.y1, x2: geometry.x2, y2: geometry.y2, width: geometry.width };
    case "rect": return { type: geometry.type, x0: geometry.x0, y0: geometry.y0, x1: geometry.x1, y1: geometry.y1, fill: geometry.fill };
    case "circle": return { type: geometry.type, cx: geometry.cx, cy: geometry.cy, r: geometry.r, fill: geometry.fill };
    case "polyline": return { type: geometry.type, points: geometry.points.map(p => ({ x: p.x, y: p.y })), closed: geometry.closed, width: geometry.width };
  }
}

function canonicalMotion(motion: SceneMotionV1): SceneMotionV1 {
  switch (motion.type) {
    case "static": return { type: motion.type };
    case "linear": return { type: motion.type, dx: motion.dx, dy: motion.dy, edge: motion.edge };
    case "oscillate-x":
    case "oscillate-y": return { type: motion.type, amplitude: motion.amplitude, period: motion.period, phase: motion.phase };
    case "orbit": return { type: motion.type, radiusX: motion.radiusX, radiusY: motion.radiusY, period: motion.period, phase: motion.phase };
  }
}

export function canonicalizeSceneV1(scene: AnaSceneV1): string {
  const canonical: AnaSceneV1 = {
    schema: ANA_SCENE_V1_SCHEMA,
    rendererVersion: ANA_SCENE_V1_RENDERER_VERSION,
    seed: scene.seed,
    tickRate: scene.tickRate,
    durationTicks: scene.durationTicks,
    loopCount: scene.loopCount,
    backgroundIndex: scene.backgroundIndex,
    palette: [...scene.palette],
    clear: "solid",
    entities: scene.entities.map(entity => ({
      id: entity.id,
      primitive: entity.primitive,
      colorIndex: entity.colorIndex,
      geometry: canonicalGeometry(entity.geometry),
      motion: canonicalMotion(entity.motion),
    })),
  };
  return JSON.stringify(canonical);
}

export function hashSceneV1(scene: AnaSceneV1): string {
  return `sha256:${createHash("sha256").update(`ana-scene-v1\0${canonicalizeSceneV1(scene)}`, "utf8").digest("hex")}`;
}

export function hashArtworkSource(artworkText: string): string {
  return `sha256:${createHash("sha256").update(artworkText, "utf8").digest("hex")}`;
}

export function hashSceneEnvelope(sourceId: string, revision: number, sourceHash: string, sceneHash: string): string {
  return `sha256:${createHash("sha256").update(`ana-generative-scene-v1\0${sourceId}\0${revision}\0${sourceHash}\0${sceneHash}`, "utf8").digest("hex")}`;
}

export function hashGenerativeBundle(
  sourceId: string,
  revision: number,
  sourceHash: string,
  sceneHash?: string,
  captureHash?: string,
): string {
  return `sha256:${createHash("sha256").update(
    `ana-generative-bundle-v1\0${sourceId}\0${revision}\0${sourceHash}\0${sceneHash ?? "none"}\0${captureHash ?? "none"}`,
    "utf8",
  ).digest("hex")}`;
}

/** xorshift32 reference step; all bitwise operations are explicitly uint32. */
export function xorshift32(state: number): number {
  let x = state >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

function motionOffset(motion: SceneMotionV1, tick: number): { x: number; y: number } {
  if (motion.type === "static") return { x: 0, y: 0 };
  if (motion.type === "linear") return { x: motion.dx * tick, y: motion.dy * tick };
  const index = Math.floor((((tick + motion.phase) % motion.period) * 256) / motion.period) & 255;
  const sin = SIN_Q15_256[index];
  if (motion.type === "oscillate-x") return { x: Math.trunc((motion.amplitude * sin) / 32767), y: 0 };
  if (motion.type === "oscillate-y") return { x: 0, y: Math.trunc((motion.amplitude * sin) / 32767) };
  const orbit = motion as Extract<SceneMotionV1, { type: "orbit" }>;
  const cos = SIN_Q15_256[(index + 64) & 255];
  return { x: Math.trunc((orbit.radiusX * cos) / 32767), y: Math.trunc((orbit.radiusY * sin) / 32767) };
}

function simulateScene(scene: AnaSceneV1, errors: string[]): void {
  for (let tick = 0; tick < scene.durationTicks; tick++) {
    for (let index = 0; index < scene.entities.length; index++) {
      const entity = scene.entities[index];
      const offset = motionOffset(entity.motion, tick);
      if (!Number.isSafeInteger(offset.x) || !Number.isSafeInteger(offset.y)) {
        errors.push(`entities[${index}]: unsafe arithmetic at tick ${tick}`);
        return;
      }
    }
  }
}

export function validateSceneV1(raw: unknown): SceneValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { valid: false, errors: ["scene: expected object"] };
  exactKeys(raw, SCENE_KEYS, "scene", errors);
  if (raw.schema !== ANA_SCENE_V1_SCHEMA) errors.push(`scene.schema: expected ${ANA_SCENE_V1_SCHEMA}`);
  if (raw.rendererVersion !== ANA_SCENE_V1_RENDERER_VERSION) errors.push("scene.rendererVersion: expected 1");
  integer(raw.seed, 1, 0xffffffff, "scene.seed", errors);
  integer(raw.tickRate, 1, 5, "scene.tickRate", errors);
  integer(raw.durationTicks, 1, ANA_SCENE_V1_MAX_TICKS, "scene.durationTicks", errors);
  integer(raw.loopCount, 1, 3, "scene.loopCount", errors);
  if (raw.clear !== "solid") errors.push("scene.clear: expected solid");
  if (!Array.isArray(raw.palette) || raw.palette.length < 1 || raw.palette.length > 8) {
    errors.push("scene.palette: expected 1..8 RGB565 integers");
  }
  const palette = Array.isArray(raw.palette) ? raw.palette : [];
  palette.forEach((color, index) => integer(color, 0, 65535, `scene.palette[${index}]`, errors));
  integer(raw.backgroundIndex, 0, Math.max(0, palette.length - 1), "scene.backgroundIndex", errors);
  if (!Array.isArray(raw.entities) || raw.entities.length < 1 || raw.entities.length > ANA_SCENE_V1_MAX_ENTITIES) {
    errors.push(`scene.entities: expected 1..${ANA_SCENE_V1_MAX_ENTITIES} entities`);
  }
  const durationTicks = Number.isSafeInteger(raw.durationTicks) ? raw.durationTicks as number : ANA_SCENE_V1_MAX_TICKS;
  const entities: SceneEntityV1[] = [];
  const ids = new Set<number>();
  if (Array.isArray(raw.entities)) raw.entities.forEach((item, index) => {
    const path = `scene.entities[${index}]`;
    if (!isRecord(item)) return errors.push(`${path}: expected object`);
    exactKeys(item, ENTITY_KEYS, path, errors);
    const primitive = item.primitive;
    if (typeof primitive !== "string" || !(primitive in GEOMETRY_KEYS)) {
      errors.push(`${path}.primitive: unsupported primitive`);
      return;
    }
    const idOk = integer(item.id, 0, ANA_SCENE_V1_MAX_ENTITIES - 1, `${path}.id`, errors);
    if (idOk && ids.has(item.id as number)) errors.push(`${path}.id: duplicate id ${item.id}`);
    if (idOk) ids.add(item.id as number);
    const colorOk = integer(item.colorIndex, 0, Math.max(0, palette.length - 1), `${path}.colorIndex`, errors);
    const geometry = validateGeometry(item.geometry, primitive as ScenePrimitiveV1, `${path}.geometry`, errors);
    const motion = validateMotion(item.motion, durationTicks, `${path}.motion`, errors);
    if (idOk && colorOk && geometry && motion) {
      const entity: SceneEntityV1 = { id: item.id as number, primitive: primitive as ScenePrimitiveV1, colorIndex: item.colorIndex as number, geometry, motion };
      validateMotionBounds(entity, path, errors);
      entities.push(entity);
    }
  });

  const operationCount = entities.reduce((sum, entity) => sum + operationCost(entity), 0);
  if (operationCount > ANA_SCENE_V1_MAX_OPERATIONS_PER_TICK) {
    errors.push(`scene.entities: ${operationCount} logical operations per tick exceeds ${ANA_SCENE_V1_MAX_OPERATIONS_PER_TICK}`);
  }
  if (errors.length > 0) return { valid: false, errors };

  const scene: AnaSceneV1 = {
    schema: ANA_SCENE_V1_SCHEMA,
    rendererVersion: ANA_SCENE_V1_RENDERER_VERSION,
    seed: raw.seed as number,
    tickRate: raw.tickRate as number,
    durationTicks: raw.durationTicks as number,
    loopCount: raw.loopCount as number,
    backgroundIndex: raw.backgroundIndex as number,
    palette: palette as number[],
    clear: "solid",
    entities,
  };
  simulateScene(scene, errors);
  const canonicalJson = canonicalizeSceneV1(scene);
  const byteLength = Buffer.byteLength(canonicalJson, "utf8");
  if (byteLength > ANA_SCENE_V1_MAX_BYTES) errors.push(`scene: canonical JSON is ${byteLength} bytes, maximum is ${ANA_SCENE_V1_MAX_BYTES}`);
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], scene, canonicalJson, sceneHash: hashSceneV1(scene) };
}
