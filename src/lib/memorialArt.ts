/**
 * memorialArt.ts — a burn memorial's visual is a real creative act by the
 * proposer Normie: their own persona/system-prompt/history, informed by the
 * persona(s) of the burned Normie(s) being honored (traits, archetype,
 * canvas/level, fetched the same way any other Normie identity is —
 * normiesApi.ts/normiesPersona.ts). Not a mechanically generated pattern.
 *
 * Because the piece still has to end up as a raw B&W pixel buffer for e-ink
 * screens (proof-of-draw), the LLM doesn't paint pixels directly — it
 * composes a short list of simple geometric primitives (rect/circle/line/
 * dots) on the canvas, which rasterize() renders deterministically and
 * safely (bounded shape count, clamped coordinates, no code execution).
 *
 * The "cartel" (artist statement) is the LLM's own words about the piece —
 * stored on the work for the gallery/certificate, never sent to proof-of-draw
 * (GET /api/ana-art/feed only exposes pixels/canvasW/canvasH/title/agent).
 */

import { groqFetch } from "@/lib/groq";
import {
  buildPersona, buildSystemPrompt, personaToPromptBlock, sampleOtherMembers,
  type NormiePersona,
} from "@/lib/normiesPersona";
import { listWorks } from "@/lib/workStore";

// Deliberately larger than any single physical e-ink target (264x176/296x128/
// 128x64 — see proof-of-draw's screenProfiles.ts) — this is a canonical
// "master" resolution, downscaled per-screen off-chain at delivery time (a
// proof-of-draw concern, not this repo's), never matched 1:1 to one device.
// Was 264x176 (exactly the 2.7" e-ink's own profile) until generalized to
// 528x352 (a real fix, since 264x176 meant every other screen type received
// an image sized for a device it wasn't) — then found and fixed BACK DOWN to
// 360x240 (23/09) after a real on-chain failure: encodeArtworkContent()
// (pixelImage.ts) picks the SMALLER of a raw-pixel BMP fallback and a
// run-length-encoded SVG, and that BMP fallback's size is fixed by canvas
// AREA alone, completely independent of what's actually drawn — a dense
// composition (a maximalComplexity monument, especially after
// densifyComposition's firmer shape-count floor) can fall back to it. At
// 528x352 that fallback is ~31KB, and registerMemorial() storing a ~31KB
// string genuinely exceeds the ~16.7M gas mainnet.base.org enforces per
// call — confirmed live (an actual "Monument — 2,000 Normies" registration
// reverted "out of gas" on-chain) and reproduced/measured in Hardhat.
// 360x240 keeps the worst-case BMP fallback around ~10.6M gas (real margin
// under both the relayer's 15M gas limit and Base's ~16.7M cap) while still
// comfortably exceeding every individual physical screen's own resolution in
// both dimensions (max width 296, max height 176) — the property the
// generalization was for in the first place. Any future increase MUST be
// re-measured against registerMemorial()'s actual worst case (see the
// gas-cap sanity tests in test/ANAMemorials.test.ts), not assumed safe.
export const MEMORIAL_CANVAS_W = 360;
export const MEMORIAL_CANVAS_H = 240;

// Memorials are never for sale — the piece honors a departed member, it isn't
// a Normie-priced edition. Set explicitly at creation (check-burns.ts,
// request-memorial.ts, and the vote-retry recreation in work-lifecycle.ts)
// rather than left undefined: stepBriefing (where standard works get an
// LLM-chosen price) never runs for isBurnMemorial works, so this was already
// the de facto behavior (stepPublishing treats undefined editionPrice as 0)
// — making it explicit documents the intent instead of relying on a fallback.
export const MEMORIAL_EDITION_PRICE  = "0";
export const MEMORIAL_EDITION_SUPPLY = 1;

