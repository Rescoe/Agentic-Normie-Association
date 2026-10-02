export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getNormieImageUrl } from "@/lib/normiesApi";
import { revalidateTag, unstable_cache } from "next/cache";
import { listWorks } from "@/lib/workStore";
import { listDrawings } from "@/lib/drawStore";
import { canonicalizeSceneV1, hashArtworkSource, hashGenerativeBundle, validateSceneV1, type AnaSceneV1 } from "@/lib/anaSceneV1";
import { USE_NEON, kvGet, kvSet } from "@/lib/db";

const FEED_SECRET = process.env.ANA_ART_FEED_SECRET ?? "";

// NOT a public CDN cache: this route is gated by a secret header
// (x-feed-secret) checked INSIDE the handler, but a Vercel Edge
// `Cache-Control: public` cache key does not vary on that header by
// default -- once one authorized caller populates the cache, an
// unauthorized request within the s-maxage window could be served the same
// cached 200 body straight from the edge, never re-running the handler's own
// auth check. `private, no-store` means every request re-executes the
// handler (and therefore re-checks the secret).
//
// That auth-safety reasoning still holds, but it left the actual Neon reads
// (listWorks/listDrawings) completely uncached -- fine when proof-of-draw
// was a single low-frequency caller, until it turned out to run TWO pollers
// hitting this route roughly every 5 min (found via Vercel logs, Sept 2026
// Neon cost investigation), which alone was enough to keep Neon's compute
// from ever seeing 5 minutes of inactivity. Fix: cache the DATA BUILD (not
// the HTTP response) in Next's shared Data Cache via unstable_cache, keyed
// independently of the secret/limit/request -- auth still runs on every
// request via FEED_SECRET before this is ever called, so an unauthorized
// caller never even reaches the cache.
const FEED_SNAPSHOT_POINTER_KEY = "ana-art-feed:snapshot:pointer:v4";
const FEED_SNAPSHOT_SLOT_PREFIX = "ana-art-feed:snapshot:slot:v4:";
const FEED_SNAPSHOT_MAX_ITEMS = 200;
type FeedSnapshotSlot = "a" | "b";

interface PersistedFeedSnapshot {
  schema: "ana-art-feed-snapshot-v4";
  generation: FeedSnapshotSlot;
  buildId: string;
  createdAt: number;
  items: AnaArtFeedItem[];
}

async function readDurableFeedSnapshot(): Promise<AnaArtFeedItem[] | null> {
  if (!USE_NEON) return null;
  const pointerRaw = await kvGet(FEED_SNAPSHOT_POINTER_KEY);
  if (!pointerRaw) return null;
  let generation: FeedSnapshotSlot;
  try {
    const pointer = JSON.parse(pointerRaw) as { generation?: unknown };
    generation = pointer.generation === "a" || pointer.generation === "b" ? pointer.generation : "a";
  } catch { return null; }
  for (const slot of [generation, generation === "a" ? "b" : "a"] as FeedSnapshotSlot[]) {
    const snapshotRaw = await kvGet(`${FEED_SNAPSHOT_SLOT_PREFIX}${slot}`);
    if (!snapshotRaw) continue;
    try {
      const snapshot = JSON.parse(snapshotRaw) as PersistedFeedSnapshot;
      if (snapshot.schema === "ana-art-feed-snapshot-v4" && snapshot.generation === slot && Array.isArray(snapshot.items)) {
        return snapshot.items.slice(0, FEED_SNAPSHOT_MAX_ITEMS);
      }
    } catch { /* try the previous slot */ }
  }
  return null;
}

async function persistFeedSnapshot(items: AnaArtFeedItem[]): Promise<void> {
  if (!USE_NEON) return;
  const boundedItems = items.slice(0, FEED_SNAPSHOT_MAX_ITEMS);
  const payloadHash = createHash("sha256").update(JSON.stringify(boundedItems), "utf8").digest("hex");
  let activeSlot: FeedSnapshotSlot | null = null;
  const pointerRaw = await kvGet(FEED_SNAPSHOT_POINTER_KEY);
  if (pointerRaw) {
    try {
      const pointer = JSON.parse(pointerRaw) as { generation?: unknown };
      if (pointer.generation === "a" || pointer.generation === "b") activeSlot = pointer.generation;
    } catch { /* bootstrap below */ }
  }
  const generation: FeedSnapshotSlot = activeSlot === "a" ? "b" : "a";
  const snapshot: PersistedFeedSnapshot = {
    schema: "ana-art-feed-snapshot-v4",
    generation,
    buildId: `${Date.now()}-${payloadHash.slice(0, 16)}`,
    createdAt: Date.now(),
    items: boundedItems,
  };
  // Inactive slot first, pointer last. The two-slot ring bounds storage while
  // retaining the previous complete snapshot across a partial write/failure.
  await kvSet(`${FEED_SNAPSHOT_SLOT_PREFIX}${generation}`, JSON.stringify(snapshot));
  await kvSet(FEED_SNAPSHOT_POINTER_KEY, JSON.stringify({ generation }));
}

