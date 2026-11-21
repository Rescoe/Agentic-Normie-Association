import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLessonsBlock, buildReviewerChecklist, classifyFailure, combineLessons, detectTechniques, formatLessonsBlock,
  formatReviewerChecklist, mergeLesson, readAllLessons, recordValidationFailures, recordWorkFailure, recordWorkSuccess,
  SEED_LESSONS, LESSON_CATALOG,
} from "../src/lib/workLessons";
import { validateGenerativeHtml } from "../src/lib/generativeArtwork";
import { resetSoftKvMemory } from "../src/lib/softKv";
import { readFileSync } from "fs";
import path from "path";

beforeEach(() => resetSoftKvMemory());

describe("classifyFailure", () => {
  it("prefers the validator's stable code", () => {
    expect(classifyFailure("anything at all", "glsl-int-modulo")).toBe("glsl-int-modulo");
  });
  it("recognises the common validator messages", () => {
    expect(classifyFailure("html-p5js: missing function setup()")).toBe("p5-missing-setup");
    expect(classifyFailure("forbidden pattern: fetch()")).toBe("forbidden-api");
    expect(classifyFailure("html-p5js: new p5.FFT(..., 100) — bin count must be a power of two")).toBe("p5-fft-bins");
    expect(classifyFailure("html-p5js: on-chain data (NORMIE_ID) is printed as readable text")).toBe("caption-instead-of-art");
    expect(classifyFailure("document too large (> 18000 bytes)")).toBe("document-too-large");
    expect(classifyFailure("something nobody anticipated")).toBe("other-validation");
  });
  it("every code a validator can emit has a catalog entry with a fix", () => {
    for (const code of ["glsl-int-modulo", "glsl-bitwise", "glsl-int-float-mix", "glsl-nonconst-loop", "glsl-no-precision", "glsl-derivatives-ext", "glsl-inout-qualifier", "glsl-version-300-without-webgl2", "webgl-no-compile-check", "shader-compile-error", "js-error", "blank-canvas", "low-visibility", "static-output", "csp-violation"]) {
      expect(LESSON_CATALOG[code]?.fix, code).toBeTruthy();
    }
  });
});

describe("seed lessons — what already happened", () => {
  it("remember work #9 and why it failed", () => {
    const nine = SEED_LESSONS.find(l => l.key === "html-webgl:glsl-int-modulo")!;
    expect(nine.outcome).toBe("failed");
    expect(nine.works).toContain("Governance Grid Revolt");
    expect(nine.summary).toContain("on-chain");
    expect(nine.fix).toContain("mod(");
  });
  it("remember the click-gated blank screen of work #2", () => {
    expect(SEED_LESSONS.some(l => l.code === "blank-canvas" && l.works.includes("Neon Pulse Canvas"))).toBe(true);
  });
});

