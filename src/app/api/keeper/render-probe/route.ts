/**
 * /api/keeper/render-probe — the server half of the real-browser render check (see lib/renderProbe.ts).
 *
 *   GET                       → { pending: [{ workId, sourceHash, artForm, requestedAt }] } — artworks waiting
 *                               for a verdict. Reads ONE kv row, so polling it every orchestrator tick is free.
 *   GET ?workId=…&html=1      → that work's current artwork HTML, served exactly as production serves a
 *                               generative piece (same hash-based CSP), but never cached.
 *   POST { workId, sourceHash, observation } → what Chrome saw; the SERVER judges it (judgeObservation), stores
 *                               the verdict and records the failure as a lesson the Normies will read next time.
 *
 * Auth: x-cron-secret (the Actions step) or an owner signature. Read-only on works: it never edits an artwork.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isCronOrAdmin } from "@/lib/keeperAuth";
import { getWork } from "@/lib/workStore";
import { serveGenerativeHtml } from "@/lib/artworkServer";
import {
  judgeObservation, listProbeQueue, recordProbeResult, sourceHashOf, type RawProbeObservation,
} from "@/lib/renderProbe";
import { recordWorkFailure } from "@/lib/workLessons";
import { redactSecrets } from "@/lib/redact";

const NO_STORE = { "Cache-Control": "private, no-store" };
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

export async function GET(req: NextRequest) {
  if (!(await isCronOrAdmin(req))) return unauthorized();

  const workId = req.nextUrl.searchParams.get("workId");
  if (workId && req.nextUrl.searchParams.get("html") === "1") {
    const work = await getWork(workId);
    if (!work?.artworkText) return NextResponse.json({ error: "No artwork for this work" }, { status: 404, headers: NO_STORE });
    const res = serveGenerativeHtml(work.artworkText, work.artForm, `render-probe ${workId}`);
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("X-Source-Hash", sourceHashOf(work.artworkText));
    return res;
  }

  return NextResponse.json({ pending: await listProbeQueue() }, { headers: NO_STORE });
}

function asStringArray(v: unknown, max: number, len: number): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map(s => redactSecrets(s).slice(0, len)) : [];
}

function parseObservation(raw: unknown): RawProbeObservation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const lit = num(o.litRatio), motion = num(o.motionRatio), luma = num(o.meanLuma);
  if (lit == null || motion == null || luma == null) return null;
  const glErrors = Array.isArray(o.glErrors)
    ? o.glErrors.slice(0, 4).flatMap(g => {
        const e = g as { kind?: unknown; log?: unknown };
        return (e.kind === "shader" || e.kind === "link") && typeof e.log === "string"
          ? [{ kind: e.kind as "shader" | "link", log: redactSecrets(e.log).slice(0, 400) }] : [];
      })
    : [];
  return {
    glErrors, litRatio: lit, motionRatio: motion, meanLuma: luma,
    pageErrors: asStringArray(o.pageErrors, 4, 300), consoleErrors: asStringArray(o.consoleErrors, 6, 200),
    cspViolations: asStringArray(o.cspViolations, 4, 200),
  };
}

export async function POST(req: NextRequest) {
  if (!(await isCronOrAdmin(req))) return unauthorized();

  let body: { workId?: unknown; sourceHash?: unknown; observation?: unknown } = {};
  try { body = await req.json(); } catch { /* rejected below */ }
  const workId = typeof body.workId === "string" ? body.workId : "";
  const sourceHash = typeof body.sourceHash === "string" && /^[0-9a-f]{64}$/.test(body.sourceHash) ? body.sourceHash : "";
  const observation = parseObservation(body.observation);
  if (!workId || !sourceHash || !observation) {
    return NextResponse.json({ error: "workId, sourceHash (sha256 hex) and a valid observation are required" }, { status: 400, headers: NO_STORE });
  }

  const verdict = judgeObservation(observation);
  const stored = await recordProbeResult(workId, {
    sourceHash, status: verdict.errors.length ? "failed" : "ok",
    errors: verdict.errors, codes: verdict.codes, warnings: verdict.warnings, warningCodes: verdict.warningCodes,
    metrics: { litRatio: observation.litRatio, motionRatio: observation.motionRatio, meanLuma: observation.meanLuma, consoleErrors: observation.consoleErrors.length },
  });
  if (!stored) return NextResponse.json({ ok: true, stale: true }, { headers: NO_STORE });

  // What the browser saw becomes memory the Normies read before their next creation.
  const work = await getWork(workId).catch(() => null);
  const form = work?.artForm ?? "html";
  for (const code of [...verdict.codes, ...verdict.warningCodes]) {
    const detail = code === "shader-compile-error" ? verdict.errors[0] : undefined;
    await recordWorkFailure({ form, code, workTitle: work?.title, source: "render-probe", detail });
  }

  return NextResponse.json({ ok: true, status: verdict.errors.length ? "failed" : "ok", ...verdict }, { headers: NO_STORE });
}