const getCachedFeedItems = unstable_cache(
  async (): Promise<AnaArtFeedItem[]> => {
    const durable = await readDurableFeedSnapshot();
    if (durable) return durable;
    const [works, drawings] = await Promise.all([listWorks(), listDrawings()]);
    const items = buildFeedItems(works, drawings).slice(0, FEED_SNAPSHOT_MAX_ITEMS);
    // Bootstrap only. Normal publication writes and prewarms the generation
    // while Neon is already active, before an external PoD pull can arrive.
    await persistFeedSnapshot(items);
    return items;
  },
  ["ana-art-feed-v4"],   // v4 : bundle generatif scene-v1 + capture, adresse par contenu
  // No autonomous expiry: a PoD pull cannot turn time/device count into a
  // Neon read multiplier. Mutations rebuild a durable generation, atomically
  // move the pointer, invalidate, and prewarm this shared cache entry.
  { revalidate: false, tags: ["ana-art-feed"] },
);

const CACHE_HEADERS = { "Cache-Control": "private, no-store" };

export interface AnaArtFeedItem {
  id:             string;
  kind:           "celebration" | "spontaneous" | "poem" | "generative-capture" | "generative-scene";
  // celebration / spontaneous : bitmap brut. Absents pour "poem".
  pixels?:        string; // base64, raw grayscale bytes, canvasW*canvasH, 0-255
  canvasW?:       number;
  canvasH?:       number;
  // poem : texte intégral ; proof-of-draw le rend en pixels par type d'écran et y ajoute le visage
  // 40×40 du Normie auteur (api.normies.art/normie/{agentTokenId}/pixels).
  text?:          string;
  artForm?:       string; // poem : "haiku" | "sonnet" | "poem" | "prose" | "manifesto" (contrat V2)
  // ── Enveloppe contrat d'échange V2 (note 32) — présente sur les items "poem" ; les anciens items
  // (celebration / spontaneous) restent au format V1 pour ne pas casser le PoD déployé.
  schemaVersion?: 2;
  sourceId?:      string;
  revision?:      number;
  contentHash?:   string;  // sha256:<hex> du texte publié
  agentImageUrl?: string;
  language?:      string;  // BCP-47 (heuristique : fr si accents/mots français, sinon en)
  sourceHash?:    string;
  capture?: {
    type: "raw-grayscale";
    pixelEncoding: "gray8";
    pixels: string;
    width: number;
    height: number;
    captureHash: string;
    capturedAt: number;
    viewport: { width: number; height: number };
    seed: string;
    timeMs: number;
    rendererVersion: "ana-browser-capture-v1";
  };
  // A validated, closed companion for OLED/TFT. It shares this feed item
  // with the capture so old PoD deployments can keep using the latter while
  // scene-aware PoD selects the local runtime only for capable devices.
  scene?: {
    schema: "ana-scene-v1";
    encoding: "json";
    manifest: AnaSceneV1;
    sceneHash: string;
    sourceHash: string;
    bytes: number;
    rendererVersion: 1;
  };
  title:          string;
  agentTokenId:   number;
  agentName?:     string;
  publishedAt:    number;

  // ── Context shown in proof-of-draw's "Dessins d'agent IA" gallery detail.
  // All optional: a spontaneous drawing has none of the work-level fields.
  // artworkText (BMP data URI) is deliberately NOT included — it's a large
  // duplicate of `pixels`.
  cartelText?:      string;   // the agent's artist statement for this piece
  brief?:           string;   // artistic brief (standard works only — memorials skip briefing)
  proposal?:        string;   // the proposal that led to the work
  memorialKind?:    "batch" | "requested" | "milestone";
  burnedTokenIds?:  number[]; // Normies honored (a milestone lists only a sample)
  totalBurnedHonored?: number; // milestone monuments: true number of burns honored
  voteResult?:      "passed" | "rejected";
  yesCount?:        number;
  noCount?:         number;
  absCount?:        number;
  revisionCount?:   number;
  onChainWorkId?:   number;
  txHash?:          string;
  collectionAddress?: string;
  decisionNote?:    string;   // spontaneous drawings: reviewer's note
}

