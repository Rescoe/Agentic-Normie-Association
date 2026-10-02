/**
 * generativeArtwork.ts — Validation, normalization and CSP generation for
 * html-* generative works (html-canvas, html-p5js, html-threejs, html-webgl).
 *
 * This is the single source of truth for:
 *  - which CDN libs are allowed and their pinned SRI hashes,
 *  - the minimal structural contract each form must satisfy,
 *  - stripping any CSP the LLM tried to author itself,
 *  - computing a real CSP (hash-based, no 'unsafe-inline') at serve time.
 *
 * Pure string/crypto logic only — no Next.js / DB imports — so it can be
 * unit-tested directly with mocha (see test/generativeArtwork.test.ts).
 */
import crypto from "crypto";

export const GENERATIVE_FORMS = ["html-canvas", "html-p5js", "html-threejs", "html-webgl"] as const;
export type GenerativeForm = typeof GENERATIVE_FORMS[number];

export function isGenerativeForm(form?: string): form is GenerativeForm {
  return !!form && (GENERATIVE_FORMS as readonly string[]).includes(form);
}

// SRI hashes computed on 2026-06-17 from the exact CDN files.
// If you update a library version, recompute:
//   curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
export const CDN_SRI: Record<GenerativeForm, { url: string; hash: string } | null> = {
  "html-canvas":  null,
  "html-webgl":   null,
  "html-p5js":    { url: "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js",     hash: "sha384-6Twx1hAeKnwfOYJAHtYeJETRiGD5pRPkjjh0pVbG1QoesncjOpw5e75Y1kOkXeRI" },
  "html-threejs": { url: "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", hash: "sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu" },
};

// p5.sound (the addon exposing p5.SoundFile/Oscillator/Env/FFT/Amplitude/...)
// is NOT part of p5.min.js — it's a separate file. 29/09-01/10/2026 incident:
// "Neon Pulse Canvas" used p5.FFT/p5.Oscillator/p5.SoundFile/p5.Env while only
// the core p5.js CDN tag was present and required, so it passed every
// existing check and would have crashed at runtime ("p5.SoundFile is not a
// constructor") the moment someone opened it. Rather than trying to detect
// "does this code use audio" (fragile — misses anything the regex doesn't
// anticipate), html-p5js ALWAYS loads p5.sound alongside the core library:
// the failure class is eliminated structurally instead of pattern-matched.
// SRI hash from cdnjs's own API for p5.js 1.9.4's addons/p5.sound.min.js,
// cross-checked against a direct sha512 download (01/10/2026).
export const P5_SOUND_CDN = {
  url:  "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/addons/p5.sound.min.js",
  hash: "sha384-Ozi5ax1b+B/XBCzskytbAcQlgO0fcBp6gBOgS1SNQgR55vMk33RdVPAAAvB/8kA6",
};

export const CDN_HOST = "https://cdnjs.cloudflare.com";

/** Every CDN URL that must appear in the document for `artForm`, in the
 * order they should be loaded (p5.sound depends on p5 core being loaded
 * first). Single source of truth for both the Author's prompt (cdnForForm)
 * and validateGenerativeHtml's own required-tag check below — the two can
 * never drift apart. */
export function requiredCdnUrlsForForm(artForm?: string): Array<{ url: string; hash: string }> {
  if (artForm === "html-p5js") {
    const core = CDN_SRI["html-p5js"];
    return core ? [core, P5_SOUND_CDN] : [];
  }
  const entry = isGenerativeForm(artForm) ? CDN_SRI[artForm] : undefined;
  return entry ? [entry] : [];
}

export function cdnForForm(artForm?: string): string {
  return requiredCdnUrlsForForm(artForm)
    .map(({ url, hash }) => `<script src="${url}" integrity="${hash}" crossorigin="anonymous"></script>`)
    .join("\n");
}

