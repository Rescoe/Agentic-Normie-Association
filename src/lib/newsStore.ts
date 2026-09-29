import fs from "fs";
import path from "path";
import { kvGet, kvListByPrefix, kvSet, USE_NEON } from "./db";

// Additive, backward-compatible fields (29/09/2026 newsroom extension) — a
// Neon row saved before these fields existed simply has them undefined, and
// every reader (NewsFeed.tsx, /api/news, the visual route) already treats
// undefined media/links as "show the institutional fallback" / "no extra
// buttons", so old rows keep loading exactly as before.
//
// The LLM (newsGenerator.ts) only ever writes title/body/socialText — it
// NEVER constructs a NewsLink/NewsMedia itself. Every url/tokenId/address/
// price here is attached server-side from real ANAWork/on-chain/normies.art
// data, keyed by sourceEventId, after the LLM call returns.
export type NewsLinkKind =
  | "news" | "source" | "gallery" | "certificate" | "basescan_tx" | "basescan_address"
  | "etherscan_tx" | "opensea_collection" | "opensea_asset";

export interface NewsLink {
  kind:  NewsLinkKind;
  label: string;
  url:   string;
}

export type NewsMediaKind = "artwork" | "normie" | "memorial" | "institutional";

export interface NewsMedia {
  kind:               NewsMediaKind;
  /** Absolute https URL (allow-listed host only) or a data: URI. Absent for
   * a pure "institutional" card (text-only, no external image). */
  sourceUrl?:         string;
  alt:                string;
  workId?:            string;
  tokenId?:           number;
  collectionAddress?: string;
}

export interface ANANewsItem {
  id: string;
  sourceEventId: string;
  eventType: string;
  title: string;
  body: string;
  socialText: string;
  /** Legacy single link — first entry of `links` when present, kept so any
   * reader written before `links` existed still gets a working link. */
  link?: string;
  eventAt: number;
  publishedAt: number;
  authorTokenId: number;
  authorName: string;
  authorRole: "Rapporteur";
  media?: NewsMedia;
  links?: NewsLink[];
  /** Canonical path for the stable server-rendered social image — always
   * `/api/news/{id}/visual.png`, stored rather than just computed from `id`
   * so a future storage/routing change can't silently break old items. */
  visualPath?: string;
  schemaVersion?: 2;
}

const PREFIX = "news:item:";
const SEEN_KEY = "news:seen-events";
const LOCAL_FILE = path.join(process.cwd(), ".ana-news.json");

function readLocal(): ANANewsItem[] {
  try { return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8")) as ANANewsItem[]; }
  catch { return []; }
}

/** Direct single-item lookup — used by the visual-generation route, which
 * only ever needs one item and shouldn't pay for listing everything. */
export async function getNewsItem(id: string): Promise<ANANewsItem | null> {
  if (USE_NEON) {
    const raw = await kvGet(PREFIX + id);
    if (!raw) return null;
    try { return JSON.parse(raw) as ANANewsItem; } catch { return null; }
  }
  return readLocal().find(item => item.id === id) ?? null;
}

export async function listNews(limit = 50): Promise<ANANewsItem[]> {
  const items = USE_NEON
    ? (await kvListByPrefix(PREFIX)).flatMap(row => {
        try { return [JSON.parse(row.value) as ANANewsItem]; } catch { return []; }
      })
    : readLocal();
  return items.sort((a, b) => b.eventAt - a.eventAt).slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function saveNews(items: ANANewsItem[]): Promise<void> {
  if (!items.length) return;
  if (USE_NEON) {
    await Promise.all(items.map(item => kvSet(PREFIX + item.id, JSON.stringify(item))));
    return;
  }
  const existing = readLocal();
  const byId = new Map(existing.map(item => [item.id, item]));
  for (const item of items) byId.set(item.id, item);
  fs.writeFileSync(LOCAL_FILE, JSON.stringify([...byId.values()], null, 2));
}

export async function getSeenNewsEventIds(): Promise<Set<string>> {
  if (!USE_NEON) return new Set(readLocal().map(item => item.sourceEventId));
  const raw = await kvGet(SEEN_KEY);
  try { return new Set(JSON.parse(raw ?? "[]") as string[]); } catch { return new Set(); }
}

export async function markNewsEventsSeen(ids: string[]): Promise<void> {
  if (!ids.length || !USE_NEON) return;
  const seen = await getSeenNewsEventIds();
  for (const id of ids) seen.add(id);
  // A bounded cursor is enough: only recent activity is ever considered.
  await kvSet(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
}

/**
 * Saves items, then marks their source events seen — in that order, with no
 * error suppression in between, so a save failure (Neon hiccup, etc.) always
 * propagates and the events stay retryable on the next run instead of being
 * silently marked "handled" for content that never actually got persisted.
 * Dependency-injectable purely so tests/newsGenerator.test.ts can assert
 * this ordering without mocking Neon.
 */
export async function persistNewsItems(
  items: ANANewsItem[],
  deps: { saveNews: typeof saveNews; markSeen: typeof markNewsEventsSeen } = { saveNews, markSeen: markNewsEventsSeen },
): Promise<void> {
  await deps.saveNews(items);
  await deps.markSeen(items.map(item => item.sourceEventId));
}

const BASELINE_PREFIX = "news:baseline:";

/**
 * One-time "don't flood the feed with history" gate for a fact CATEGORY
 * (e.g. "burn", "mint") the first time that category is ever collected —
 * distinct from the existing global seen.size===0 bootstrap, which only
 * fires once for the whole feed and would otherwise treat every burn/mint
 * ANA has ever seen as "new" the moment this category starts being
 * collected (29/09/2026 newsroom extension: adding EDITION_MINTED/burn
 * coverage to a feed that may already have other categories marked seen).
 *
 * `pendingIdsNewestFirst` must already be sorted newest-first (collectFacts()
 * guarantees this). Returns the ids that were just baselined (marked seen
 * without producing a news item) — callers exclude them from this run's
 * candidate pool. A no-op (returns []) once the category's baseline marker
 * is set, or outside Neon (local dev has no persistent seen-set anyway).
 */
export async function ensureCategoryBaseline(
  category: string, pendingIdsNewestFirst: string[], keepRecent: number,
): Promise<string[]> {
  if (!USE_NEON) return [];
  const marker = BASELINE_PREFIX + category;
  const already = await kvGet(marker);
  if (already) return [];
  const toBaseline = pendingIdsNewestFirst.slice(keepRecent);
  if (toBaseline.length) await markNewsEventsSeen(toBaseline);
  await kvSet(marker, String(Date.now()));
  return toBaseline;
}
