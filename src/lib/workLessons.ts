/**
 * workLessons.ts — the Normies' memory of what worked and what failed in their own works, and why.
 *
 * Added 21/11/2026 after work #9 "Governance Grid Revolt" went on-chain with a shader that never compiled
 * (black canvas). The porteur's requirement: if such a failure can still happen, the Normies must carry
 * the memory of it — which works worked, which failed, for what reason — into how they think and build.
 *
 * What is stored (one small JSON row in kv_store, no migration, bounded):
 *   - failures, aggregated by (form, code): how many times, last time, which works, the one-line cause and
 *     how to avoid it. Fed by every place that learns something is wrong: the static checks
 *     (generativeArtwork.ts / glslLint.ts codes), the technical review panel, the real-browser render probe;
 *   - successes: the last few works that actually rendered, with the techniques they used.
 * Plus SEED_LESSONS: facts that already happened before this memory existed (work #9, the p5.sound CDN
 * incident…), so the first creation after deployment already knows them.
 *
 * What reads it: buildLessonsBlock() is injected into the Author's creation prompt, and the failure patterns
 * into the technical reviewers' prompt (work-lifecycle/route.ts). It is deliberately SHORT (≈300 tokens): the
 * free Groq plan is 8 000 tokens/minute and every creation prompt already carries the whole contract.
 *
 * Everything here is best-effort (softKv): a lessons failure must never block a creation.
 */
import { softKvGetJson, softKvSetJson } from "./softKv";

export type LessonSource = "static-check" | "technical-review" | "render-probe" | "published" | "history";

export interface WorkLesson {
  /** `${form}:${code}` for failures, `${form}:ok:${title}` for successes. */
  key: string;
  outcome: "failed" | "worked" | "weak";
  form: string;               // html-webgl, html-p5js, html-canvas, html-threejs, or "html" for any
  code: string;               // stable id, e.g. "glsl-int-modulo"
  summary: string;            // what happened
  fix?: string;               // how to avoid it
  count: number;
  firstAt: number;
  lastAt: number;
  works: string[];            // titles, at most 3
  source: LessonSource;
  seed?: boolean;
}