const MODEL      = "openai/gpt-oss-120b";
// 18, not 28 — measured (Hardhat, explicit gas limit, not eth_estimateGas)
// against the worst case this many shapes can produce via the RLE-SVG
// encoding path. NOTE, corrected 23/09 after a real on-chain failure: this
// bounds the RLE-SVG path only. encodeArtworkContent() (pixelImage.ts) picks
// whichever of RLE-SVG or a raw-pixel BMP is SMALLER, and the BMP fallback's
// size depends on canvas AREA alone — completely bypassing MAX_SHAPES/
// MAX_CIRCLE_RADIUS/MAX_DOTS_TOTAL_AREA, which is exactly what let a real
// monument's registerMemorial() exceed Base's ~16.7M gas cap despite these
// caps. The TRUE worst-case bound is MEMORIAL_CANVAS_W/H above (see its own
// comment) — these shape caps matter for keeping the RLE-SVG path itself
// reasonably sized, not for bounding the absolute worst case anymore.
const MAX_SHAPES = 18;
// Circle radius and total "dots" (per-pixel random noise) area are capped in
// ABSOLUTE pixels, not scaled with canvas size — filled/hollow rects and
// lines cost roughly the same regardless of canvas resolution (they collapse
// to a handful of <rect>s in encodeArtworkContent's RLE encoding either way),
// but circles and dots don't compress as well, and DO scale with resolution
// if left uncapped. Measured: a single 40x40 dots patch at max density costs
// ~5.6M gas alone; uncapped dots on a bigger canvas has produced actual
// "ran out of gas" reverts in testing (the same failure mode this project
// already hit multiple times this session for related reasons).
const MAX_CIRCLE_RADIUS    = 25;
const MAX_DOTS_TOTAL_AREA  = 1600; // shared budget across every "dots" shape in one composition
const MAX_BURNED_IN_PROMPT = 5; // cap prompt size/cost for very large batch burns

type Shape =
  | { type: "rect";   x: number; y: number; w: number; h: number; fill?: boolean }
  | { type: "circle"; cx: number; cy: number; r: number; fill?: boolean }
  | { type: "line";   x1: number; y1: number; x2: number; y2: number; thickness?: number }
  | { type: "dots";   x: number; y: number; w: number; h: number; density?: number };

export interface MemorialArtwork {
  pixels: Uint8Array;
  cartel: string;
}

// ─── Rasterizer — safe, bounded, no code execution ───────────────────────────

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, v));
}

function rasterize(rawShapes: unknown): Uint8Array {
  const w = MEMORIAL_CANVAS_W, h = MEMORIAL_CANVAS_H;
  const pixels = new Uint8Array(w * h).fill(255);
  const setBlack = (x: number, y: number) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    pixels[y * w + x] = 0;
  };

  const shapes = (Array.isArray(rawShapes) ? rawShapes : []).slice(0, MAX_SHAPES) as Record<string, unknown>[];
  let dotsAreaBudget = MAX_DOTS_TOTAL_AREA; // shared across every "dots" shape below, see the constant's comment

  for (const s of shapes) {
    if (s.type === "rect") {
      const x = clampNum(s.x, 0, w - 1, 0), y = clampNum(s.y, 0, h - 1, 0);
      const sw = clampNum(s.w, 1, w, 10), sh = clampNum(s.h, 1, h, 10);
      const x1 = Math.min(x + sw, w), y1 = Math.min(y + sh, h);
      const fill = s.fill !== false;
      for (let yy = y; yy < y1; yy++) {
        for (let xx = x; xx < x1; xx++) {
          if (fill || xx === x || xx === x1 - 1 || yy === y || yy === y1 - 1) setBlack(xx, yy);
        }
      }
    } else if (s.type === "circle") {
      const cx = clampNum(s.cx, 0, w, w / 2), cy = clampNum(s.cy, 0, h, h / 2);
      const r  = clampNum(s.r, 1, MAX_CIRCLE_RADIUS, 10);
      const fill = s.fill !== false;
      for (let yy = Math.max(0, cy - r); yy < Math.min(h, cy + r); yy++) {
        for (let xx = Math.max(0, cx - r); xx < Math.min(w, cx + r); xx++) {
          const d = Math.hypot(xx - cx, yy - cy);
          if (fill ? d <= r : (d <= r && d >= r - 1.5)) setBlack(xx, yy);
        }
      }
    } else if (s.type === "line") {
      const x1 = clampNum(s.x1, 0, w - 1, 0), y1 = clampNum(s.y1, 0, h - 1, 0);
      const x2 = clampNum(s.x2, 0, w - 1, w - 1), y2 = clampNum(s.y2, 0, h - 1, h - 1);
      const thickness = clampNum(s.thickness, 1, 6, 1);
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
      const half = Math.floor(thickness / 2);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
        for (let dx = -half; dx <= half; dx++) for (let dy = -half; dy <= half; dy++) setBlack(x + dx, y + dy);
      }
    } else if (s.type === "dots") {
      if (dotsAreaBudget <= 0) continue; // budget exhausted by an earlier dots shape — skip, don't error
      const x = clampNum(s.x, 0, w - 1, 0), y = clampNum(s.y, 0, h - 1, 0);
      let sw = clampNum(s.w, 1, w, 20), sh = clampNum(s.h, 1, h, 20);
      // Clamp to whatever's left of the shared budget (roughly preserving
      // this shape's own aspect ratio) rather than the canvas bounds — random
      // noise doesn't compress the way rects/circles do, so area here (not
      // canvas size) is what actually drives on-chain storage cost.
      if (sw * sh > dotsAreaBudget) {
        const scale = Math.sqrt(dotsAreaBudget / (sw * sh));
        sw = Math.max(1, Math.floor(sw * scale));
        sh = Math.max(1, Math.floor(sh * scale));
      }
      dotsAreaBudget -= sw * sh;
      const density = clampNum(s.density, 0.05, 0.9, 0.3);
      let seed = (Math.round(x) * 31 + Math.round(y) * 17 + Math.round(sw) * 7 + Math.round(sh) * 3) >>> 0 || 1;
      const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 0xffffffff; };
      for (let yy = y; yy < Math.min(y + sh, h); yy++) {
        for (let xx = x; xx < Math.min(x + sw, w); xx++) {
          if (rand() < density) setBlack(xx, yy);
        }
      }
    }
  }

  return pixels;
}

