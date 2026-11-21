import { beforeEach, describe, expect, it } from "vitest";
import {
  decideProbeGate, failOpenAfterMs, judgeObservation, listProbeQueue, probeFeedback, readProbeResult, recordProbeResult,
  renderProbeEnabled, renderProbeGate, sourceHashOf, type ProbeResult, type RawProbeObservation,
} from "../src/lib/renderProbe";
import { resetSoftKvMemory } from "../src/lib/softKv";
import { judgeObservation as judgeInScript } from "../scripts/render-probe.mjs";

beforeEach(() => resetSoftKvMemory());

const HOUR = 3_600_000;
const html = "<!DOCTYPE html><html><body><canvas></canvas></body></html>";
const ok = (hash: string): ProbeResult => ({ sourceHash: hash, status: "ok", checkedAt: 1, errors: [], codes: [], warnings: [], warningCodes: [] });
const failed = (hash: string): ProbeResult => ({ ...ok(hash), status: "failed", errors: ["a shader failed to compile: '%'"], codes: ["shader-compile-error"] });

describe("decideProbeGate", () => {
  const h = sourceHashOf(html);
  it("queues a work it has never seen and makes it wait", () => {
    expect(decideProbeGate(h, null, undefined, 1000, 18 * HOUR)).toEqual({ kind: "wait", queuedNow: true });
  });
  it("waits while the queued request is recent", () => {
    expect(decideProbeGate(h, null, { workId: "w", sourceHash: h, requestedAt: 0 }, 5 * HOUR, 18 * HOUR)).toEqual({ kind: "wait", queuedNow: false });
  });
  it("fails OPEN after the delay — the pipeline never stalls on infrastructure it does not control", () => {
    const gate = decideProbeGate(h, null, { workId: "w", sourceHash: h, requestedAt: 0 }, 19 * HOUR, 18 * HOUR);
    expect(gate).toMatchObject({ kind: "pass", probed: false });
  });
  it("passes on an ok verdict for this exact page, fails on a failed one", () => {
    expect(decideProbeGate(h, ok(h), undefined, 0, HOUR)).toEqual({ kind: "pass", probed: true });
    expect(decideProbeGate(h, failed(h), undefined, 0, HOUR)).toMatchObject({ kind: "fail", codes: ["shader-compile-error"] });
  });
  it("ignores a verdict about an older revision of the page", () => {
    expect(decideProbeGate(h, ok("0".repeat(64)), undefined, 0, HOUR)).toEqual({ kind: "wait", queuedNow: true });
    expect(decideProbeGate(h, failed("0".repeat(64)), { workId: "w", sourceHash: "0".repeat(64), requestedAt: 0 }, 0, HOUR)).toEqual({ kind: "wait", queuedNow: true });
  });
});

describe("the gate end to end (in-memory store)", () => {
  it("queues once, then passes after an ok verdict, then forgets it on a revision", async () => {
    expect(await renderProbeGate("w1", html, "html-webgl", 1000)).toEqual({ kind: "wait", queuedNow: true });
    expect(await renderProbeGate("w1", html, "html-webgl", 2000)).toEqual({ kind: "wait", queuedNow: false });
    expect(await listProbeQueue()).toHaveLength(1);

    const hash = sourceHashOf(html);
    expect(await recordProbeResult("w1", { sourceHash: hash, status: "ok", errors: [], codes: [], warnings: [], warningCodes: [] })).toBe(true);
    expect(await listProbeQueue()).toHaveLength(0);
    expect(await renderProbeGate("w1", html, "html-webgl", 3000)).toEqual({ kind: "pass", probed: true });

    const revised = html.replace("<canvas>", "<canvas id=x>");
    expect(await renderProbeGate("w1", revised, "html-webgl", 4000)).toEqual({ kind: "wait", queuedNow: true });
  });

  it("rejects a verdict that is about a page the Author has since replaced", async () => {
    await renderProbeGate("w2", html, "html-webgl", 1000);
    const stale = await recordProbeResult("w2", { sourceHash: "f".repeat(64), status: "failed", errors: ["x"], codes: [], warnings: [], warningCodes: [] });
    expect(stale).toBe(false);
    expect(await readProbeResult("w2")).toBeNull();
  });

  it("hashes the trimmed page, so a trailing newline never invalidates a verdict", () => {
    expect(sourceHashOf(html)).toBe(sourceHashOf(`\n${html}\n`));
  });
});

