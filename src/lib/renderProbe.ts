/**
 * renderProbe.ts — the gate that makes a REAL browser look at a generative artwork before it is published.
 *
 * Why: nothing in the Vercel pipeline can run a page. The structural check reads text, the curator and the
 * technical reviewers are LLMs reading source — which is how work #9 (shader that never compiled → black
 * canvas) went on-chain. A published work is immutable, so the only honest gate is to load the exact page,
 * with the exact CSP it will be served with, in a browser, and look at what it did.
 *
 * Where the browser is: GitHub Actions (orchestrator.yml, step "Render probe"), which already runs the
 * orchestrator ~4×/day and has Google Chrome installed. Vercel Hobby cannot host a headless browser.
 *
 * Flow:
 *   1. stepValidating (work-lifecycle) calls renderProbeGate() once the static checks pass. First call
 *      queues the work (kv `renderprobe:queue`) and the work WAITS in VALIDATING.
 *   2. The Actions step reads GET /api/keeper/render-probe, loads each queued page with
 *      scripts/render-probe.mjs, and POSTs the verdict back.
 *   3. The next lifecycle tick reads the verdict: ok → continue to the curator; failed → back to CREATING
 *      with the browser's own error (shader log, JS error, blank canvas) as the Author's feedback.
 *   4. If no verdict ever arrives (Actions down), the gate FAILS OPEN after RENDER_PROBE_FAIL_OPEN_HOURS:
 *      the pipeline must not stall on infrastructure it does not control. That publication is then
 *      unprobed, and says so in the work's log.
 *
 * The verdict is bound to the sha256 of the exact HTML: a revised artwork is a new probe.
 *
 * Cost: kv rows only (one queue row, one verdict row per work). The Actions step costs ~15 s when the queue
 * is empty (a single curl) and ~1–2 min when it is not — works are rare.
 */
import crypto from "crypto";
import { softKvGetJson, softKvSetJson } from "./softKv";

export const RENDER_PROBE_QUEUE_KEY = "renderprobe:queue";
const resultKey = (workId: string) => `renderprobe:result:${workId}`;

export interface ProbeMetrics {
  /** Share of pixels that differ from the dominant background colour (0..1). */
  litRatio?: number;
  /** Share of pixels that changed between two screenshots taken ~1.5 s apart (0..1). */
  motionRatio?: number;
  meanLuma?: number;
  consoleErrors?: number;
}

export interface ProbeResult {
  sourceHash: string;
  status: "ok" | "failed";
  checkedAt: number;
  /** Blocking findings, in the browser's own words. */
  errors: string[];
  /** Stable ids (see workLessons.ts LESSON_CATALOG): shader-compile-error, js-error, blank-canvas… */
  codes: string[];
  /** Non-blocking findings (very dark, static) — remembered as lessons, never block a publication. */
  warnings: string[];
  warningCodes: string[];
  metrics?: ProbeMetrics;
}

export interface QueueEntry { workId: string; sourceHash: string; requestedAt: number; artForm?: string }

export function sourceHashOf(html: string): string {
  return crypto.createHash("sha256").update(html.trim(), "utf-8").digest("hex");
}

export function renderProbeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ANA_RENDER_PROBE !== "0";
}

export function failOpenAfterMs(env: NodeJS.ProcessEnv = process.env): number {
  const hours = Number(env.ANA_RENDER_PROBE_FAIL_OPEN_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 18) * 3_600_000;
}

export type ProbeGate =
  | { kind: "pass"; probed: true }
  | { kind: "pass"; probed: false; reason: string }
  | { kind: "wait"; queuedNow: boolean }
  | { kind: "fail"; errors: string[]; codes: string[] };

/**
 * Pure decision (exported for tests): what the lifecycle should do for a work whose current HTML hashes to
 * `sourceHash`, given its stored verdict and queue entry.
 */
export function decideProbeGate(
  sourceHash: string, result: ProbeResult | null, queued: QueueEntry | undefined, now: number, failOpenMs: number,
): ProbeGate {
  if (result && result.sourceHash === sourceHash) {
    return result.status === "ok" ? { kind: "pass", probed: true } : { kind: "fail", errors: result.errors, codes: result.codes };
  }
  if (!queued || queued.sourceHash !== sourceHash) return { kind: "wait", queuedNow: true };
  if (now - queued.requestedAt >= failOpenMs) {
    return { kind: "pass", probed: false, reason: `no render-probe verdict after ${Math.round((now - queued.requestedAt) / 3_600_000)} h — published unprobed` };
  }
  return { kind: "wait", queuedNow: false };
}

