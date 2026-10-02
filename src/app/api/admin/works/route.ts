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
import { getWork, listWorks, updatePodArtifactsForSource } from "@/lib/workStore";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { generateSceneCompanion } from "@/lib/anaSceneAuthoring";
import { canonicalizeSceneV1, hashArtworkSource } from "@/lib/anaSceneV1";
import { redactSecrets } from "@/lib/redact";

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
 * Stores one bounded browser-captured gray8 fallback frame, or compiles the
 * closed scene-v1 companion for an existing generative work. The admin
 * browser renders the already-validated HTML in a sandbox; the server never
 * executes the HTML/JS itself. Both paths are bound to expectedSourceHash so
 * a revision racing the request is rejected instead of mislabelled.
 */
export async function POST(req: NextRequest) {
  if (!(await verifyAdminRequest(req)).ok) {
    return NextResponse.json({ error: "Unauthorized — a valid admin signature is required" }, { status: 401 });
  }

  let body: {
    action?: unknown; workId?: unknown; expectedSourceHash?: unknown;
    pixels?: unknown; width?: unknown; height?: unknown; timeMs?: unknown;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const workId = typeof body.workId === "string" ? body.workId : "";
  const expectedSourceHash = typeof body.expectedSourceHash === "string" ? body.expectedSourceHash : "";
  if (!workId || !expectedSourceHash) {
    return NextResponse.json({ error: "workId and expectedSourceHash are required" }, { status: 400 });
  }

  const work = await getWork(workId);
  if (!work) return NextResponse.json({ error: `Work ${workId} not found` }, { status: 404 });
  if (!work.artForm?.startsWith("html-") || !work.artworkText) {
    return NextResponse.json({ error: "PoD artifacts are only available for a generative html-* work with artworkText" }, { status: 409 });
  }
  const currentSourceHash = hashArtworkSource(work.artworkText);
  if (currentSourceHash !== expectedSourceHash) {
    return NextResponse.json({ error: "Artwork changed while the PoD artifact was being prepared; reload and retry" }, { status: 409 });
  }

  if (body.action === "compile-scene") {
    const generated = await generateSceneCompanion({
      workId: work.id,
      title: work.title,
      artForm: work.artForm,
      proposal: work.proposal,
      brief: work.brief,
      artworkText: work.artworkText,
    });
    if (!generated.ok || !generated.scene || !generated.sceneHash) {
      const safeError = redactSecrets(generated.error ?? "scene-v1 generation failed").slice(0, 500);
      const writeResult = await updatePodArtifactsForSource(work.id, currentSourceHash, {
        podSceneAttemptedSourceHash: currentSourceHash,
        podSceneStatus: "fallback",
        podSceneError: safeError,
      });
      if (writeResult === "source-mismatch") {
        return NextResponse.json({ error: "Artwork changed during scene compilation; reload and retry" }, { status: 409 });
      }
      return NextResponse.json({ error: safeError, fallback: "capture" }, { status: 422 });
    }
    const canonicalJson = canonicalizeSceneV1(generated.scene);
    const sceneRevision = (work.podSceneRevision ?? 0) + 1;
    const writeResult = await updatePodArtifactsForSource(work.id, currentSourceHash, {
      podSceneJson: canonicalJson,
      podSceneHash: generated.sceneHash,
      podSceneSourceHash: generated.sourceHash,
      podSceneAt: Date.now(),
      podSceneRevision: sceneRevision,
      podSceneCorrespondence: generated.correspondence,
      podSceneAttemptedSourceHash: currentSourceHash,
      podSceneStatus: "ready",
      podSceneError: undefined,
    });
    if (writeResult === "source-mismatch") {
      return NextResponse.json({ error: "Artwork changed during scene compilation; reload and retry" }, { status: 409 });
    }
    if (writeResult === "not-found") return NextResponse.json({ error: `Work ${workId} not found` }, { status: 404 });
    return NextResponse.json({
      ok: true,
      workId: work.id,
      state: work.state,
      sceneHash: generated.sceneHash,
      sourceHash: generated.sourceHash,
      sceneRevision,
      provider: generated.provider,
      feedEligible: work.state === "PUBLISHED",
    });
  }

  const pixels = typeof body.pixels === "string" ? body.pixels : "";
  const width  = typeof body.width === "number" ? body.width : 0;
  const height = typeof body.height === "number" ? body.height : 0;
  const timeMs = typeof body.timeMs === "number" && Number.isFinite(body.timeMs)
    ? Math.max(0, Math.round(body.timeMs))
    : 0;

  // One compact common source frame. PoD performs the four profile-specific
  // encodings once at ingestion; the ESP never downloads RGBA/HTML.
  if (width !== 128 || height !== 160 || !pixels) {
    return NextResponse.json({ error: "a 128x160 gray8 capture is required" }, { status: 400 });
  }
  const bytes = Buffer.from(pixels, "base64");
  if (bytes.length !== width * height) {
    return NextResponse.json({ error: `Invalid capture size: ${bytes.length} bytes, expected ${width * height}` }, { status: 400 });
  }

  const captureHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const capturedAt  = Date.now();
  const writeResult = await updatePodArtifactsForSource(work.id, currentSourceHash, {
    podCapturePixels: pixels,
    podCaptureWidth: width,
    podCaptureHeight: height,
    podCaptureAt: capturedAt,
    podCaptureTimeMs: timeMs,
    podCaptureHash: captureHash,
    podCaptureSourceHash: currentSourceHash,
  });
  if (writeResult === "source-mismatch") {
    return NextResponse.json({ error: "Artwork changed during capture; reload and retry" }, { status: 409 });
  }
  if (writeResult === "not-found") return NextResponse.json({ error: `Work ${workId} not found` }, { status: 404 });

  return NextResponse.json({
    ok: true, workId: work.id, state: work.state,
    captureHash, sourceHash: currentSourceHash, capturedAt,
    feedEligible: work.state === "PUBLISHED",
  });
}