/** What each failure code means and how to avoid it — shared by the seed lessons and the live ones. */
export const LESSON_CATALOG: Record<string, { summary: string; fix: string; weak?: boolean }> = {
  "glsl-int-modulo":       { summary: "a shader used the integer % operator, which GLSL ES 1.00 (WebGL1) does not have: it never compiled and the canvas stayed black", fix: "mod(float(a), float(b))" },
  "glsl-bitwise":          { summary: "a shader used bit-wise operators (<< >> & | ^ ~), absent from WebGL1", fix: "arithmetic: floor(), mod(), multiplication" },
  "glsl-int-float-mix":    { summary: "a shader mixed int and float (float a = 1; a * 2; pow(a, 2)): GLSL ES 1.00 has no implicit conversion, so it did not compile", fix: "write every number as a float: 1.0, 2.0" },
  "glsl-nonconst-loop":    { summary: "a shader loop was bounded by a non-constant: not allowed in GLSL ES 1.00", fix: "literal or const int bound, `break` for a dynamic limit" },
  "glsl-no-precision":     { summary: "a fragment shader had no default float precision, rejected on most phones", fix: "precision mediump float; at the top" },
  "glsl-derivatives-ext":  { summary: "a shader used dFdx/dFdy/fwidth without the derivatives extension", fix: "avoid them, or enable GL_OES_standard_derivatives" },
  "glsl-inout-qualifier":  { summary: "a shader used in/out (GLSL ES 3.00) in a WebGL1 context", fix: "attribute/varying and gl_FragColor" },
  "glsl-version-300-without-webgl2": { summary: "a shader declared #version 300 es but the page only created a WebGL1 context", fix: "stay in GLSL ES 1.00 with getContext(\"webgl\")" },
  "webgl-no-compile-check": { summary: "the page compiled shaders without ever reading COMPILE_STATUS, so a failure was invisible", fix: "check getShaderParameter(…, gl.COMPILE_STATUS) and draw a visible Canvas 2D fallback on failure" },
  "shader-compile-error":  { summary: "a real browser could not compile a shader (blank/black result)", fix: "keep GLSL ES 1.00 strictly: floats only, constant loop bounds" },
  "js-error":              { summary: "the page threw an uncaught JavaScript error when it loaded", fix: "define every variable and function before use; no missing library" },
  "blank-canvas":          { summary: "the page showed a single flat colour in a real browser (nothing drawn, or a screen waiting for a click)", fix: "paint real content every frame from the first second — never a blank or solid screen while waiting for user interaction" },
  "low-visibility":        { summary: "the piece ran but was almost entirely near-black, hard to see", fix: "stronger contrast and larger, brighter elements against the dark background", weak: true },
  "static-output":         { summary: "the piece never moved after loading", fix: "make something visibly change over time", weak: true },
  "csp-violation":         { summary: "the browser blocked something the page tried to do (security policy)", fix: "no network, no eval, no inline handlers, no external fonts or images", weak: true },
  "p5-missing-setup":      { summary: "a p5.js piece was missing setup()/createCanvas()", fix: "define setup() with createCanvas(windowWidth, windowHeight)" },
  "p5sound-cdn":           { summary: "a p5.js piece used p5.sound classes without the p5.sound script tag (or the pinned CDN tags were missing)", fix: "include both pinned p5 and p5.sound script tags" },
  "p5-fft-bins":           { summary: "p5.FFT was given an invalid bin count", fix: "a literal power of two between 16 and 1024" },
  "forbidden-api":         { summary: "the code used a forbidden API (fetch, eval, inline handlers, iframes…) and was rejected", fix: "everything must run offline with addEventListener only" },
  "caption-instead-of-art":{ summary: "the piece printed its on-chain data (NORMIE_ID/TRAITS) as a readable caption instead of using it to drive visuals", fix: "use the data for colors, counts, speeds, shapes — never print it" },
  "too-many-text-calls":   { summary: "too many text()/fillText() calls: it read as a captioned screen, not generative art", fix: "carry the piece with shapes and motion; at most a short title" },
  "missing-onchain-constants": { summary: "required on-chain constants (NORMIE_ID, NORMIE_TRAITS, …) were missing", fix: "copy the injected constants at the top of the script" },
  "document-too-large":    { summary: "the document exceeded the on-chain size budget", fix: "compact code, no comments, under 18 000 bytes" },
  "markup-broken":         { summary: "broken markup (missing <!DOCTYPE>, <html>, <body>, </html> or a dropped '<')", fix: "re-scan the output for dropped < characters" },
  "reviewer-flagged":      { summary: "the technical review panel found a concrete runtime problem in the code", fix: "address the reviewers' specific points" },
  "other-validation":      { summary: "the automated structural check rejected the draft", fix: "read the validator's message and fix exactly that" },
};

/** Maps a validator message (and, when present, its stable code) to a lesson code. */
export function classifyFailure(message: string, code?: string): string {
  if (code && LESSON_CATALOG[code]) return code;
  const m = message.toLowerCase();
  if (m.includes("integer modulus")) return "glsl-int-modulo";
  if (m.includes("compile_status") || m.includes("link_status")) return "webgl-no-compile-check";
  if (m.includes("setup()") || m.includes("createcanvas")) return "p5-missing-setup";
  if (m.includes("p5.sound") || m.includes("pinned cdn") || m.includes("pinned three.js")) return "p5sound-cdn";
  if (m.includes("p5.fft")) return "p5-fft-bins";
  if (m.includes("forbidden pattern")) return "forbidden-api";
  if (m.includes("printed as readable text")) return "caption-instead-of-art";
  if (m.includes("text()/filltext()")) return "too-many-text-calls";
  if (m.includes("on-chain data constant")) return "missing-onchain-constants";
  if (m.includes("too large")) return "document-too-large";
  if (m.includes("missing <") || m.includes("closing </html>")) return "markup-broken";
  return "other-validation";
}