async function readQueue(): Promise<QueueEntry[]> {
  const q = await softKvGetJson<QueueEntry[]>(RENDER_PROBE_QUEUE_KEY);
  return Array.isArray(q) ? q : [];
}

export async function listProbeQueue(): Promise<QueueEntry[]> {
  return readQueue();
}

export async function readProbeResult(workId: string): Promise<ProbeResult | null> {
  return softKvGetJson<ProbeResult>(resultKey(workId));
}

/** The lifecycle's entry point. Queues the work on first sight; never throws (a probe problem fails open). */
export async function renderProbeGate(workId: string, html: string, artForm: string | undefined, now = Date.now()): Promise<ProbeGate> {
  try {
    const sourceHash = sourceHashOf(html);
    const [result, queue] = await Promise.all([readProbeResult(workId), readQueue()]);
    const queued = queue.find(q => q.workId === workId);
    const gate = decideProbeGate(sourceHash, result, queued, now, failOpenAfterMs());
    if (gate.kind === "wait" && gate.queuedNow) {
      const next = [...queue.filter(q => q.workId !== workId), { workId, sourceHash, requestedAt: now, artForm }];
      await softKvSetJson(RENDER_PROBE_QUEUE_KEY, next.slice(-20));
    }
    return gate;
  } catch (e) {
    console.error("[renderProbe] gate failed — failing open:", e instanceof Error ? e.message : e);
    return { kind: "pass", probed: false, reason: "render-probe store unavailable" };
  }
}

/** Stores a verdict sent by the Actions step. Returns false when it is stale (the artwork was revised since). */
export async function recordProbeResult(
  workId: string, result: Omit<ProbeResult, "checkedAt">, now = Date.now(),
): Promise<boolean> {
  const queue = await readQueue();
  const queued = queue.find(q => q.workId === workId);
  if (queued && queued.sourceHash !== result.sourceHash) return false; // revised meanwhile: this verdict is about an older page
  await softKvSetJson(resultKey(workId), { ...result, checkedAt: now } satisfies ProbeResult);
  await softKvSetJson(RENDER_PROBE_QUEUE_KEY, queue.filter(q => q.workId !== workId));
  return true;
}

/** Condenses a failed verdict into the sentence handed to the Author as revision feedback. */
export function probeFeedback(errors: string[]): string {
  return `Real-browser render check failed (the page was loaded in Chrome with its production security policy): ${errors.slice(0, 4).join(" | ")}`.slice(0, 480);
}

// ── Verdict rules, shared by scripts/render-probe.mjs (copied there, kept in sync by tests) ─────────────────

export interface RawProbeObservation {
  glErrors: Array<{ kind: "shader" | "link"; log: string }>;
  pageErrors: string[];
  consoleErrors: string[];
  cspViolations: string[];
  litRatio: number;
  motionRatio: number;
  meanLuma: number;
}

/** Turns what the browser observed into blocking errors and soft warnings. Pure — the script mirrors it. */
export function judgeObservation(o: RawProbeObservation): { errors: string[]; codes: string[]; warnings: string[]; warningCodes: string[] } {
  const errors: string[] = [], codes: string[] = [], warnings: string[] = [], warningCodes: string[] = [];
  for (const g of o.glErrors.slice(0, 2)) {
    errors.push(`a ${g.kind === "shader" ? "shader failed to compile" : "WebGL program failed to link"}: ${g.log.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  if (o.glErrors.length) codes.push("shader-compile-error");
  if (o.pageErrors.length) { errors.push(`uncaught JavaScript error: ${o.pageErrors[0].slice(0, 200)}`); codes.push("js-error"); }
  if (o.cspViolations.length) { warnings.push(`something was blocked by the page's security policy: ${o.cspViolations[0].slice(0, 160)}`); warningCodes.push("csp-violation"); }
  if (!errors.length) {
    if (o.litRatio < 0.0005) {
      errors.push("nothing visible was drawn: the page is a single flat colour after loading (a piece that waits for a click or a key must still show something before it)");
      codes.push("blank-canvas");
    } else if (o.litRatio < 0.01 && o.meanLuma < 30) {
      warnings.push("the piece is almost entirely near-black — hard to see");
      warningCodes.push("low-visibility");
    }
  }
  if (!errors.length && o.motionRatio === 0) {
    warnings.push("nothing moved between two screenshots 1.5 s apart");
    warningCodes.push("static-output");
  }
  return { errors, codes: [...new Set(codes)], warnings, warningCodes };
}