describe("recording and merging", () => {
  it("aggregates the same failure instead of growing a row per occurrence", async () => {
    await recordWorkFailure({ form: "html-webgl", code: "glsl-int-float-mix", workTitle: "A", source: "static-check" });
    await recordWorkFailure({ form: "html-webgl", code: "glsl-int-float-mix", workTitle: "B", source: "static-check" });
    const lesson = (await readAllLessons()).find(l => l.key === "html-webgl:glsl-int-float-mix")!;
    expect(lesson.count).toBe(2);
    expect(lesson.works).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("adds a live occurrence of a seeded failure to its count and keeps the seed's wording", async () => {
    await recordWorkFailure({ form: "html-webgl", code: "glsl-int-modulo", workTitle: "Next one", source: "static-check" });
    const lesson = (await readAllLessons()).find(l => l.key === "html-webgl:glsl-int-modulo")!;
    expect(lesson.count).toBe(2);
    expect(lesson.summary).toContain("black forever");
    expect(lesson.works).toEqual(expect.arrayContaining(["Governance Grid Revolt", "Next one"]));
  });

  it("records every distinct cause of a rejected draft, using the validator's codes", async () => {
    const html = readFileSync(path.join(__dirname, "fixtures", "work9-black-canvas.html"), "utf-8");
    const res = validateGenerativeHtml(html, "html-webgl");
    await recordValidationFailures("html-webgl", res.errors, res.codes, "Draft");
    const keys = (await readAllLessons()).map(l => l.key);
    expect(keys).toEqual(expect.arrayContaining(["html-webgl:webgl-no-compile-check", "html-webgl:glsl-int-modulo"]));
  });

  it("files a weak outcome (very dark) apart from a hard failure", async () => {
    await recordWorkFailure({ form: "html-canvas", code: "low-visibility", workTitle: "Dim", source: "render-probe" });
    expect((await readAllLessons()).find(l => l.key === "html-canvas:low-visibility")?.outcome).toBe("weak");
  });

  it("remembers a success, and a browser-verified one replaces a bare 'published'", async () => {
    await recordWorkSuccess({ form: "html-p5js", title: "Good One", html: "<script>createCanvas(1,1); mouseX; NORMIE_ID</script>", verifiedInBrowser: false });
    await recordWorkSuccess({ form: "html-p5js", title: "Good One", html: "<script>createCanvas(1,1)</script>", verifiedInBrowser: true });
    await recordWorkSuccess({ form: "html-p5js", title: "Good One", verifiedInBrowser: false }); // must not downgrade
    const lesson = (await readAllLessons()).find(l => l.key === "html-p5js:ok:Good One")!;
    expect(lesson.source).toBe("render-probe");
    expect(lesson.summary).toContain("real browser");
  });

  it("mergeLesson is pure and caps the works list at three", () => {
    const base = { key: "k", outcome: "failed" as const, form: "f", code: "c", summary: "s", count: 1, firstAt: 1, lastAt: 1, works: ["a", "b", "c"], source: "static-check" as const };
    const merged = mergeLesson([base], { ...base, works: ["d"], lastAt: 5 });
    expect(merged).toHaveLength(1);
    expect(merged[0].works).toHaveLength(3);
    expect(merged[0].lastAt).toBe(5);
    expect(base.count).toBe(1);
  });
});

describe("what the Normies actually read", () => {
  it("puts the failures of THIS form first, with how to avoid them, before what worked", () => {
    const block = formatLessonsBlock(combineLessons([]), "html-webgl");
    expect(block).toContain("WHAT ANA HAS LEARNED");
    expect(block.indexOf("✗ FAILED")).toBeGreaterThan(-1);
    expect(block).toContain("mod(float(a), float(b))");
    expect(block).toContain("Governance Grid Revolt");
    expect(block.indexOf("✗ FAILED")).toBeLessThan(block.indexOf("✓ WORKED"));
  });

  it("does not show another form's failure as this form's rule", () => {
    const block = formatLessonsBlock(combineLessons([]), "html-threejs");
    expect(block).not.toContain("integer % operator");
  });

  it("stays short enough for the free Groq plan (8 000 tokens/minute)", async () => {
    for (let i = 0; i < 12; i++) {
      await recordWorkFailure({ form: "html-webgl", code: Object.keys(LESSON_CATALOG)[i % 20], workTitle: `W${i}`, source: "static-check" });
    }
    const block = await buildLessonsBlock("html-webgl");
    expect(block.length).toBeLessThanOrEqual(1300);
    expect(block.length).toBeGreaterThan(200);
  });

  it("gives the reviewers a checklist of failures only", async () => {
    const list = await buildReviewerChecklist("html-webgl");
    expect(list).toContain("FAILURE PATTERNS");
    expect(list).toContain("integer % operator");
    expect(formatReviewerChecklist([], "html-webgl")).toBe("");
  });

  it("returns nothing, never throws, when there is nothing to say", () => {
    expect(formatLessonsBlock([], "html-webgl")).toBe("");
  });
});

describe("detectTechniques", () => {
  it("names what a piece is made of", () => {
    expect(detectTechniques('<script>c.getContext("webgl"); NORMIE_ID; addEventListener("mousemove")</script>')).toEqual(
      expect.arrayContaining(["WebGL shader", "mouse/touch interaction", "driven by the Normie's traits"]));
  });
});
