/**
 * newsMedia.ts — deterministic media/link builders for the newsroom
 * (29/09/2026 extension). Every function here is pure and takes already-
 * fetched, already-verified data (an ANAWork, a tokenId, an on-chain event's
 * fields) — none of it ever comes from LLM output. newsGenerator.ts attaches
 * the result to each NewsFact BEFORE the LLM call, and copies it onto the
 * final ANANewsItem by sourceEventId AFTER — the LLM only ever supplies
 * title/body/socialText text.
 */
import { formatEther } from "viem";
import { getNormieImageUrl, getBurnedTokenImageUrl } from "./normiesApi";
import type { ANAWork } from "./workStore";
import type { NewsLink, NewsMedia } from "./newsStore";

const SITE_ORIGIN = "https://agentic-normie-association.xyz";

// ─── SSRF guard ───────────────────────────────────────────────────────────────

function normiesApiHost(): string {
  try { return new URL(process.env.NORMIES_API_BASE_URL ?? "https://api.normies.art").host; }
  catch { return "api.normies.art"; }
}

/**
 * Whether `url` is safe to place in an <img src> the visual-generation route
 * will fetch server-side. A data: URI is always safe (no network request —
 * the whole image is already inline). An https URL is safe only if its host
 * is explicitly allow-listed; everything else (including http:, other
 * protocols, or an unlisted host) is refused, so a compromised/typo'd or
 * attacker-influenced field can never turn this route into an open fetch
 * proxy. `extraAllowedHosts` lets callers add the site's own origin when
 * relevant (e.g. certificate links), without widening the default.
 */
export function isAllowedMediaHost(url: string, extraAllowedHosts: string[] = []): boolean {
  if (url.startsWith("data:image/")) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return [normiesApiHost(), ...extraAllowedHosts].includes(u.host);
  } catch {
    return false;
  }
}

// ─── Stable fact ids (dedup relies on these being deterministic) ────────────────
//
// generateNews() only ever emits a news item for a fact id it hasn't seen
// before (newsStore.ts's seen-event set) — so "no duplicate news for the
// same event" reduces entirely to "the same real-world event always
// produces the same id, and different events never collide". These are the
// single source of truth for that, so the property is testable without
// mocking the whole collection pipeline.

export const workFactId  = (workId: string, state: string, at: number) => `work:${workId}:${state}:${at}`;
export const chainFactId = (eventId: string) => `chain:${eventId}`;
export const burnFactId  = (txHash: string, tokenId: number) => `burn:${txHash}:${tokenId}`;

// ─── Small formatters ─────────────────────────────────────────────────────────

export function formatPriceEth(priceWei: string | bigint): string {
  try {
    return `${formatEther(typeof priceWei === "bigint" ? priceWei : BigInt(priceWei))} ETH`;
  } catch {
    return "0 ETH";
  }
}

export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * socialText must stand alone on X/Bluesky at <=260 chars, link included.
 * The LLM is asked to respect this itself, but this is the enforced,
 * server-side backstop — never trust the model's own count.
 */
export function buildSocialText(base: string, link: string | undefined, max = 260): string {
  const trimmedBase = base.trim();
  if (!link) return trimmedBase.slice(0, max);
  if (trimmedBase.includes(link)) return trimmedBase.slice(0, max);
  const suffix = ` ${link}`;
  if (suffix.length >= max) return link.slice(0, max); // pathological: link alone is already too long
  return trimmedBase.slice(0, max - suffix.length).trimEnd() + suffix;
}

// ─── Link builders (deterministic URL construction — never LLM-derived) ──────

export const galleryLink = (): NewsLink => ({ kind: "gallery", label: "Read in gallery", url: `${SITE_ORIGIN}/galerie` });
export const certificateLink = (onChainWorkId: number): NewsLink =>
  ({ kind: "certificate", label: "Certificate", url: `${SITE_ORIGIN}/api/works/certificate/${onChainWorkId}` });
export const basescanTxLink = (txHash: string): NewsLink =>
  ({ kind: "basescan_tx", label: "Basescan transaction", url: `https://basescan.org/tx/${txHash}` });
export const basescanAddressLink = (address: string): NewsLink =>
  ({ kind: "basescan_address", label: "Basescan collection", url: `https://basescan.org/address/${address}` });
export const etherscanTxLink = (txHash: string): NewsLink =>
  ({ kind: "etherscan_tx", label: "Ethereum burn transaction", url: `https://etherscan.io/tx/${txHash}` });
export const openSeaCollectionLink = (collectionAddress: string): NewsLink =>
  ({ kind: "opensea_collection", label: "OpenSea collection", url: `https://opensea.io/assets/base/${collectionAddress}` });
export const openSeaAssetLink = (collectionAddress: string, tokenId: number): NewsLink =>
  ({ kind: "opensea_asset", label: "OpenSea edition", url: `https://opensea.io/assets/base/${collectionAddress}/${tokenId}` });

// ─── Media/link builders per event category ───────────────────────────────────

export const institutionalMedia = (alt = "ANA — Agentic Normie Association"): NewsMedia => ({ kind: "institutional", alt });

/**
 * A published work's media: the actual artwork when it's a safe raster image
 * (pixel-drawing memorials store a BMP data URI in artworkText), a
 * typographic card built from a real excerpt for text works (rendered by the
 * visual route itself — media just flags the intent and carries the
 * excerpt), or an explicit "artwork card" (never claimed to be a real
 * screenshot) for generative HTML with no safe capture.
 */