// ─── Forbidden patterns ─────────────────────────────────────────────────────
// Anything that could reach outside the sandboxed iframe, hit the network,
// or execute via an attribute the CSP can't hash (onclick="...", etc).
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bfetch\s*\(/i,            label: "fetch()" },
  { re: /\bXMLHttpRequest\b/i,      label: "XMLHttpRequest" },
  { re: /\bimport\s*\(/i,           label: "dynamic import()" },
  { re: /\beval\s*\(/i,             label: "eval()" },
  { re: /\bnew\s+Function\s*\(/i,   label: "new Function()" },
  { re: /document\.write/i,         label: "document.write" },
  { re: /window\.parent/i,          label: "window.parent" },
  { re: /window\.top\b/i,           label: "window.top" },
  { re: /window\.ethereum/i,        label: "window.ethereum" },
  { re: /<iframe/i,                 label: "<iframe>" },
  { re: /\son[a-z]+\s*=\s*["']/i,   label: "inline event-handler attribute (onX=)" },
];

const CSP_META_RE = /<meta[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi;

const MAX_HTML_BYTES = 20_000; // ~15KB authored + CDN tag + a margin

// The Author prompt mandates injecting these as JS constants — checking for them
// catches the "brief data not incorporated" rejection class (e.g. tokenId/traits
// silently dropped on a revision).
const REQUIRED_DATA_CONSTS = ["NORMIE_ID", "NORMIE_ARCHETYPE", "NORMIE_TRAITS", "WORK_TITLE", "CREATED_AT"];

// At least one real drawing primitive is *preferred* per form — flags the
// "descriptive text dump instead of a visual artwork" case as a WARNING, not
// a hard rejection: Normies are free to make text-centric work (glitched,
// animated, reactive typography is a legitimate generative form), but the
// curator should weigh in on whether a piece with none of these is genuinely
// visual or should be reclassified as a literary work (poem/manifesto/prose).
const VISUAL_PRIMITIVES_BY_FORM: Record<GenerativeForm, RegExp> = {
  "html-p5js":    /\b(ellipse|circle|rect|square|line\s*\(|point\s*\(|arc\s*\(|triangle|quad|curve|bezier|vertex|beginShape|image\s*\()/i,
  "html-threejs": /THREE\.(Mesh|Points|Line2?|Sprite|InstancedMesh)\b/,
  "html-canvas":  /\b(fillRect|strokeRect|arc\s*\(|lineTo|bezierCurveTo|quadraticCurveTo|drawImage|createLinearGradient|createRadialGradient)\s*\(/i,
  "html-webgl":   /\b(drawArrays|drawElements|bufferData|createShader|createProgram)\s*\(/i,
};

// Hard rule, not a warning: a generative piece must not read its on-chain data
// out loud as a caption (e.g. text(`Normie #${NORMIE_ID} - ${NORMIE_ARCHETYPE}`)
// or printing NORMIE_TRAITS.map(...).join(...)). This exact pattern recurred
// across multiple submissions even after adding ellipse()/particle decoration
// around it — the data must shape the visuals (color/size/motion), not be
// displayed as readable text.
const TEXT_PRINTS_ONCHAIN_DATA_RE = /\b(?:text|fillText)\s*\([^)]*\bNORMIE_(?:ID|ARCHETYPE|TRAITS)\b/;

// A title is fine; a caption-driven piece is not. Counts call sites, not
// runtime executions — cheap and reliable for catching "the whole screen is
// text" without needing to actually run the sketch.
const MAX_TEXT_CALLS_BY_FORM: Partial<Record<GenerativeForm, number>> = {
  "html-p5js":   2,
  "html-canvas": 2,
};
const TEXT_CALL_RE = /\b(?:text|fillText)\s*\(/g;

export interface ValidationResult {
  valid: boolean;
  /** Hard technical-contract violations — block publication, trigger a revision. */
  errors: string[];
  /** Soft signals (e.g. no shape primitives detected) — surfaced to the curator, never block on their own. */
  warnings: string[];
  /** HTML with any author-supplied CSP meta stripped — the server sets CSP via header. */
  html: string;
}

/**
 * Validates a generated html-* artwork against the minimal technical contract
 * for its form, strips any CSP meta the LLM tried to author, and rejects
 * anything that could escape the sandbox or rely on un-hashable inline handlers.
 */
export function validateGenerativeHtml(rawHtml: string, artForm?: string): ValidationResult {
  const errors: string[]   = [];
  const warnings: string[] = [];
  const trimmed = (rawHtml ?? "").trim();

  if (!/^<!DOCTYPE html>/i.test(trimmed)) {
    errors.push("missing <!DOCTYPE html> at the start of the document");
  }
  if (!/<html[\s>]/i.test(trimmed)) errors.push("missing <html> tag");
  if (!/<\/html>\s*$/i.test(trimmed)) errors.push("missing closing </html> tag");
  if (!/<body[\s>]/i.test(trimmed)) errors.push("missing <body> tag");

  if (Buffer.byteLength(trimmed, "utf-8") > MAX_HTML_BYTES) {
    errors.push(`document too large (> ${MAX_HTML_BYTES} bytes)`);
  }

  for (const { re, label } of FORBIDDEN_PATTERNS) {
    if (re.test(trimmed)) errors.push(`forbidden pattern: ${label}`);
  }

  if (isGenerativeForm(artForm)) {
    if (artForm === "html-p5js") {
      if (!/function\s+setup\s*\(/i.test(trimmed)) errors.push("html-p5js: missing function setup()");
      if (!/createCanvas\s*\(/i.test(trimmed)) errors.push("html-p5js: missing createCanvas() call");
      // Both core p5.js AND p5.sound are required (see requiredCdnUrlsForForm's
      // doc comment) — never conditional on whether audio APIs were detected,
      // since that detection is exactly what would be fragile/incomplete.
      for (const { url } of requiredCdnUrlsForForm(artForm)) {
        if (!trimmed.includes(url)) errors.push(`html-p5js: missing the pinned CDN <script> tag for ${url}`);
      }
      // p5.sound's FFT requires a power-of-two bin count (16-1024). Only
      // catches a literal numeric argument — a variable/expression (e.g.
      // `new p5.FFT(0, barCount)`) can't be evaluated statically, so a
      // non-power-of-two value reached that way is NOT caught here. That
      // class of issue needs semantic review (see stepValidating's technical
      // review panel in work-lifecycle/route.ts), not a regex.
      const fftLiteralRe = /new\s+p5\.FFT\s*\(\s*[^,)]*,\s*(\d+)\s*\)/g;
      let fftMatch: RegExpExecArray | null;
      while ((fftMatch = fftLiteralRe.exec(trimmed)) !== null) {
        const bins = Number(fftMatch[1]);
        if (bins < 16 || bins > 1024 || (bins & (bins - 1)) !== 0) {
          errors.push(`html-p5js: new p5.FFT(..., ${bins}) — bin count must be a power of two between 16 and 1024`);
        }
      }
    } else if (artForm === "html-threejs") {
      if (!/THREE\./.test(trimmed)) errors.push("html-threejs: no THREE.* usage found");
      const cdn = CDN_SRI["html-threejs"];
      if (!cdn || !trimmed.includes(cdn.url)) errors.push("html-threejs: missing the pinned three.js CDN <script> tag");
    } else {
      // html-canvas / html-webgl: native canvas, no CDN expected.
      if (!/<canvas[\s>]/i.test(trimmed)) errors.push(`${artForm}: missing <canvas> element`);
      if (!/getContext\s*\(/i.test(trimmed)) errors.push(`${artForm}: missing getContext() call`);
    }

    if (!VISUAL_PRIMITIVES_BY_FORM[artForm].test(trimmed)) {
      warnings.push(`${artForm}: no real visual drawing primitive detected (shapes/geometry/motion) — looks text-centric; the curator should judge whether this is a worked/animated piece or should be reclassified as a literary work (poem/manifesto/prose)`);
    }

    if (TEXT_PRINTS_ONCHAIN_DATA_RE.test(trimmed)) {
      errors.push(`${artForm}: on-chain data (NORMIE_ID/NORMIE_ARCHETYPE/NORMIE_TRAITS) is printed as readable text — it must drive visual parameters (color, shape, motion, density) instead of being displayed as a caption`);
    }

    const maxTextCalls = MAX_TEXT_CALLS_BY_FORM[artForm];
    if (maxTextCalls != null) {
      const textCallCount = (trimmed.match(TEXT_CALL_RE) ?? []).length;
      if (textCallCount > maxTextCalls) {
        errors.push(`${artForm}: ${textCallCount} text()/fillText() call sites found (max ${maxTextCalls}) — the piece reads as a caption with decoration, not a generative visual; a small title is fine, the body must be carried by shapes/motion`);
      }
    }

    for (const name of REQUIRED_DATA_CONSTS) {
      if (!new RegExp(`\\b${name}\\b`).test(trimmed)) {
        errors.push(`missing required on-chain data constant: ${name}`);
      }
    }
  }

  // Strip any CSP meta tag the model added — we compute and serve our own via header.
  const normalized = trimmed.replace(CSP_META_RE, "");

  return { valid: errors.length === 0, errors, warnings, html: normalized };
}

// ─── CSP generation (hash-based, never 'unsafe-inline') ───────────────────

function sha256Base64(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("base64");
}

/**
 * Builds a strict CSP for a validated generative artwork document.
 * Every inline <script>/<style> block gets its own sha256 hash — no
 * 'unsafe-inline' and no 'unsafe-eval' anywhere in the policy.
 */
export function buildGenerativeCsp(html: string): string {
  const scriptHashes = new Set<string>();
  const styleHashes  = new Set<string>();

  const scriptRe = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    if (m[1].trim().length === 0) continue;
    scriptHashes.add(`'sha256-${sha256Base64(m[1])}'`);
  }

  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(html)) !== null) {
    if (m[1].trim().length === 0) continue;
    styleHashes.add(`'sha256-${sha256Base64(m[1])}'`);
  }

  const needsCdn = html.includes(CDN_HOST);
  // p5.sound builds its AudioWorklet/Worker modules from blob: URLs at load time.
  // Without blob: p5 never finishes preloading and the piece hangs on "Loading..."
  // (02/10/2026 incident). Scoped to works that load p5.sound only; network egress
  // stays fully closed by connect-src/frame-src/default-src 'none'.
  const needsBlob = /p5\.sound(\.min)?\.js/.test(html);
  const scriptSrc = ["'self'", ...scriptHashes, ...(needsCdn ? [CDN_HOST] : []), ...(needsBlob ? ["blob:"] : [])].join(" ");
  const styleSrc  = ["'self'", ...styleHashes].join(" ");

  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    ...(needsBlob ? ["worker-src blob:"] : []),
    `style-src ${styleSrc}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ") + ";";
}