export function buildFeedItems(
  works: Awaited<ReturnType<typeof listWorks>>,
  drawings: Awaited<ReturnType<typeof listDrawings>>,
): AnaArtFeedItem[] {
  const celebrationItems: AnaArtFeedItem[] = works
    .filter(w => w.artForm === "pixel-drawing" && w.state === "PUBLISHED"
      && w.drawPixels && w.drawCanvasW && w.drawCanvasH)
    .map(w => ({
      id:           w.id,
      kind:         "celebration" as const,
      pixels:       w.drawPixels!,
      canvasW:      w.drawCanvasW!,
      canvasH:      w.drawCanvasH!,
      title:        w.title,
      agentTokenId: w.proposedBy,
      agentName:    w.proposedByName,
      publishedAt:  w.publishedAt ?? w.proposedAt,
      cartelText:   w.cartelText,
      brief:        w.brief,
      proposal:     w.proposal,
      memorialKind: w.memorialKind,
      burnedTokenIds: w.burnedTokenIds?.length ? w.burnedTokenIds
        : w.burnedTokenId != null ? [w.burnedTokenId] : undefined,
      totalBurnedHonored: w.memorialTotalBurnedAtMilestone,
      voteResult:   w.voteResult,
      yesCount:     w.yesCount,
      noCount:      w.noCount,
      absCount:     w.absCount,
      revisionCount: w.revisionCount,
      onChainWorkId: w.onChainWorkId,
      txHash:       w.txHash,
      collectionAddress: w.collectionAddress,
    }));

  // Poèmes publiés : l'auteur affiché est le Normie qui a écrit le poème (authorTokenId), pas le proposeur.
  // Formes littéraires : on accepte les noms anglais réellement produits ET les anciens noms français
  const POEM_FORM_V2: Record<string, string> = {
    haiku: "haiku", sonnet: "sonnet", poem: "poem", poeme: "poem", prose: "prose", manifesto: "manifesto", manifeste: "manifesto",
  };
  const poemItems: AnaArtFeedItem[] = works
    .filter(w => w.state === "PUBLISHED" && !!w.artForm && !!POEM_FORM_V2[w.artForm] && !!w.artworkText?.trim())
    .map(w => ({
      id:           `ana-work:${w.id}:poem:r1`,
      schemaVersion: 2 as const,
      sourceId:     w.id,
      revision:     1,
      contentHash:  `sha256:${createHash("sha256").update(`${POEM_FORM_V2[w.artForm!]}:${w.artworkText!.trim().normalize("NFC")}`).digest("hex")}`,
      agentImageUrl: getNormieImageUrl(w.authorTokenId ?? w.proposedBy),
      language:     "und",   // langue non stockée comme donnée autoritative
      kind:         "poem" as const,
      text:         w.artworkText!.trim().normalize("NFC"),
      artForm:      POEM_FORM_V2[w.artForm!],
      title:        w.title,
      agentTokenId: w.authorTokenId ?? w.proposedBy,
      agentName:    w.authorName ?? w.proposedByName,
      publishedAt:  w.publishedAt ?? w.proposedAt,
      cartelText:   w.cartelText,
      brief:        w.brief,
      proposal:     w.proposal,
      voteResult:   w.voteResult,
      yesCount:     w.yesCount,
      noCount:      w.noCount,
      absCount:     w.absCount,
      revisionCount: w.revisionCount,
      onChainWorkId: w.onChainWorkId,
      txHash:       w.txHash,
      collectionAddress: w.collectionAddress,
    }));

  // One content-addressed bundle per published generative source. It may carry
  // a scene, a capture, or both. Keeping kind=generative-capture during the
  // transition is intentional: when a capture exists the deployed PoD parser
  // consumes it and ignores the extra scene field. A scene-only bundle uses
  // kind=generative-scene, which that parser explicitly ignores WITHOUT
  // marking invalid; the upgraded parser handles both forms.
  const generativeCaptureItems: AnaArtFeedItem[] = works.flatMap(w => {
    if (w.state !== "PUBLISHED" || !w.artForm?.startsWith("html-") || !w.artworkText) return [];
    const sourceHash = hashArtworkSource(w.artworkText);
    const captureValid = !!w.podCapturePixels
      && w.podCaptureWidth === 128 && w.podCaptureHeight === 160
      && !!w.podCaptureHash && !!w.podCaptureSourceHash && !!w.podCaptureAt
      && w.podCaptureSourceHash === sourceHash;

    let sceneValidation: ReturnType<typeof validateSceneV1> | null = null;
    if (w.podSceneJson && w.podSceneSourceHash === sourceHash && w.podSceneHash) {
      try {
        sceneValidation = validateSceneV1(JSON.parse(w.podSceneJson));
        if (!sceneValidation.valid || sceneValidation.sceneHash !== w.podSceneHash) sceneValidation = null;
      } catch { sceneValidation = null; }
    }
    const sceneValid = !!sceneValidation?.scene && !!sceneValidation.sceneHash && !!sceneValidation.canonicalJson;
    if (!captureValid && !sceneValid) return [];

    const sceneHash = sceneValid ? sceneValidation!.sceneHash! : "none";
    const captureHash = captureValid ? w.podCaptureHash! : "none";
    const revision = Math.max(1, w.podSceneRevision ?? 1);
    const contentHash = hashGenerativeBundle(w.id, revision, sourceHash, sceneHash, captureHash);
    const hashSuffix = contentHash.slice("sha256:".length);

    const item: AnaArtFeedItem = {
      id:           `ana-work:${w.id}:generative:${hashSuffix}`,
      schemaVersion: 2,
      sourceId:     w.id,
      revision,
      kind:         captureValid ? "generative-capture" : "generative-scene",
      artForm:      w.artForm,
      sourceHash,
      contentHash,
      title:        w.title,
      agentTokenId: w.authorTokenId ?? w.proposedBy,
      agentName:    w.authorName ?? w.proposedByName,
      agentImageUrl: getNormieImageUrl(w.authorTokenId ?? w.proposedBy),
      publishedAt:  w.publishedAt ?? w.proposedAt,
      cartelText:   w.cartelText,
      brief:        w.brief,
      proposal:     w.proposal,
      voteResult:   w.voteResult,
      yesCount:     w.yesCount,
      noCount:      w.noCount,
      absCount:     w.absCount,
      revisionCount: w.revisionCount,
      onChainWorkId: w.onChainWorkId,
      txHash:       w.txHash,
      collectionAddress: w.collectionAddress,
    };
    if (captureValid) item.capture = {
      type: "raw-grayscale",
      pixelEncoding: "gray8",
      pixels: w.podCapturePixels!,
      width: w.podCaptureWidth!,
      height: w.podCaptureHeight!,
      captureHash: w.podCaptureHash!,
      capturedAt: w.podCaptureAt!,
      viewport: { width: w.podCaptureWidth!, height: w.podCaptureHeight! },
      seed: sourceHash,
      timeMs: w.podCaptureTimeMs ?? 0,
      rendererVersion: "ana-browser-capture-v1",
    };
    if (sceneValid) item.scene = {
      schema: "ana-scene-v1",
      encoding: "json",
      manifest: sceneValidation!.scene!,
      sceneHash: sceneValidation!.sceneHash!,
      sourceHash,
      bytes: Buffer.byteLength(canonicalizeSceneV1(sceneValidation!.scene!), "utf8"),
      rendererVersion: 1,
    };
    return [item];
  });

  const spontaneousItems: AnaArtFeedItem[] = drawings
    .filter(d => d.decision === "approved")
    .map(d => ({
      id:           d.id,
      kind:         "spontaneous" as const,
      pixels:       d.pixels,
      canvasW:      d.canvasW,
      canvasH:      d.canvasH,
      title:        `Spontaneous drawing by Normie #${d.submittedBy}`,
      agentTokenId: d.submittedBy,
      publishedAt:  d.decidedAt ?? d.submittedAt,
      decisionNote: d.decisionNote,
    }));

  return [...celebrationItems, ...poemItems, ...generativeCaptureItems, ...spontaneousItems]
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Rebuilds a new immutable snapshot while ANA is already handling the source
 * mutation, then atomically switches the durable pointer and prewarms the
 * shared Data Cache. If construction/persistence fails, revalidation never
 * happens and the last valid snapshot remains served.
 */
export async function rebuildAndPrewarmAnaArtFeed(): Promise<void> {
  const [works, drawings] = await Promise.all([listWorks(), listDrawings()]);
  const items = buildFeedItems(works, drawings).slice(0, FEED_SNAPSHOT_MAX_ITEMS);
  await persistFeedSnapshot(items);
  revalidateTag("ana-art-feed");
  await getCachedFeedItems();
}

/**
 * GET /api/ana-art/feed — read-only feed of human-drawn pixel pieces ready
 * for physical screens: published burn-celebration ANAWorks (artForm
 * "pixel-drawing") and approved SpontaneousDrawing submissions.
 *
 * proof-of-draw is the caller — it pulls this on its own schedule
 * (opportunistically, from opted-in devices' pull cycle, or a manual check)
 * and tracks which ids it has already ingested. This route is stateless: it
 * always returns everything eligible, most recent first, capped by `limit`.
 *
 * The data build itself is cached (see getCachedFeedItems above) -- `limit`
 * is applied AFTER reading from that cache, never passed into it, so every
 * caller (whatever limit it asks for) shares the same cache entry instead of
 * fragmenting it per limit value.
 */
export async function GET(req: NextRequest) {
  if (!FEED_SECRET || req.headers.get("x-feed-secret") !== FEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50")));
  const items = (await getCachedFeedItems()).slice(0, limit);

  return NextResponse.json({ items }, { headers: CACHE_HEADERS });
}
