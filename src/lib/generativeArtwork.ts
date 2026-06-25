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

export const CDN_HOST = "https://cdnjs.cloudflare.com";

export function cdnForForm(artForm?: string): string {
  const entry = isGenerativeForm(artForm) ? CDN_SRI[artForm] : undefined;
  if (!entry) return "";
  return `<script src="${entry.url}" integrity="${entry.hash}" crossorigin="anonymous"></script>`;
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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** HTML with any author-supplied CSP meta stripped — the server sets CSP via header. */
  html: string;
}

/**
 * Validates a generated html-* artwork against the minimal technical contract
 * for its form, strips any CSP meta the LLM tried to author, and rejects
 * anything that could escape the sandbox or rely on un-hashable inline handlers.
 */
export function validateGenerativeHtml(rawHtml: string, artForm?: string): ValidationResult {
  const errors: string[] = [];
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
      const cdn = CDN_SRI["html-p5js"];
      if (!cdn || !trimmed.includes(cdn.url)) errors.push("html-p5js: missing the pinned p5.js CDN <script> tag");
    } else if (artForm === "html-threejs") {
      if (!/THREE\./.test(trimmed)) errors.push("html-threejs: no THREE.* usage found");
      const cdn = CDN_SRI["html-threejs"];
      if (!cdn || !trimmed.includes(cdn.url)) errors.push("html-threejs: missing the pinned three.js CDN <script> tag");
    } else {
      // html-canvas / html-webgl: native canvas, no CDN expected.
      if (!/<canvas[\s>]/i.test(trimmed)) errors.push(`${artForm}: missing <canvas> element`);
      if (!/getContext\s*\(/i.test(trimmed)) errors.push(`${artForm}: missing getContext() call`);
    }
  }

  // Strip any CSP meta tag the model added — we compute and serve our own via header.
  const normalized = trimmed.replace(CSP_META_RE, "");

  return { valid: errors.length === 0, errors, html: normalized };
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
  const scriptSrc = ["'self'", ...scriptHashes, ...(needsCdn ? [CDN_HOST] : [])].join(" ");
  const styleSrc  = ["'self'", ...styleHashes].join(" ");

  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
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
