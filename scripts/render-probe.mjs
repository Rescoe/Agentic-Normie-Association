#!/usr/bin/env node
/**
 * render-probe.mjs — loads generative artworks in a REAL Chrome and reports what happened.
 * Server side of the verdict: src/lib/renderProbe.ts + src/app/api/keeper/render-probe/route.ts.
 *
 *   node scripts/render-probe.mjs --pending            (CI: orchestrator.yml) read the queue, probe, POST the observations
 *   node scripts/render-probe.mjs --url <page-url>     probe one page and print the result (no network write)
 *   node scripts/render-probe.mjs --audit              probe every PUBLISHED html work of the live site and print a table
 *
 * Env: APP_URL (default https://agentic-normie-association.vercel.app), CRON_SECRET (--pending only),
 *      PLAYWRIGHT_MODULE (path/URL of playwright-core's entry, default "playwright-core"),
 *      PROBE_CHANNEL (default "chrome"; "" = Playwright's own Chromium), PROBE_SETTLE_MS (default 3000).
 *
 * The script only OBSERVES. It never decides whether a work is published — the server judges the observation.
 * Infrastructure failures exit 0 with a ::warning:: (a red run would send a failure e-mail for something the
 * pipeline already tolerates: the gate fails open after 18 h).
 */
import { pathToFileURL } from "url";

const APP_URL = (process.env.APP_URL || "https://agentic-normie-association.vercel.app").replace(/\/$/, "");
const SETTLE_MS = Number(process.env.PROBE_SETTLE_MS || 3000);
const SECOND_SHOT_MS = 1500;

/** Mirror of judgeObservation() in src/lib/renderProbe.ts — used only to print an indicative verdict; tests keep them equal. */
export function judgeObservation(o) {
  const errors = [], codes = [], warnings = [], warningCodes = [];
  for (const g of o.glErrors.slice(0, 2)) errors.push(`a ${g.kind === "shader" ? "shader failed to compile" : "WebGL program failed to link"}: ${g.log.replace(/\s+/g, " ").slice(0, 200)}`);
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

// Runs in every frame BEFORE the page's own scripts: records shader/link failures (the browser otherwise only
// logs them), and makes storage/cookies throw like they do inside the gallery's sandbox="allow-scripts" iframe.
function installProbeHooks() {
  const p = (window.__probe = { glErrors: [], pageErrors: [], consoleErrors: [], csp: [] });
  const hook = proto => {
    if (!proto) return;
    const cs = proto.compileShader, lp = proto.linkProgram;
    proto.compileShader = function (sh) {
      cs.call(this, sh);
      try { if (!this.getShaderParameter(sh, this.COMPILE_STATUS)) p.glErrors.push({ kind: "shader", log: this.getShaderInfoLog(sh) || "" }); } catch (e) { /* context lost */ }
    };
    proto.linkProgram = function (prog) {
      lp.call(this, prog);
      try { if (!this.getProgramParameter(prog, this.LINK_STATUS)) p.glErrors.push({ kind: "link", log: this.getProgramInfoLog(prog) || "" }); } catch (e) { /* context lost */ }
    };
  };
  hook(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  hook(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  const deny = () => { throw new DOMException("The document is sandboxed and lacks the 'allow-same-origin' flag.", "SecurityError"); };
  for (const name of ["localStorage", "sessionStorage"]) { try { Object.defineProperty(window, name, { get: deny, configurable: true }); } catch (e) { /* ignore */ } }
  try { Object.defineProperty(document, "cookie", { get: deny, set: deny, configurable: true }); } catch (e) { /* ignore */ }
  document.addEventListener("securitypolicyviolation", e => p.csp.push(`${e.violatedDirective} ${e.blockedURI || ""}`.trim()));
}

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_MODULE || "playwright-core";
  const isPath = /^(\/|[A-Za-z]:[\\/])/.test(spec);
  const mod = await import(isPath ? pathToFileURL(spec).href : spec);
  return mod.chromium || mod.default?.chromium;
}

async function analyze(context, shotA, shotB) {
  const page = await context.newPage();
  try {
    return await page.evaluate(async ([a, b]) => {
      const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/png;base64," + src; });
      const [i1, i2] = await Promise.all([load(a), load(b)]);
      const W = i1.width, H = i1.height, n = W * H;
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(i1, 0, 0); const d1 = x.getImageData(0, 0, W, H).data;
      x.clearRect(0, 0, W, H); x.drawImage(i2, 0, 0); const d2 = x.getImageData(0, 0, W, H).data;
      const counts = new Map(); let luma = 0, changed = 0;
      for (let i = 0; i < d1.length; i += 4) {
        const k = ((d1[i] >> 4) << 8) | ((d1[i + 1] >> 4) << 4) | (d1[i + 2] >> 4);
        counts.set(k, (counts.get(k) || 0) + 1);
        luma += 0.2126 * d1[i] + 0.7152 * d1[i + 1] + 0.0722 * d1[i + 2];
        if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 24) changed++;
      }
      let best = 0; for (const v of counts.values()) if (v > best) best = v;
      return { litRatio: 1 - best / n, motionRatio: changed / n, meanLuma: luma / n };
    }, [shotA.toString("base64"), shotB.toString("base64")]);
  } finally { await page.close(); }
}

/** Loads one URL and returns what the browser observed. `headers` apply to requests to `headerHost` only. */
export async function observe(browser, url, { headers, headerHost } = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.addInitScript(installProbeHooks);
  if (headers && headerHost) {
    await context.route(u => u.host === headerHost, route => route.continue({ headers: { ...route.request().headers(), ...headers } }));
  }
  const pageErrors = [], consoleErrors = [];
  const page = await context.newPage();
  page.on("pageerror", e => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  let sourceHash = null;
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 25000 });
    if (!response || !response.ok()) throw new Error(`HTTP ${response ? response.status() : "no response"} for ${url}`);
    sourceHash = response.headers()["x-source-hash"] || null;
    await page.waitForTimeout(SETTLE_MS);
    const shotA = await page.screenshot({ type: "png" });
    await page.waitForTimeout(SECOND_SHOT_MS);
    const shotB = await page.screenshot({ type: "png" });
    const metrics = await analyze(context, shotA, shotB);
    const inPage = await page.evaluate(() => window.__probe || { glErrors: [], pageErrors: [], consoleErrors: [], csp: [] });
    return {
      sourceHash,
      observation: {
        glErrors: inPage.glErrors, pageErrors: [...inPage.pageErrors, ...pageErrors], consoleErrors: [...inPage.consoleErrors, ...consoleErrors],
        cspViolations: inPage.csp, ...metrics,
      },
    };
  } finally { await context.close(); }
}