export function mediaForWork(work: Pick<ANAWork, "id" | "title" | "artForm" | "artworkText" | "authorName">): NewsMedia {
  const isDataImage = !!work.artworkText && /^data:image\//.test(work.artworkText);
  if (isDataImage) {
    return { kind: "artwork", sourceUrl: work.artworkText, alt: `"${work.title}" — on-chain artwork`, workId: work.id };
  }
  // Text works (haiku/poem/prose/manifesto/sonnet) or generative HTML with no
  // safe capture both fall back to a server-rendered artwork card — the
  // visual route reads title/artForm/authorName straight off the news item's
  // stored media fields, never fabricating a screenshot.
  return { kind: "artwork", alt: `"${work.title}" (${work.artForm ?? "text"}) by ${work.authorName ?? "an ANA Author"}`, workId: work.id };
}

export function linksForWork(work: Pick<ANAWork, "onChainWorkId" | "txHash" | "collectionAddress">): NewsLink[] {
  const links: NewsLink[] = [galleryLink()];
  if (work.onChainWorkId != null) links.push(certificateLink(work.onChainWorkId));
  if (work.txHash) links.push(basescanTxLink(work.txHash));
  if (work.collectionAddress) {
    links.push(basescanAddressLink(work.collectionAddress));
    links.push(openSeaCollectionLink(work.collectionAddress));
  }
  return links;
}

export function mediaForNormie(tokenId: number, alt: string): NewsMedia {
  return { kind: "normie", sourceUrl: getNormieImageUrl(tokenId), alt, tokenId };
}

/**
 * Burn coverage. If a matching ANA memorial already exists (published), use
 * its own image + gallery/collection links — otherwise the burned Normie's
 * own last-known portrait and ONLY the Ethereum burn transaction. Never
 * claims a memorial exists when it doesn't (spec requirement).
 */
export function mediaForBurn(tokenId: number, memorial?: Pick<ANAWork, "id" | "title" | "artworkText"> | null): NewsMedia {
  if (memorial?.artworkText && /^data:image\//.test(memorial.artworkText)) {
    return { kind: "memorial", sourceUrl: memorial.artworkText, alt: `Memorial for Normie #${tokenId} — "${memorial.title}"`, workId: memorial.id, tokenId };
  }
  return { kind: "normie", sourceUrl: getBurnedTokenImageUrl(tokenId), alt: `Normie #${tokenId} (burned)`, tokenId };
}

export function linksForBurn(
  txHash: string,
  memorial?: Pick<ANAWork, "onChainWorkId" | "collectionAddress"> | null,
): NewsLink[] {
  const links: NewsLink[] = [etherscanTxLink(txHash)];
  if (memorial) {
    links.push(galleryLink());
    if (memorial.onChainWorkId != null) links.push(certificateLink(memorial.onChainWorkId));
    if (memorial.collectionAddress) {
      links.push(basescanAddressLink(memorial.collectionAddress));
      links.push(openSeaCollectionLink(memorial.collectionAddress));
    }
  }
  return links;
}

/** Clamps an arbitrary/absent ?limit= to a sane, bounded range for GET
 * /api/news. Pure — kept out of route.ts because Next's typed-routes checker
 * rejects any export from a route file other than the recognized
 * HTTP-method/config ones. */
export function clampNewsLimit(raw: string | null): number {
  if (!raw) return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(n)));
}

// ─── Visual (visual.png route) props ──────────────────────────────────────────

export interface VisualProps {
  title:      string;
  eventLabel: string;
  dateLabel:  string;
  authorLine: string;
  imageUrl:   string | null; // null => the route renders the institutional/text-only card
  alt:        string;
}

/**
 * Pure derivation of everything the /api/news/{id}/visual.png route needs to
 * render — split out from the route itself so the "which image is safe to
 * fetch" decision (the actual security-relevant part) is unit-testable
 * without invoking next/og's ImageResponse (which needs a real render
 * pipeline, not something vitest exercises).
 */
export function buildVisualProps(item: {
  title: string; eventType: string; eventAt: number; authorName: string; authorTokenId: number; media?: NewsMedia;
}): VisualProps {
  const rawUrl = item.media?.sourceUrl;
  const imageUrl = rawUrl && isAllowedMediaHost(rawUrl) ? rawUrl : null;
  return {
    title:      item.title,
    eventLabel: item.eventType.replace(/_/g, " "),
    dateLabel:  new Date(item.eventAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }),
    authorLine: `${item.authorName} #${item.authorTokenId} · ELECTED RAPPORTEUR`,
    imageUrl,
    alt: item.media?.alt ?? item.title,
  };
}

/** Canonical visual URL for an item, even one saved before `visualPath`
 * existed — NewsFeed.tsx's "Download visual" button and any future social
 * automation should both go through this, never re-derive it themselves. */
export function visualUrl(item: { id: string; visualPath?: string }): string {
  return item.visualPath ?? `/api/news/${item.id}/visual.png`;
}

export function linksForEditionMinted(params: {
  collectionAddress: string; editionTokenId: number; txHash: string;
  work?: Pick<ANAWork, "onChainWorkId"> | null;
}): NewsLink[] {
  const links: NewsLink[] = [
    basescanTxLink(params.txHash),
    basescanAddressLink(params.collectionAddress),
    openSeaAssetLink(params.collectionAddress, params.editionTokenId),
  ];
  if (params.work?.onChainWorkId != null) links.push(certificateLink(params.work.onChainWorkId));
  return links;
}
