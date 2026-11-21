import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { lintWebglPage } from "../src/lib/glslLint";
import { validateGenerativeHtml } from "../src/lib/generativeArtwork";

/**
 * Every `expected` below was first confirmed against a REAL WebGL1 compiler (Chromium/ANGLE, 21/11/2026):
 * the "FAIL" shaders fail to compile there, the "OK" shaders compile. The lint must agree with the compiler
 * on these — and must never flag a shader the compiler accepts (a false positive stalls a creation in a
 * revision loop).
 */
const P = "precision mediump float;";
const frag = (body: string, head = P) => `const FS = \`${head}\nvoid main(){ ${body} gl_FragColor = vec4(1.0); }\`;`;
const page = (shaderJs: string, extra = "const ok = gl.getShaderParameter(s, gl.COMPILE_STATUS);") =>
  `<script>const gl = c.getContext("webgl"); ${shaderJs} ${extra}</script>`;

const cases: Array<{ name: string; shader: string; expected: string[] }> = [
  { name: "integer modulus", shader: frag("int i = 3; float a = float(i%10);"), expected: ["glsl-int-modulo"] },
  { name: "mod() on floats", shader: frag("float a = mod(7.0, 10.0);"), expected: [] },
  { name: "integer division is legal", shader: frag("int i = 7; float a = float(i/10);"), expected: [] },
  { name: "shift", shader: frag("int i = 1<<2;"), expected: ["glsl-bitwise"] },
  { name: "bit-and", shader: frag("int i = 3 & 1;"), expected: ["glsl-bitwise"] },
  { name: "logical && || ^^ are legal", shader: frag("bool b = (1.0 > 0.0) && (2.0 > 1.0) || false; bool c = b ^^ true;"), expected: [] },
  { name: "no default precision", shader: frag("float a = 1.0;", ""), expected: ["glsl-no-precision"] },
  { name: "highp precision statement", shader: frag("float a = 1.0;", "precision highp float;"), expected: [] },
  { name: "vertex shader needs no precision", shader: "const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;", expected: [] },
  { name: "float = integer literal", shader: frag("float a = 1;"), expected: ["glsl-int-float-mix"] },
  { name: "float * integer literal", shader: frag("float a = 1.0; a = a*2;"), expected: ["glsl-int-float-mix"] },
  { name: "integer literal * float", shader: frag("float a = 1.0; a = 2*a;"), expected: ["glsl-int-float-mix"] },
  { name: "pow with an integer exponent", shader: frag("float a = 1.0; a = pow(a, 2);"), expected: ["glsl-int-float-mix"] },
  { name: "max with an integer literal", shader: frag("float a = 1.0; a = max(a, 0);"), expected: ["glsl-int-float-mix"] },
  { name: "float literals everywhere", shader: frag("float a = 1.0; a = a*2.0 + pow(a, 2.0) + max(a, 0.) + 1e-3*a;"), expected: [] },
  { name: "vec constructor with ints is legal", shader: frag("vec3 v = vec3(1, 0, 0);"), expected: [] },
  { name: "swizzle times int is not a float name", shader: frag("vec2 p = vec2(1.0); float x = 1.0; float y = p.x * 2.0;"), expected: [] },
  { name: "int variable times int literal is legal", shader: frag("int n = 3; int m = n * 2; float f = float(m);"), expected: [] },
  { name: "loop bounded by an uniform", shader: frag("float a = 0.0; for(int i=0;i<n;i++){ a += 1.0; }", `${P} uniform int n;`), expected: ["glsl-nonconst-loop"] },
  { name: "loop bounded by a literal", shader: frag("float a = 0.0; for(int i=0;i<10;i++){ a += 1.0; }"), expected: [] },
  { name: "loop bounded by a const int", shader: frag("float a = 0.0; for(int i=0;i<N;i++){ a += 1.0; }", `${P} const int N = 8;`), expected: [] },
  { name: "loop bounded by a #define", shader: frag("float a = 0.0; for(int i=0;i<N;i++){ a += 1.0; }", `${P}\n#define N 8`), expected: [] },
  { name: "derivatives without extension", shader: frag("float a = dFdx(1.0);"), expected: ["glsl-derivatives-ext"] },
  { name: "derivatives with extension", shader: frag("float a = dFdx(1.0);", `#extension GL_OES_standard_derivatives : enable\n${P}`), expected: [] },
  { name: "top-level out without #version", shader: frag("", `${P}\nout vec4 o;`), expected: ["glsl-inout-qualifier"] },
  { name: "in parameters are legal", shader: "const FS = `precision mediump float; float f(in float x){ return x; } void main(){ gl_FragColor = vec4(f(1.0)); }`;", expected: [] },
  { name: "comments are ignored", shader: frag("// int i; i%10; 1<<2\n float a = 1.0; /* a = 1; */"), expected: [] },
];

describe("lintWebglPage — agrees with a real WebGL1 compiler", () => {
  for (const c of cases) {
    it(c.name, () => {
      const found = lintWebglPage(page(c.shader)).map(i => i.code).sort();
      expect(found).toEqual([...c.expected].sort());
    });
  }

  it("flags a WebGL2 shader in a WebGL1 context, and leaves it alone in a WebGL2 context", () => {
    const es3 = "const FS = `#version 300 es\nprecision mediump float; out vec4 o; void main(){ int i = 5 % 2; o = vec4(float(i)); }`;";
    expect(lintWebglPage(page(es3)).map(i => i.code)).toEqual(["glsl-version-300-without-webgl2"]);
    expect(lintWebglPage(`<script>const gl = c.getContext("webgl2"); ${es3} gl.getShaderParameter(s, gl.COMPILE_STATUS);</script>`)).toEqual([]);
  });

  it("requires the page to read COMPILE_STATUS when it compiles shaders", () => {
    const shader = frag("float a = 1.0;");
    expect(lintWebglPage(`<script>${shader}</script>`).map(i => i.code)).toEqual(["webgl-no-compile-check"]);
    expect(lintWebglPage(`<script>${shader} gl.getProgramParameter(p, gl.LINK_STATUS);</script>`)).toEqual([]);
  });

  it("ignores JavaScript's own % and pages with no shader", () => {
    expect(lintWebglPage("<script>const k = i % 10; ctx.fillRect(0,0,1,1);</script>")).toEqual([]);
  });
});

describe("work #9 (Governance Grid Revolt) — the page that went on-chain with a black canvas", () => {
  const html = readFileSync(path.join(__dirname, "fixtures", "work9-black-canvas.html"), "utf-8");

  it("is now caught, with the integer modulus named as the cause", () => {
    const issues = lintWebglPage(html);
    expect(issues.map(i => i.code)).toEqual(expect.arrayContaining(["glsl-int-modulo", "webgl-no-compile-check"]));
    expect(issues.find(i => i.code === "glsl-int-modulo")?.message).toContain("mod(float(a), float(b))");
  });

  it("fails the generation validator for html-webgl with machine-readable codes", () => {
    const res = validateGenerativeHtml(html, "html-webgl");
    expect(res.valid).toBe(false);
    expect(res.codes).toEqual(expect.arrayContaining(["glsl-int-modulo", "webgl-no-compile-check"]));
    expect(res.errors.some(e => e.startsWith("html-webgl:"))).toBe(true);
  });

  it("passes once the modulus is a mod() and the compile status is read", () => {
    const fixed = html
      .replace("float(i%10)", "mod(float(i), 10.0)")
      .replace("gl.compileShader(sh);", "gl.compileShader(sh); if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){ document.body.style.background='#300'; }");
    const issues = lintWebglPage(fixed);
    expect(issues).toEqual([]);
  });
});