// ─── LLM creative call ────────────────────────────────────────────────────────

async function groq(messages: Array<{ role: "system" | "user"; content: string }>, maxTokens: number): Promise<string | null> {
  try {
    const res = await groqFetch({
      model: MODEL, messages, max_tokens: maxTokens, temperature: 0.85,
      response_format: { type: "json_object" },
    });
    if (!res.ok) { console.error(`[memorialArt] Groq ${res.status}`); return null; }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.error("[memorialArt] groq error:", e);
    return null;
  }
}

// Firm floor for a monument's shape count — matches the prompt's own "at
// least 10" instruction. LLMs don't reliably obey numeric constraints, so
// this is enforced with a second pass rather than trusted on the first try.
const MIN_MONUMENT_SHAPES = 10;

/**
 * One bounded extra Groq call, ONLY reached when a monument's first pass
 * under-delivered on MIN_MONUMENT_SHAPES — never for ordinary memorials, and
 * never a second call just because one happened to succeed. Shows the model
 * its own composition and asks it to expand (not restart) it. Kept separate
 * from createMemorialArtwork so the "when do we even attempt this" gating
 * stays visible at the call site, not buried in here.
 */
async function densifyComposition(
  current: { cartel: string; shapes: unknown[] },
  proposer: NormiePersona,
  otherMembers: NormiePersona[],
): Promise<{ cartel: string; shapes: unknown[] } | null> {
  const prompt = `Your last composition for this monument only used ${current.shapes.length} shapes, but a monument this significant needs at least ${MIN_MONUMENT_SHAPES} to read as elaborate. Here is what you made:

{"cartel":${JSON.stringify(current.cartel)},"shapes":${JSON.stringify(current.shapes)}}

Expand it: ADD more shapes (keep the ones above, don't remove or replace them) until you reach at least ${MIN_MONUMENT_SHAPES}, using the same primitives (rect/circle/line/dots, max ${MAX_SHAPES} total) and the same ${MEMORIAL_CANVAS_W}x${MEMORIAL_CANVAS_H} canvas. Keep the cartel as-is unless you genuinely want to refine its wording. Return the full, expanded composition, not just the new shapes.

JSON only:
{"cartel":"your artist statement","shapes":[...]}`;

  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(proposer, sampleOtherMembers(otherMembers)) },
      { role: "user", content: prompt },
    ],
    2200,
  );
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { cartel?: string; shapes?: unknown };
    if (!Array.isArray(parsed.shapes) || parsed.shapes.length === 0) return null;
    const cartel = (parsed.cartel ?? current.cartel).trim().slice(0, 500) || current.cartel;
    return { cartel, shapes: parsed.shapes };
  } catch (e) {
    console.error("[memorialArt] densifyComposition JSON parse failed:", e);
    return null;
  }
}

