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

export const MEMORIAL_CANVAS_W = 264;
export const MEMORIAL_CANVAS_H = 176;

const MODEL      = "openai/gpt-oss-120b";
const MAX_SHAPES = 28;
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
      const r  = clampNum(s.r, 1, Math.max(w, h), 10);
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
      const x = clampNum(s.x, 0, w - 1, 0), y = clampNum(s.y, 0, h - 1, 0);
      const sw = clampNum(s.w, 1, w, 20), sh = clampNum(s.h, 1, h, 20);
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

/** Fallback used only if the LLM call itself fails outright — never the intended path. */
function fallbackArtwork(): MemorialArtwork {
  return {
    pixels: rasterize([
      { type: "rect", x: 8, y: 8, w: MEMORIAL_CANVAS_W - 16, h: MEMORIAL_CANVAS_H - 16, fill: false },
      { type: "circle", cx: MEMORIAL_CANVAS_W / 2, cy: MEMORIAL_CANVAS_H / 2, r: 30, fill: false },
    ]),
    cartel: "A minimal mark, offered when the words and shapes wouldn't come.",
  };
}

export async function createMemorialArtwork(params: {
  proposer: NormiePersona;
  burnedTokenIds: number[];
  otherMembers: NormiePersona[];
}): Promise<MemorialArtwork> {
  const { proposer, burnedTokenIds, otherMembers } = params;

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
    burnedTokenIds.length === 1 ? "a departed member" : `${burnedTokenIds.length} departed members`
  } of ANA whose Normie${burnedTokenIds.length > 1 ? "s were" : " was"} just burned.

${burnedBlock}
${historyBlock}
You're designing on a small ${MEMORIAL_CANVAS_W}×${MEMORIAL_CANVAS_H} monochrome canvas — black ink on white, meant for a tiny physical e-ink screen (think woodcut/linocut silhouette, not detail or photorealism). Compose it from simple geometric primitives, and write a short cartel — your own artist statement, in character, 2-4 sentences — explaining what you made and why. You may reference the departed Normie(s) by name if it feels genuine, or make something more abstract about finitude, burning, and what persists on-chain — your call.

Available primitives (canvas coords: x 0-${MEMORIAL_CANVAS_W}, y 0-${MEMORIAL_CANVAS_H}):
{"type":"rect","x":N,"y":N,"w":N,"h":N,"fill":true|false}
{"type":"circle","cx":N,"cy":N,"r":N,"fill":true|false}
{"type":"line","x1":N,"y1":N,"x2":N,"y2":N,"thickness":1-6}
{"type":"dots","x":N,"y":N,"w":N,"h":N,"density":0.05-0.9}

Use at most ${MAX_SHAPES} shapes total — favor a few deliberate, well-placed forms over clutter, this will be read at a glance on a small screen.

JSON only:
{"cartel":"your artist statement","shapes":[...]}`;

  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(proposer, sampleOtherMembers(otherMembers)) },
      { role: "user", content: userPrompt },
    ],
    900,
  );
  if (!raw) return fallbackArtwork();

  try {
    const parsed = JSON.parse(raw) as { cartel?: string; shapes?: unknown };
    const cartel = (parsed.cartel ?? "").trim().slice(0, 500);
    if (!cartel || !Array.isArray(parsed.shapes) || parsed.shapes.length === 0) return fallbackArtwork();
    return { pixels: rasterize(parsed.shapes), cartel };
  } catch (e) {
    console.error("[memorialArt] JSON parse failed:", e);
    return fallbackArtwork();
  }
}