describe("configuration", () => {
  it("is on by default and can be switched off", () => {
    expect(renderProbeEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(renderProbeEnabled({ ANA_RENDER_PROBE: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it("fails open after 18 h unless configured", () => {
    expect(failOpenAfterMs({} as NodeJS.ProcessEnv)).toBe(18 * HOUR);
    expect(failOpenAfterMs({ ANA_RENDER_PROBE_FAIL_OPEN_HOURS: "6" } as unknown as NodeJS.ProcessEnv)).toBe(6 * HOUR);
    expect(failOpenAfterMs({ ANA_RENDER_PROBE_FAIL_OPEN_HOURS: "abc" } as unknown as NodeJS.ProcessEnv)).toBe(18 * HOUR);
  });
});

const base: RawProbeObservation = { glErrors: [], pageErrors: [], consoleErrors: [], cspViolations: [], litRatio: 0.2, motionRatio: 0.1, meanLuma: 60 };

describe("judgeObservation", () => {
  it("passes a healthy page", () => {
    expect(judgeObservation(base)).toEqual({ errors: [], codes: [], warnings: [], warningCodes: [] });
  });
  it("names the shader failure the way the browser did (work #9)", () => {
    const v = judgeObservation({ ...base, litRatio: 0, motionRatio: 0, meanLuma: 10, glErrors: [{ kind: "shader", log: "ERROR: 0:39: '%' : integer modulus operator supported in GLSL ES 3.00 and above only" }, { kind: "link", log: "Fragment shader is not compiled." }] });
    expect(v.codes).toEqual(["shader-compile-error"]);
    expect(v.errors[0]).toContain("integer modulus");
    expect(v.warningCodes).toEqual([]); // the blackness is explained by the error, not a second finding
  });
  it("blocks a flat page (nothing drawn, or a click-gated solid screen — work #2)", () => {
    expect(judgeObservation({ ...base, litRatio: 0 }).codes).toEqual(["blank-canvas"]);
  });
  it("blocks an uncaught JavaScript error", () => {
    expect(judgeObservation({ ...base, pageErrors: ["ReferenceError: x is not defined"] }).codes).toEqual(["js-error"]);
  });
  it("only WARNS about a very dark or static piece — those never block a publication", () => {
    const dark = judgeObservation({ ...base, litRatio: 0.004, meanLuma: 12 });
    expect(dark.errors).toEqual([]);
    expect(dark.warningCodes).toEqual(["low-visibility"]);
    const still = judgeObservation({ ...base, motionRatio: 0 });
    expect(still.errors).toEqual([]);
    expect(still.warningCodes).toEqual(["static-output"]);
    expect(judgeObservation({ ...base, cspViolations: ["script-src https://evil"] }).warningCodes).toEqual(["csp-violation"]);
  });
});

describe("scripts/render-probe.mjs and the server judge the same way", () => {
  const observations: RawProbeObservation[] = [
    base,
    { ...base, litRatio: 0 },
    { ...base, litRatio: 0.004, meanLuma: 12 },
    { ...base, motionRatio: 0 },
    { ...base, pageErrors: ["boom"] },
    { ...base, glErrors: [{ kind: "shader", log: "ERROR" }, { kind: "link", log: "x" }, { kind: "shader", log: "third" }], litRatio: 0 },
    { ...base, cspViolations: ["img-src"], motionRatio: 0 },
  ];
  it.each(observations.map((o, i) => [i, o] as const))("observation %i", (_i, o) => {
    expect(judgeInScript(o)).toEqual(judgeObservation(o));
  });
});

describe("probeFeedback", () => {
  it("is short enough to be a revision note, and says it was a real browser", () => {
    const text = probeFeedback(["a".repeat(300), "b".repeat(300)]);
    expect(text.length).toBeLessThanOrEqual(480);
    expect(text).toContain("Real-browser render check failed");
  });
});
