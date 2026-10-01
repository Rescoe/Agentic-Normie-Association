/**
 * GET /api/admin/works — full ANAWork records (including validationNote,
 * operational* diagnostics, internal counters) for the admin dashboard.
 *
 * The public GET /api/works (src/app/api/works/route.ts) intentionally
 * strips every diagnostic field via toPublicWork()'s allow-list — a raw RPC
 * provider key ended up in validationNote and was served there verbatim
 * (29/09/2026 incident). The admin panel still needs those diagnostics to
 * show "intervention requise" detail (error code, attempt count, what to
 * reconcile/resume) — this route is the authenticated place for that. Every
 * text diagnostic field is already redacted at write time
 * (workStore.updateWork()/advanceState()), so this is "detailed" without
 * being "raw".
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { revalidateTag } from "next/cache";
import { getWork, listWorks, updateWork } from "@/lib/workStore";
import { verifyAdminRequest } from "@/lib/adminAuth";

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return true;
  return (await verifyAdminRequest(req)).ok;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  const works = await listWorks();
  return NextResponse.json(works, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/admin/works
 * Stores one bounded browser-captured gray8 fallback frame for a generative
 * work. The admin browser renders the already-validated HTML in a sandbox;
 * the server never executes HTML/JS and never adds a headless renderer.
 */
export async function POST(req: NextRequest) {
  if (!(await verifyAdminRequest(req)).ok) {
    return NextResponse.json({ error: "Unauthorized — a valid admin signature is required" }, { status: 401 });
  }

  let body: { workId?: unknown; pixels?: unknown; width?: unknown; height?: unknown; timeMs?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const workId = typeof body.workId === "string" ? body.workId : "";
  const pixels = typeof body.pixels === "string" ? body.pixels : "";
  const width  = typeof body.width === "number" ? body.width : 0;
  const height = typeof body.height === "number" ? body.height : 0;
  const timeMs = typeof body.timeMs === "number" && Number.isFinite(body.timeMs)
    ? Math.max(0, Math.round(body.timeMs))
    : 0;

  // One compact common source frame. PoD performs the four profile-specific
  // encodings once at ingestion; the ESP never downloads RGBA/HTML.
  if (!workId || width !== 128 || height !== 160 || !pixels) {
    return NextResponse.json({ error: "workId and a 128x160 gray8 capture are required" }, { status: 400 });
  }
  const bytes = Buffer.from(pixels, "base64");
  if (bytes.length !== width * height) {
    return NextResponse.json({ error: `Invalid capture size: ${bytes.length} bytes, expected ${width * height}` }, { status: 400 });
  }

  const work = await getWork(workId);
  if (!work) return NextResponse.json({ error: `Work ${workId} not found` }, { status: 404 });
  if (!work.artForm?.startsWith("html-") || !work.artworkText) {
    return NextResponse.json({ error: "Capture is only available for a generative html-* work with artworkText" }, { status: 409 });
  }

  const captureHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const sourceHash  = `sha256:${createHash("sha256").update(work.artworkText).digest("hex")}`;
  const capturedAt  = Date.now();
  await updateWork(work.id, {
    podCapturePixels: pixels,
    podCaptureWidth: width,
    podCaptureHeight: height,
    podCaptureAt: capturedAt,
    podCaptureTimeMs: timeMs,
    podCaptureHash: captureHash,
    podCaptureSourceHash: sourceHash,
  });
  revalidateTag("ana-art-feed");

  return NextResponse.json({
    ok: true, workId: work.id, state: work.state,
    captureHash, sourceHash, capturedAt,
    feedEligible: work.state === "PUBLISHED",
  });
}
