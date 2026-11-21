/**
 * glslLint.ts — static checks for the WebGL1 (GLSL ES 1.00) shaders inside generated "html-webgl" artworks.
 *
 * Why this exists: 20/11/2026, work #9 "Governance Grid Revolt" was published on-chain with a shader that
 * never compiled (`float(i%10)` — no integer `%` in GLSL ES 1.00). The page showed a black canvas, with no
 * error anywhere: the browser only logs the compile failure to the console. Nothing in the pipeline could
 * see it — the structural check looked for markup, the curator and the two technical reviewers are LLMs
 * reading source text, and no step ever compiled a shader.
 *
 * This is NOT a GLSL compiler. It catches, by pattern, the compile errors that generated code actually
 * produces, each one confirmed against a real WebGL1 compiler (Chromium/ANGLE, 21/11/2026):
 *   - integer `%`, bit-wise operators                 ("supported in GLSL ES 3.00 and above only")
 *   - `#version 300 es` / in/out qualifiers while the page only creates a "webgl" (v1) context
 *   - a loop compared with a non-constant                ("Loop index cannot be compared with non-constant expression")
 *   - an int where a float is required (`float a = 1;`, `a * 2`, `pow(a, 2)`)   (no implicit conversion in ES 1.00)
 *   - dFdx/dFdy/fwidth without the derivatives extension
 *   - a fragment shader with no default float precision   (an error by the spec and on most phones; desktop ANGLE is lenient)
 * plus one JavaScript-side rule: the page must read COMPILE_STATUS/LINK_STATUS, so that a failure is visible
 * (fallback drawing or an on-screen message) instead of a silent black canvas.
 *
 * Anything it does not recognise passes. The authoritative check is the real-browser render probe
 * (scripts/render-probe.mjs, run by GitHub Actions): this file only makes the common failures cheap to
 * reject before a revision cycle is spent, and gives each failure a stable `code` that feeds the Normies'
 * memory of what failed (workLessons.ts).
 */

export interface GlslLintIssue {
  /** Stable machine-readable id — also the key under which workLessons.ts remembers the failure. */
  code: string;
  message: string;
}

/** Strings of the page that look like a shader (contain `void main(`) — GLSL lives inside JS string literals. */
function shaderLiterals(html: string): string[] {
  const literals = html.match(/`[^`]*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) ?? [];
  return literals.filter(l => /\bvoid\s+main\s*\(/.test(l));
}

function stripGlslComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Built-ins that take float-only arguments in GLSL ES 1.00: a bare integer literal argument has no overload.
const FLOAT_ONLY_FUNCTIONS = "pow|mod|min|max|clamp|mix|step|smoothstep|sin|cos|tan|asin|acos|atan|abs|sign|floor|ceil|fract|sqrt|inversesqrt|exp|exp2|log|log2|length|distance|dot|normalize|reflect";

function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0, cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { args.push(cur); cur = ""; } else cur += ch;
  }
  args.push(cur);
  return args;
}