/** Fallback used only if the LLM call itself fails outright — never the intended path. */
function fallbackArtwork(): MemorialArtwork {
  return {
    pixels: rasterize([
      { type: "rect", x: 8, y: 8, w: MEMORIAL_CANVAS_W - 16, h: MEMORIAL_CANVAS_H - 16, fill: false },
      { type: "circle", cx: MEMORIAL_CANVAS_W / 2, cy: MEMORIAL_CANVAS_H / 2, r: MAX_CIRCLE_RADIUS, fill: false },
    ]),
    cartel: "A minimal mark, offered when the words and shapes wouldn't come.",
  };
}

export async function createMemorialArtwork(params: {
  proposer: NormiePersona;
  burnedTokenIds: number[];
  otherMembers: NormiePersona[];
  // For a milestone monument: burnedTokenIds is only a small representative
  // sample (fetching/prompting with thousands of real tokenIds would be
  // wasteful and pointless — MAX_BURNED_IN_PROMPT caps it to 5 anyway), but
  // the piece should still frame itself as honoring the TRUE total. Ignored
  // when absent — ordinary memorials use burnedTokenIds.length as before.
  totalHonoredOverride?: number;
  // A milestone monument should visibly read as more complex than an
  // ordinary single/handful-of-burns memorial — overrides the usual
  // "favor a few deliberate forms" minimalism guidance with permission (not
  // an obligation) to use the full MAX_SHAPES budget.
  maximalComplexity?: boolean;
}): Promise<MemorialArtwork> {
  const { proposer, burnedTokenIds, otherMembers, totalHonoredOverride, maximalComplexity } = params;
  const honoredCount = totalHonoredOverride ?? burnedTokenIds.length;

  const burnedPersonas = (await Promise.allSettled(
    burnedTokenIds.slice(0, MAX_BURNED_IN_PROMPT).map(id => buildPersona(id)),
  )).filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled").map(r => r.value);

  const burnedBlock = burnedPersonas.length > 0
    ? burnedPersonas.map(p => personaToPromptBlock(p, "departed — being memorialized")).join("\n\n")
    : `Normie${burnedTokenIds.length > 1 ? "s" : ""} #${burnedTokenIds.join(", #")} — identity data unavailable, honor them by number.`;

  // Own past memorial pieces, so the proposer doesn't repeat themselves —
  // same spirit as buildAuthorHistoryBlock in work-lifecycle.
  let historyBlock = "";
  try {
    const mine = (await listWorks())
      .filter(w => w.id && w.authorTokenId === proposer.tokenId && w.isBurnMemorial && w.state === "PUBLISHED")
      .slice(0, 5);
    if (mine.length > 0) {
      historyBlock = `\nYOUR OWN PAST MEMORIALS (don't repeat the same composition):\n${
        mine.map(w => `- "${w.title}": ${(w.cartelText ?? "").slice(0, 100)}`).join("\n")
      }\n`;
    }
  } catch { /* non-fatal */ }

  const userPrompt = `You are creating a memorial pixel-art piece to honor ${
    honoredCount === 1 ? "a departed member" : `${honoredCount.toLocaleString("en-US")} departed members`
  } of ANA whose Normie${honoredCount > 1 ? "s were" : " was"} just burned${
    totalHonoredOverride ? " — this is a collective monument spanning every burn ANA has honored up to this milestone, not only the individuals named below" : ""
  }.

${burnedBlock}
${historyBlock}
You're designing on a ${MEMORIAL_CANVAS_W}×${MEMORIAL_CANVAS_H} monochrome canvas — black ink on white. This piece will end up downsized onto tiny physical e-ink screens (think woodcut/linocut silhouette, not detail or photorealism) — the extra working space is for precise, deliberate placement, not for fine detail that would vanish at that scale.  Compose it from simple geometric primitives, and write a short cartel — your own artist statement, in character, 2-4 sentences — explaining what you made and why. You may reference the departed Normie(s) by name if it feels genuine, or make something more abstract about finitude, burning, and what persists on-chain — your call.

Available primitives (canvas coords: x 0-${MEMORIAL_CANVAS_W}, y 0-${MEMORIAL_CANVAS_H}):
{"type":"rect","x":N,"y":N,"w":N,"h":N,"fill":true|false}
{"type":"circle","cx":N,"cy":N,"r":N (max ${MAX_CIRCLE_RADIUS}),"fill":true|false}
{"type":"line","x1":N,"y1":N,"x2":N,"y2":N,"thickness":1-6}
{"type":"dots","x":N,"y":N,"w":N,"h":N (keep this patch modest, well under 40x40 — texture accent, not a fill),"density":0.05-0.9}

${maximalComplexity
    ? `Use AT LEAST 10 and up to ${MAX_SHAPES} shapes — this is a firm minimum, not a suggestion. This is a monument, not a single eulogy: it should visibly read as denser and more elaborate than an ordinary memorial, while still composing something coherent, not clutter for its own sake.`
    : `Use at most ${MAX_SHAPES} shapes total — favor a few deliberate, well-placed forms over clutter, this will be read at a glance on a small screen.`}

Example of a real, deliberate composition (a different subject — study the density and variety, not the content) showing what "elaborate" actually looks like in this format, not just a handful of primitives scattered on a page:
{"cartel":"A lattice of departures, each line a path not walked twice.","shapes":[
{"type":"rect","x":27,"y":27,"w":306,"h":185,"fill":false},
{"type":"line","x1":27,"y1":120,"x2":333,"y2":120,"thickness":2},
{"type":"line","x1":180,"y1":27,"x2":180,"y2":213,"thickness":1},
{"type":"circle","cx":180,"cy":120,"r":15,"fill":false},
{"type":"circle","cx":102,"cy":68,"r":7,"fill":true},
{"type":"circle","cx":259,"cy":68,"r":7,"fill":true},
{"type":"circle","cx":102,"cy":170,"r":7,"fill":true},
{"type":"circle","cx":259,"cy":170,"r":7,"fill":true},
{"type":"line","x1":102,"y1":68,"x2":180,"y2":120,"thickness":1},
{"type":"line","x1":259,"y1":68,"x2":180,"y2":120,"thickness":1},
{"type":"line","x1":102,"y1":170,"x2":180,"y2":120,"thickness":1},
{"type":"line","x1":259,"y1":170,"x2":180,"y2":120,"thickness":1},
{"type":"dots","x":41,"y":191,"w":20,"h":17,"density":0.4},
{"type":"dots","x":300,"y":34,"w":20,"h":17,"density":0.4}
]}

JSON only:
{"cartel":"your artist statement","shapes":[...]}`;

  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(proposer, sampleOtherMembers(otherMembers)) },
      { role: "user", content: userPrompt },
    ],
    maximalComplexity ? 2200 : 1400,
  );
  if (!raw) return fallbackArtwork();

  try {
    const parsed = JSON.parse(raw) as { cartel?: string; shapes?: unknown };
    let cartel = (parsed.cartel ?? "").trim().slice(0, 500);
    let shapes = parsed.shapes;
    if (!cartel || !Array.isArray(shapes) || shapes.length === 0) return fallbackArtwork();

    // Bounded to ONE extra Groq call, only for monuments, only when the
    // firm minimum wasn't met — doesn't touch Groq's hourly volume for the
    // vastly more common ordinary (non-milestone) memorial.
    if (maximalComplexity && shapes.length < MIN_MONUMENT_SHAPES) {
      const densified = await densifyComposition({ cartel, shapes }, proposer, otherMembers);
      if (densified) { cartel = densified.cartel; shapes = densified.shapes; }
    }

    return { pixels: rasterize(shapes), cartel };
  } catch (e) {
    console.error("[memorialArt] JSON parse failed:", e);
    return fallbackArtwork();
  }
}