async function launch() {
  const chromium = await loadPlaywright();
  const channel = process.env.PROBE_CHANNEL === undefined ? "chrome" : process.env.PROBE_CHANNEL;
  return chromium.launch({
    headless: true, ...(channel ? { channel } : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
  });
}

const fmt = n => (typeof n === "number" ? n.toFixed(4) : String(n));

async function modePending() {
  const secret = process.env.CRON_SECRET;
  if (!secret) { console.log("::warning::CRON_SECRET missing — render probe skipped"); return; }
  const auth = { "x-cron-secret": secret };
  const queueRes = await fetch(`${APP_URL}/api/keeper/render-probe`, { headers: auth });
  if (!queueRes.ok) { console.log(`::warning::render-probe queue unreadable (HTTP ${queueRes.status}) — skipped`); return; }
  const { pending } = await queueRes.json();
  if (!pending.length) { console.log("render probe: nothing pending"); return; }
  const browser = await launch();
  try {
    for (const entry of pending) {
      const pageUrl = `${APP_URL}/api/keeper/render-probe?workId=${encodeURIComponent(entry.workId)}&html=1`;
      try {
        const { sourceHash, observation } = await observe(browser, pageUrl, { headers: auth, headerHost: new URL(APP_URL).host });
        const verdict = judgeObservation(observation);
        console.log(`${entry.workId}: ${verdict.errors.length ? "FAILED" : "ok"} lit=${fmt(observation.litRatio)} motion=${fmt(observation.motionRatio)} ${verdict.errors.concat(verdict.warnings).join(" | ")}`);
        const post = await fetch(`${APP_URL}/api/keeper/render-probe`, {
          method: "POST", headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ workId: entry.workId, sourceHash: sourceHash || entry.sourceHash, observation }),
        });
        if (!post.ok) console.log(`::warning::verdict for ${entry.workId} not stored (HTTP ${post.status})`);
      } catch (e) {
        console.log(`::warning::probe of ${entry.workId} failed: ${e && e.message ? e.message : e} — left in the queue`);
      }
    }
  } finally { await browser.close(); }
}

async function modeUrl(url) {
  const browser = await launch();
  try {
    const { observation } = await observe(browser, url);
    console.log(JSON.stringify({ observation, verdict: judgeObservation(observation) }, null, 2));
  } finally { await browser.close(); }
}

async function modeAudit() {
  const works = await (await fetch(`${APP_URL}/api/works`)).json();
  const html = works.filter(w => w.state === "PUBLISHED" && typeof w.artForm === "string" && w.artForm.startsWith("html-") && Number.isInteger(w.onChainWorkId));
  const browser = await launch();
  try {
    for (const w of html.sort((a, b) => a.onChainWorkId - b.onChainWorkId)) {
      try {
        const { observation } = await observe(browser, `${APP_URL}/api/works/html/${w.onChainWorkId}`);
        const v = judgeObservation(observation);
        console.log(`#${w.onChainWorkId} ${w.title} [${w.artForm}] ${v.errors.length ? "FAILED" : "ok"} lit=${fmt(observation.litRatio)} motion=${fmt(observation.motionRatio)} ${v.errors.concat(v.warnings).join(" | ")}`);
      } catch (e) { console.log(`#${w.onChainWorkId} ${w.title}: probe error ${e && e.message ? e.message : e}`); }
    }
  } finally { await browser.close(); }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const run = args.includes("--pending") ? modePending()
    : args.includes("--audit") ? modeAudit()
    : args.includes("--url") ? modeUrl(args[args.indexOf("--url") + 1])
    : Promise.reject(new Error("usage: render-probe.mjs --pending | --audit | --url <page-url>"));
  run.catch(e => { console.log(`::warning::render probe failed: ${e && e.stack ? e.stack : e}`); process.exit(args.includes("--url") || args.includes("--audit") ? 1 : 0); });
}