function lintOneShader(literal: string, pageUsesWebgl2: boolean): GlslLintIssue[] {
  const issues: GlslLintIssue[] = [];
  const code = stripGlslComments(literal);
  const isEs300 = /#version\s+300\s+es/.test(code);

  if (isEs300) {
    // A WebGL2 shader is outside ES 1.00's rules — but only compiles in a webgl2 context.
    if (!pageUsesWebgl2) {
      issues.push({ code: "glsl-version-300-without-webgl2", message: "a shader declares `#version 300 es` but the page only creates a \"webgl\" (WebGL1) context — call getContext(\"webgl2\") or write GLSL ES 1.00 (attribute/varying/gl_FragColor)" });
    }
    return issues;
  }

  if (/[\w)\]]\s*%\s*[\w(]/.test(code)) {
    issues.push({ code: "glsl-int-modulo", message: "a shader uses the integer modulus operator `%`, which does not exist in WebGL1 (GLSL ES 1.00) and breaks compilation (black canvas) — use mod(float(a), float(b)) instead" });
  }
  if (/<<|>>|~|(?<![&])&(?![&=])|(?<![|])\|(?![|=])|(?<!\^)\^(?![\^=])/.test(code)) {
    issues.push({ code: "glsl-bitwise", message: "a shader uses a bit-wise operator (<< >> & | ^ ~), which does not exist in WebGL1 (GLSL ES 1.00) — use arithmetic (floor, mod, multiplication) instead" });
  }
  if (/^\s*(?:in|out)\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|int|vec[234]|ivec[234]|mat[234])\s+\w+\s*;/m.test(code)) {
    issues.push({ code: "glsl-inout-qualifier", message: "a shader declares top-level `in`/`out` variables without `#version 300 es` — in GLSL ES 1.00 use `attribute`/`varying` (and gl_FragColor)" });
  }
  if (/\bgl_Frag(?:Color|Data)\b/.test(code) && !/\bprecision\s+(?:highp|mediump|lowp)\s+float\s*;/.test(code)) {
    issues.push({ code: "glsl-no-precision", message: "a fragment shader has no default float precision (`precision mediump float;`) — required by GLSL ES 1.00 and rejected on most phones" });
  }
  if (/\b(?:dFdx|dFdy|fwidth)\s*\(/.test(code) && !/#extension\s+GL_OES_standard_derivatives/.test(code)) {
    issues.push({ code: "glsl-derivatives-ext", message: "a shader calls dFdx/dFdy/fwidth without `#extension GL_OES_standard_derivatives : enable` (and gl.getExtension in JS) — not available in plain WebGL1" });
  }

  // for (int i = ...; i < BOUND; ...) — BOUND must be a constant expression in ES 1.00.
  const constNames = new Set<string>([
    ...[...code.matchAll(/\bconst\s+(?:int|float)\s+(\w+)/g)].map(m => m[1]),
    ...[...code.matchAll(/^\s*#define\s+(\w+)/gm)].map(m => m[1]),
  ]);
  for (const m of code.matchAll(/\bfor\s*\([^;]*;\s*\w+\s*(?:<=?|>=?|!=)\s*([A-Za-z_]\w*)\s*;/g)) {
    if (!constNames.has(m[1])) {
      issues.push({ code: "glsl-nonconst-loop", message: `a shader loop is compared with \`${m[1]}\`, which is not a constant — GLSL ES 1.00 loops need constant bounds (use a literal or a \`const int\`, and \`break\` for a dynamic limit)` });
      break;
    }
  }

  // int where float is required — ES 1.00 has no implicit int→float conversion.
  const floatNames = new Set([...code.matchAll(/\bfloat\s+(\w+)\s*(?=[=;,)\[])/g)].map(m => m[1]));
  for (const n of [...code.matchAll(/\b(?:int|ivec[234])\s+(\w+)/g)].map(m => m[1])) floatNames.delete(n);
  const intLiteralIssues: string[] = [];
  for (const m of code.matchAll(/\bfloat\s+\w+\s*=\s*(\d+)\s*[;,]/g)) intLiteralIssues.push(`\`float … = ${m[1]}\``);
  for (const name of floatNames) {
    const n = name.replace(/[$]/g, "\\$");
    const assign = new RegExp(`(?<![\\w.])${n}\\s*[-+*/]?=\\s*(\\d+)\\s*[;,)]`).exec(code);
    if (assign) intLiteralIssues.push(`\`${name} = ${assign[1]}\``);
    const after = new RegExp(`(?<![\\w.])${n}\\s*[-+*/]\\s*(\\d+)(?![\\d.eE\\w(])`).exec(code);
    if (after) intLiteralIssues.push(`\`${name} … ${after[1]}\``);
    const before = new RegExp(`(?<![\\w.])(?<![eE][-+])(\\d+)(?![\\d.eE\\w])\\s*[-+*/]\\s*${n}(?![\\w(])`).exec(code);
    if (before) intLiteralIssues.push(`\`${before[1]} … ${name}\``);
  }
  for (const fm of code.matchAll(new RegExp(`\\b(${FLOAT_ONLY_FUNCTIONS})\\s*\\(([^()]*)\\)`, "g"))) {
    if (splitTopLevelArgs(fm[2]).some(a => /^\s*\d+\s*$/.test(a))) intLiteralIssues.push(`\`${fm[1]}(…)\` with an integer argument`);
  }
  if (intLiteralIssues.length > 0) {
    issues.push({ code: "glsl-int-float-mix", message: `a shader mixes int and float (${[...new Set(intLiteralIssues)].slice(0, 3).join(", ")}) — GLSL ES 1.00 has no implicit conversion: write 1.0 not 1, 2.0 not 2` });
  }

  return issues;
}

/** All lint findings for an html-webgl page (shaders + the JavaScript compile-check requirement). */
export function lintWebglPage(html: string): GlslLintIssue[] {
  const issues: GlslLintIssue[] = [];
  const pageUsesWebgl2 = /getContext\s*\(\s*["'`]webgl2["'`]/.test(html);
  const seen = new Set<string>();
  for (const literal of shaderLiterals(html)) {
    for (const issue of lintOneShader(literal, pageUsesWebgl2)) {
      if (!seen.has(issue.code)) { seen.add(issue.code); issues.push(issue); }
    }
  }
  if (shaderLiterals(html).length > 0 && !/COMPILE_STATUS|LINK_STATUS/.test(html)) {
    issues.push({
      code: "webgl-no-compile-check",
      message: "the page compiles shaders but never reads gl.COMPILE_STATUS / gl.LINK_STATUS — a shader that fails to compile then leaves a silent black canvas. Check getShaderParameter(shader, gl.COMPILE_STATUS) and getProgramParameter(program, gl.LINK_STATUS) and, on failure, draw a visible Canvas 2D fallback",
    });
  }
  return issues;
}
