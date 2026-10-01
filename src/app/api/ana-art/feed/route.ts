export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getNormieImageUrl } from "@/lib/normiesApi";
import { unstable_cache } from "next/cache";
import { listWorks } from "@/lib/workStore";
import { listDrawings } from "@/lib/drawStore";

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
const getCachedFeedItems = unstable_cache(
  async (): Promise<AnaArtFeedItem[]> => {
    const [works, drawings] = await Promise.all([listWorks(), listDrawings()]);
    return buildFeedItems(works, drawings);
  },
  ["ana-art-feed-v3"],   // v3 : items "poem" ajoutés (le cache v2 ne les connaît pas)
  { revalidate: 1800, tags: ["ana-art-feed"] },
);

const CACHE_HEADERS = { "Cache-Control": "private, no-store" };

export interface AnaArtFeedItem {
  id:             string;
  kind:           "celebration" | "spontaneous" | "poem";
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

function buildFeedItems(
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
  const POEM_FORMS = new Set(["haiku", "sonnet", "poeme", "prose", "manifeste"]);
  const POEM_FORM_V2: Record<string, string> = { haiku: "haiku", sonnet: "sonnet", poeme: "poem", prose: "prose", manifeste: "manifesto" };
  const guessLanguage = (t: string) => (/[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|et|une?|dans|sur)\b/i.test(t) ? "fr" : "en");
  const poemItems: AnaArtFeedItem[] = works
    .filter(w => w.state === "PUBLISHED" && !!w.artForm && POEM_FORMS.has(w.artForm) && !!w.artworkText?.trim())
    .map(w => ({
      id:           `ana-work:${w.id}:poem:r1`,
      schemaVersion: 2 as const,
      sourceId:     w.id,
      revision:     1,
      contentHash:  `sha256:${createHash("sha256").update(w.artworkText!).digest("hex")}`,
      agentImageUrl: getNormieImageUrl(w.authorTokenId ?? w.proposedBy),
      language:     guessLanguage(w.artworkText!),
      kind:         "poem" as const,
      text:         w.artworkText!,
      artForm:      POEM_FORM_V2[w.artForm!] ?? "poem",
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

  return [...celebrationItems, ...poemItems, ...spontaneousItems].sort((a, b) => b.publishedAt - a.publishedAt);
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