const T = (iso: string) => Date.parse(iso);

function seedFailure(form: string, code: string, count: number, firstAt: string, lastAt: string, works: string[], summary?: string): WorkLesson {
  const cat = LESSON_CATALOG[code];
  return {
    key: `${form}:${code}`, outcome: cat.weak ? "weak" : "failed", form, code, summary: summary ?? cat.summary, fix: cat.fix,
    count, firstAt: T(firstAt), lastAt: T(lastAt), works, source: "history", seed: true,
  };
}

function seedSuccess(form: string, id: string, title: string, at: string, summary: string): WorkLesson {
  return { key: `${form}:ok:${id}`, outcome: "worked", form, code: "worked", summary, count: 1, firstAt: T(at), lastAt: T(at), works: [title], source: "history", seed: true };
}

/** Outcomes that already happened before this memory existed. Re-derived from the vault audit of 21/11/2026 and the repo history. */
export const SEED_LESSONS: WorkLesson[] = [
  seedFailure("html-webgl", "glsl-int-modulo", 1, "2026-11-06", "2026-11-06", ["Governance Grid Revolt"],
    "work #9 \"Governance Grid Revolt\" used the integer % operator in its fragment shader (GLSL ES 1.00 has none): it was published on-chain with a canvas that is black forever — on-chain content cannot be corrected"),
  seedFailure("html-p5js", "blank-canvas", 1, "2026-10-01", "2026-10-01", ["Neon Pulse Canvas"],
    "work #2 \"Neon Pulse Canvas\" fills the whole screen with one solid red rectangle until the visitor clicks (its audio waits for a pointerdown): to anyone who does not click — a gallery thumbnail, a physical screen — it is a flat red page"),
  seedFailure("html-p5js", "p5sound-cdn", 1, "2026-10-01", "2026-10-01", []),
  seedFailure("html-p5js", "low-visibility", 2, "2026-10-18", "2026-10-29", ["Structured Rhythm of Unburned Lines", "Steady Ledger Pulse"]),
  seedSuccess("html-threejs", "seed-three", "Brutalist Echoes in Light", "2026-10-14", "a field of lit 3D cubes with slow camera drift read clearly and moved"),
  seedSuccess("html-canvas", "seed-canvas", "Platen Thunk and Ink Bleed", "2026-10-08", "a dense lattice of bright points on black, animated, high contrast"),
];

const STORE_KEY = "work-lessons:v1";
const MAX_STORED = 60;

interface LessonStore { lessons: WorkLesson[] }

async function readStored(): Promise<WorkLesson[]> {
  const store = await softKvGetJson<LessonStore>(STORE_KEY);
  return Array.isArray(store?.lessons) ? store!.lessons : [];
}

async function writeStored(lessons: WorkLesson[]): Promise<void> {
  // Bounded: keep every failure pattern, then the newest successes, up to MAX_STORED.
  const failures = lessons.filter(l => l.outcome !== "worked");
  const successes = lessons.filter(l => l.outcome === "worked").sort((a, b) => b.lastAt - a.lastAt);
  const kept = [...failures, ...successes].slice(0, MAX_STORED);
  await softKvSetJson(STORE_KEY, { lessons: kept } satisfies LessonStore);
}

/** Pure merge — exported for tests. */
export function mergeLesson(existing: WorkLesson[], incoming: WorkLesson): WorkLesson[] {
  const idx = existing.findIndex(l => l.key === incoming.key);
  if (idx === -1) return [...existing, incoming];
  const prev = existing[idx];
  const works = [...new Set([...incoming.works, ...prev.works])].slice(0, 3);
  const merged: WorkLesson = {
    ...prev, ...incoming, count: prev.count + incoming.count, firstAt: Math.min(prev.firstAt, incoming.firstAt),
    lastAt: Math.max(prev.lastAt, incoming.lastAt), works,
  };
  return existing.map((l, i) => (i === idx ? merged : l));
}

export interface FailureInput {
  form: string; code: string; workTitle?: string; source: LessonSource;
  /** Overrides the catalog summary — e.g. the reviewers' own words. */
  detail?: string;
}

export async function recordWorkFailure(input: FailureInput): Promise<void> {
  try {
    const cat = LESSON_CATALOG[input.code] ?? LESSON_CATALOG["other-validation"];
    const now = Date.now();
    const lesson: WorkLesson = {
      key: `${input.form}:${input.code}`, outcome: cat.weak ? "weak" : "failed", form: input.form, code: input.code,
      summary: (input.detail ?? cat.summary).slice(0, 240), fix: cat.fix, count: 1, firstAt: now, lastAt: now,
      works: input.workTitle ? [input.workTitle] : [], source: input.source,
    };
    await writeStored(mergeLesson(await readStored(), lesson));
  } catch (e) {
    console.error("[workLessons] recordWorkFailure failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

/** Records every distinct cause found by a validator run (codes first, message classification as the fallback). */
export async function recordValidationFailures(form: string, errors: string[], codes: string[] | undefined, workTitle: string): Promise<void> {
  const found = new Set<string>(codes ?? []);
  for (const err of errors) found.add(classifyFailure(err));
  // A message already covered by an explicit code must not also count as "other".
  if (found.size > 1) found.delete("other-validation");
  for (const code of found) await recordWorkFailure({ form, code, workTitle, source: "static-check" });
}

export function detectTechniques(html: string): string[] {
  const t: string[] = [];
  if (/getContext\s*\(\s*["'`]webgl/.test(html)) t.push("WebGL shader");
  if (/THREE\./.test(html)) t.push("three.js 3D");
  if (/p5\.min\.js|createCanvas\s*\(/.test(html)) t.push("p5.js");
  if (/p5\.(?:FFT|Oscillator|SoundFile|Amplitude)|AnalyserNode|createAnalyser/.test(html)) t.push("audio-reactive");
  if (/mousemove|pointermove|mouseX|touchmove/.test(html)) t.push("mouse/touch interaction");
  if (/getContext\s*\(\s*["'`]2d/.test(html)) t.push("Canvas 2D");
  if (/NORMIE_TRAITS|NORMIE_ID/.test(html)) t.push("driven by the Normie's traits");
  return t.slice(0, 4);
}

export async function recordWorkSuccess(input: { form: string; title: string; html?: string; verifiedInBrowser: boolean; note?: string }): Promise<void> {
  try {
    const now = Date.now();
    const techniques = input.html ? detectTechniques(input.html) : [];
    const summary = [
      input.verifiedInBrowser ? "rendered correctly in a real browser" : "published",
      techniques.length ? `(${techniques.join(", ")})` : "",
      input.note ?? "",
    ].filter(Boolean).join(" ").slice(0, 200);
    const lesson: WorkLesson = {
      key: `${input.form}:ok:${input.title}`, outcome: "worked", form: input.form, code: "worked", summary,
      count: 1, firstAt: now, lastAt: now, works: [input.title], source: input.verifiedInBrowser ? "render-probe" : "published",
    };
    // A browser-verified verdict replaces a bare "published" entry for the same work, never the reverse.
    const stored = await readStored();
    const prev = stored.find(l => l.key === lesson.key);
    if (prev && prev.source === "render-probe" && !input.verifiedInBrowser) return;
    await writeStored(mergeLesson(stored.filter(l => l.key !== lesson.key), lesson));
  } catch (e) {
    console.error("[workLessons] recordWorkSuccess failed (non-fatal):", e instanceof Error ? e.message : e);
  }
}

/** Pure: seeds + live lessons. A live record of a seeded failure adds to its count but keeps the seed's richer wording. */
export function combineLessons(stored: WorkLesson[]): WorkLesson[] {
  let all = [...SEED_LESSONS];
  for (const live of stored) {
    const seed = all.find(l => l.key === live.key && l.seed);
    all = seed
      ? mergeLesson(all, { ...live, summary: seed.summary, seed: true })
      : mergeLesson(all, live);
  }
  return all;
}

export async function readAllLessons(): Promise<WorkLesson[]> {
  return combineLessons(await readStored().catch(() => [] as WorkLesson[]));
}

/**
 * The block injected into a creation prompt. Failures for this form first (the ones that cost a work), then
 * failures that apply to every html form, then what worked. Hard-capped in size.
 */
export function formatLessonsBlock(lessons: WorkLesson[], form: string | undefined, maxChars = 1300): string {
  const forForm = (l: WorkLesson) => !form || l.form === form || l.form === "html";
  const failed = lessons.filter(l => l.outcome === "failed" && forForm(l)).sort((a, b) => b.lastAt - a.lastAt);
  const weak   = lessons.filter(l => l.outcome === "weak" && forForm(l)).sort((a, b) => b.lastAt - a.lastAt);
  const worked = lessons.filter(l => l.outcome === "worked" && (!form || l.form === form || l.form.startsWith("html"))).sort((a, b) => b.lastAt - a.lastAt).slice(0, 3);
  if (failed.length + weak.length + worked.length === 0) return "";

  const lines: string[] = [];
  for (const l of failed.slice(0, 6)) lines.push(`✗ FAILED${l.count > 1 ? ` (${l.count}×)` : ""} — ${l.summary}.${l.fix ? ` Instead: ${l.fix}.` : ""}`);
  for (const l of weak.slice(0, 2))   lines.push(`~ WEAK — ${l.summary}.${l.fix ? ` Instead: ${l.fix}.` : ""}`);
  for (const l of worked)             lines.push(`✓ WORKED — "${l.works[0] ?? "a past work"}" (${l.form}): ${l.summary}.`);

  let block = `\nWHAT ANA HAS LEARNED FROM ITS OWN WORKS — real outcomes, read before writing a single line. A published work is immutable: a bug that ships is permanent.\n`;
  for (const line of lines) {
    if (block.length + line.length + 1 > maxChars) break;
    block += `${line}\n`;
  }
  return block;
}

export async function buildLessonsBlock(form: string | undefined, maxChars?: number): Promise<string> {
  try { return formatLessonsBlock(await readAllLessons(), form, maxChars); } catch { return ""; }
}

/** For the technical reviewers: only the concrete failure patterns, as a checklist of things to look for first. */
export function formatReviewerChecklist(lessons: WorkLesson[], form: string | undefined): string {
  const items = lessons.filter(l => l.outcome === "failed" && (!form || l.form === form || l.form === "html")).sort((a, b) => b.count - a.count).slice(0, 6);
  if (items.length === 0) return "";
  return `\nFAILURE PATTERNS ANA HAS ALREADY SHIPPED OR NEARLY SHIPPED — check these first:\n${items.map(l => `- ${l.summary}`).join("\n")}\n`;
}

// Checks a reviewer should run on EVERY page of this form, whether or not ANA has been bitten by them yet.
const STATIC_REVIEW_HINTS: Record<string, string> = {
  "html-webgl": "- GLSL ES 1.00 compile errors (the page then stays black, silently): an integer %, an int where a float is needed (`1` instead of `1.0`, `pow(a, 2)`), a loop bounded by a non-constant, no `precision mediump float;` in the fragment shader, shaders compiled without ever reading gl.COMPILE_STATUS.",
  "html-p5js": "- a screen that stays blank or one solid colour until the visitor clicks (audio gated on a pointerdown, `getAudioContext().state` checks): the piece must draw real content from the first frame.",
};

export async function buildReviewerChecklist(form: string | undefined): Promise<string> {
  try {
    const learned = formatReviewerChecklist(await readAllLessons(), form);
    const hint = form ? STATIC_REVIEW_HINTS[form] : undefined;
    if (!hint) return learned;
    return learned ? `${learned}${hint}\n` : `\nKNOWN WAYS THIS KIND OF PAGE BREAKS — check these first:\n${hint}\n`;
  } catch { return ""; }
}
