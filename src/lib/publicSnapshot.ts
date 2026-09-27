/**
 * publicSnapshot.ts — the durable public read snapshot.
 *
 * Sept 2026 root-cause finding: even after removing runtime DDL, disabling
 * Neon Auth, and caching individual routes, Neon's compute still never saw 5
 * minutes of real inactivity — because EVERY public GET route independently
 * read Neon (or made its own RPC/external-API calls) on every request.
 * Caching each route separately (cache-aside) still means the FIRST request
 * after any cache expiry, eviction, or redeploy re-hits Neon directly from a
 * visitor's own request — exactly the failure mode this file exists to close
 * off entirely.
 *
 * Model: one JSON snapshot, built ONCE per refresh (inside an orchestrator
 * tick, when Neon is already awake and paying for its own wake-up anyway),
 * stored durably in Vercel Blob (already provisioned on this project --
 * BLOB_READ_WRITE_TOKEN/BLOB_STORE_ID were already in .env.local, unused by
 * any code until this file). Every public GET route reads ONLY this
 * snapshot -- never db.ts/kvGet/kvList/query, never workStore's or
 * salonStore's Neon path, never txLog -- so a visitor (human or bot) can
 * never trigger a Neon query, no matter how the cache/CDN layer behaves.
 *
 * Contract:
 *   - buildPublicSnapshot() reads Neon/RPC/external APIs ONCE per domain and
 *     assembles the full snapshot in memory. Never called from a public
 *     route -- only from refreshPublicSnapshot(), which only the
 *     orchestrator (or a mutation hook running in the same request as a
 *     Neon write) ever calls.
 *   - writePublicSnapshot() uploads the COMPLETE object in one `put()` call
 *     -- there is no partial/incremental write, so a reader never observes a
 *     half-built snapshot.
 *   - refreshPublicSnapshot() builds then writes, wrapped so that if the
 *     build throws, the previous snapshot in Blob storage is left untouched
 *     (we simply never call put()) -- "keep the old one if the new one
 *     fails" falls out of never overwriting until the new object exists.
 *   - readPublicSnapshot() is the ONLY function public routes should call.
 *     Returns null if no snapshot has ever been built, or if Blob storage is
 *     unreachable -- callers must treat null as "no data available" (an
 *     explicit error/503), never silently fall back to reading Neon
 *     themselves.
 */

import { put, head } from "@vercel/blob";
import { listWorks, getSalonWorkOutcomes, type ANAWork } from "@/lib/workStore";
import { listDrawings, type SpontaneousDrawing } from "@/lib/drawStore";
import { listSalons, getSalon, getMemberStats, type Salon, type SalonDetail } from "@/lib/salonStore";
import { readChainStats } from "@/lib/chainReader";
import { buildPersona } from "@/lib/normiesPersona";
import { readCache as readActivityCache, rpc, CORE_CONFIGURED, type ActivityEvent } from "@/lib/activityScanner";
import { listTxLog } from "@/lib/txLog";
import { getHistoryStats, getBurnedTokens, getBurnedTokenImageUrl } from "@/lib/normiesApi";
import { ASSOCIATION_CORE_ABI, ANA_MEMORIALS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";

const SNAPSHOT_PATHNAME = "ana-public-snapshot/v1.json";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SnapshotMember {
  tokenId:            number;
  name:               string;
  imageUrl:           string;
  archetype?:         string | null;
  tagline?:           string | null;
  greeting?:          string | null;
  personalityTraits?: string[] | null;
  communicationStyle?: string | null;
  quirks?:            string[] | null;
  level?:             number;
  actionPoints?:      number;
  description?:       string;
  isRegisteredAgent?: boolean;
  stats: { totalMessages: number; salonsCount: number; lastActive: number | null };
}

export interface SnapshotMemorialItem {
  memorialId:       number;
  workAnaId?:       string;
  title:            string;
  cartelText?:      string;
  artworkText?:     string;
  workState?:       string;
  priceWei:         string;
  publicSupply:     number;
  publicMinted:     number;
  requesterSupply:  number;
  requesterMinted:  number;
  requesterAddr:    string;
  openEnded:        boolean;
  claimDeadline:    number;
  burnedTokenIds:   Array<{ tokenId: number; reservedRecipient: string; reservedClaimed: boolean }>;
}

export interface AnaArtFeedItem {
  id:             string;
  kind:           "celebration" | "spontaneous";
  pixels:         string;
  canvasW:        number;
  canvasH:        number;
  title:          string;
  agentTokenId:   number;
  agentName?:     string;
  publishedAt:    number;
}

export interface PublicSnapshot {
  generatedAt: number;
  status: {
    deployed:        boolean;
    memberCount:     number;
    workCount:       number;
    sessionActive:   boolean;
    sessionDeadline: number;
    sessionPhase:    string;
    activeWorks:     Array<{ id: string; title: string; state: string; isFoundingWork: boolean }>;
    chain:           string;
  };
  works:   ANAWork[];
  members: SnapshotMember[];
  salons: {
    list: Array<Salon & { workOutcome: string | null }>;
    nextSynthesisAt: number;
    nextSynthesisDate: string;
    detail: Record<string, SalonDetail & { workOutcome: string | null }>;
  };
  activity: {
    events: ActivityEvent[];
    meta:   { fromBlock: string; toBlock: string; cachedAt: number } | null;
  };
  memorials: {
    contractAddress: string;
    milestoneStep:   number;
    items:           SnapshotMemorialItem[];
  };
  anaArtFeed:  AnaArtFeedItem[];
  recentBurns: Array<{ tokenId: number; imageUrl: string; burnedAt: string }>;
}

// ─── Per-domain builders (each isolated so one failing domain doesn't take
// down the whole snapshot build — mirrors the fallback behavior each
// original route already had on its own). ──────────────────────────────────

async function buildStatus(): Promise<PublicSnapshot["status"]> {
  try {
    const [stats, activeWorks] = await Promise.all([
      readChainStats(),
      listWorks().then(all => all.filter(w =>
        !["PUBLISHED", "REJECTED"].includes(w.state)
      )).catch(() => [] as ANAWork[]),
    ]);
    const session = stats.sessionState;
    const sessionPhase = !stats.deployed
      ? "pre-launch"
      : session?.resolved ? "roles assigned"
      : session?.active   ? "constituent assembly"
      : "registration";
    return {
      deployed:        stats.deployed,
      memberCount:     stats.memberCount,
      workCount:       stats.workCount,
      sessionActive:   session?.active ?? false,
      sessionDeadline: session?.deadline ?? 0,
      sessionPhase,
      activeWorks: activeWorks.map(w => ({
        id: w.id, title: w.title, state: w.state, isFoundingWork: w.isFoundingWork ?? false,
      })),
      chain: "Base",
    };
  } catch (e) {
    console.error("[publicSnapshot] buildStatus failed:", e);
    return {
      deployed: false, memberCount: 0, workCount: 0, sessionActive: false,
      sessionDeadline: 0, sessionPhase: "pre-launch", activeWorks: [], chain: "Base",
    };
  }
}

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await rpc.readContract({
      address: CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:     ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

async function buildMembers(): Promise<SnapshotMember[]> {
  try {
    const memberIds = await getMemberIds();
    if (memberIds.length === 0) return [];
    const personas = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
    return Promise.all(personas.map(async (result, i) => {
      const tokenId = memberIds[i];
      const stats = await getMemberStats(tokenId).catch(() => ({ totalMessages: 0, salonsCount: 0, lastActive: null }));
      if (result.status === "rejected") {
        return { tokenId, name: `Normie #${tokenId}`, imageUrl: `https://api.normies.art/normies/image/${tokenId}`, stats };
      }
      const p = result.value;
      return {
        tokenId: p.tokenId, name: p.name, imageUrl: p.imageUrl, archetype: p.archetype,
        tagline: p.tagline, greeting: p.greeting, personalityTraits: p.personalityTraits,
        communicationStyle: p.communicationStyle, quirks: p.quirks, level: p.level,
        actionPoints: p.actionPoints, description: p.description,
        isRegisteredAgent: p.isRegisteredAgent, stats,
      };
    }));
  } catch (e) {
    console.error("[publicSnapshot] buildMembers failed:", e);
    return [];
  }
}

function nextMidnightUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
}

async function buildSalons(): Promise<PublicSnapshot["salons"]> {
  try {
    const [salons, outcomes] = await Promise.all([listSalons(), getSalonWorkOutcomes()]);
    const list = salons.map(s => ({ ...s, workOutcome: outcomes[s.id] ?? null }));

    const detailEntries = await Promise.allSettled(
      salons.map(async s => {
        const d = await getSalon(s.id);
        if (!d) return null;
        return [s.id, { ...d, workOutcome: outcomes[s.id] ?? null }] as const;
      }),
    );
    const detail: PublicSnapshot["salons"]["detail"] = {};
    for (const r of detailEntries) {
      if (r.status === "fulfilled" && r.value) detail[r.value[0]] = r.value[1];
    }

    const nextSynthesisAt = nextMidnightUtc();
    return { list, nextSynthesisAt, nextSynthesisDate: new Date(nextSynthesisAt).toISOString(), detail };
  } catch (e) {
    console.error("[publicSnapshot] buildSalons failed:", e);
    const nextSynthesisAt = nextMidnightUtc();
    return { list: [], nextSynthesisAt, nextSynthesisDate: new Date(nextSynthesisAt).toISOString(), detail: {} };
  }
}

async function buildActivity(): Promise<PublicSnapshot["activity"]> {
  if (!CORE_CONFIGURED) return { events: [], meta: null };
  try {
    const cached = await readActivityCache();
    const rows = await listTxLog(200);
    if (!cached && rows.length === 0) return { events: [], meta: null };

    const TX_LOG_TYPE_MAP: Record<string, string> = {
      register: "MEMBER_REGISTERED", vote: "VOTE_CAST", "session-init": "WORK_SESSION_INITIATED",
      publish: "WORK_PUBLISHED", "deploy-collection": "COLLECTION_CREATED", "initialize-collection": "COLLECTION_INITIALIZED",
    };
    const currentAddrs = new Set(Object.values(CONTRACT_ADDRESSES).filter((a): a is string => !!a).map(a => a.toLowerCase()));
    const LAUNCH_FLOOR_BLOCK = 51_800_000n;

    const knownHashes = new Set((cached?.events ?? []).map(e => e.txHash));
    const extra: ActivityEvent[] = rows
      .filter(r => r.status === "confirmed")
      .filter(r => r.block_number !== null && BigInt(r.block_number) >= LAUNCH_FLOOR_BLOCK)
      .filter(r => !r.target_address || currentAddrs.has(r.target_address.toLowerCase()))
      .filter(r => !knownHashes.has(r.tx_hash))
      .map(r => {
        const resultData = (r.result_data ?? {}) as Record<string, unknown>;
        const onChainWorkId = r.type === "publish" && typeof resultData.onChainWorkId === "number" ? resultData.onChainWorkId : undefined;
        return {
          id: `txlog-${r.tx_hash}`, type: TX_LOG_TYPE_MAP[r.type] ?? r.type.toUpperCase(),
          blockNumber: r.block_number != null ? String(r.block_number) : "0", txHash: r.tx_hash,
          timestamp: r.confirmed_at ? Math.floor(new Date(r.confirmed_at).getTime() / 1000) : undefined,
          address: r.target_address ?? r.from_address ?? undefined, tokenId: r.related_token_id ?? undefined,
          workId: onChainWorkId,
          extra: { ...(resultData as Record<string, string | number | boolean>), name: r.label ?? undefined, fromAddress: r.from_address ?? undefined, targetAddress: r.target_address ?? undefined, functionName: r.function_name, contractName: r.contract_name } as Record<string, string | number | boolean>,
        };
      });

    const merged = [...extra, ...(cached?.events ?? [])];
    merged.sort((a, b) => { const diff = BigInt(b.blockNumber) - BigInt(a.blockNumber); return diff > 0n ? 1 : diff < 0n ? -1 : 0; });

    return { events: merged, meta: cached?.meta ?? null };
  } catch (e) {
    console.error("[publicSnapshot] buildActivity failed:", e);
    return { events: [], meta: null };
  }
}

async function buildMemorials(works: ANAWork[]): Promise<PublicSnapshot["memorials"]> {
  const addr = CONTRACT_ADDRESSES.ANAMemorials as `0x${string}`;
  if (!addr) return { contractAddress: "", milestoneStep: 0, items: [] };
  try {
    const [count, milestoneStepRaw] = await Promise.all([
      rpc.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeriesCount" }) as Promise<bigint>,
      rpc.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "MILESTONE_STEP" }) as Promise<bigint>,
    ]);
    const total = Number(count);
    const milestoneStep = Number(milestoneStepRaw);
    if (total === 0) return { contractAddress: addr, milestoneStep, items: [] };

    const settled = await Promise.allSettled(
      Array.from({ length: total }, (_, memorialId) => memorialId).map(async (memorialId): Promise<SnapshotMemorialItem> => {
        const [series, burnedTokenIdsRaw] = await Promise.all([
          rpc.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeries", args: [BigInt(memorialId)] }),
          rpc.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getBurnedTokenIds", args: [BigInt(memorialId)] }) as Promise<readonly bigint[]>,
        ]);
        const burnedTokenIdsSettled = await Promise.allSettled(burnedTokenIdsRaw.map(async tokenIdBn => {
          const tokenId = Number(tokenIdBn);
          const [recipient, claimed] = await Promise.all([
            rpc.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "reservedRecipient", args: [BigInt(memorialId), tokenIdBn] }) as Promise<string>,
            rpc.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "reservedClaimed", args: [BigInt(memorialId), tokenIdBn] }) as Promise<boolean>,
          ]);
          return { tokenId, reservedRecipient: recipient, reservedClaimed: claimed };
        }));
        const burnedTokenIds = burnedTokenIdsSettled
          .filter((r): r is PromiseFulfilledResult<{ tokenId: number; reservedRecipient: string; reservedClaimed: boolean }> => r.status === "fulfilled")
          .map(r => r.value);
        const work = works.find(w => w.onChainMemorialId === memorialId);
        return {
          memorialId, workAnaId: work?.id, title: (series as { title: string }).title,
          cartelText: work?.cartelText, artworkText: work?.artworkText, workState: work?.state,
          priceWei: (series as { priceWei: bigint }).priceWei.toString(),
          publicSupply: Number((series as { publicSupply: bigint }).publicSupply),
          publicMinted: Number((series as { publicMinted: bigint }).publicMinted),
          requesterSupply: Number((series as { requesterSupply: bigint }).requesterSupply),
          requesterMinted: Number((series as { requesterMinted: bigint }).requesterMinted),
          requesterAddr: (series as { requesterAddr: string }).requesterAddr,
          openEnded: (series as { openEnded: boolean }).openEnded,
          claimDeadline: Number((series as { claimDeadline: bigint }).claimDeadline),
          burnedTokenIds,
        };
      }),
    );
    const items = settled
      .filter((r): r is PromiseFulfilledResult<SnapshotMemorialItem> => r.status === "fulfilled")
      .map(r => r.value)
      .reverse();
    return { contractAddress: addr, milestoneStep, items };
  } catch (e) {
    console.error("[publicSnapshot] buildMemorials failed:", e);
    return { contractAddress: addr, milestoneStep: 0, items: [] };
  }
}

function buildAnaArtFeed(works: ANAWork[], drawings: SpontaneousDrawing[]): AnaArtFeedItem[] {
  const celebrationItems: AnaArtFeedItem[] = works
    .filter(w => w.artForm === "pixel-drawing" && w.state === "PUBLISHED" && w.drawPixels && w.drawCanvasW && w.drawCanvasH)
    .map(w => ({
      id: w.id, kind: "celebration" as const, pixels: w.drawPixels!, canvasW: w.drawCanvasW!, canvasH: w.drawCanvasH!,
      title: w.title, agentTokenId: w.proposedBy, agentName: w.proposedByName, publishedAt: w.publishedAt ?? w.proposedAt,
    }));
  const spontaneousItems: AnaArtFeedItem[] = drawings
    .filter(d => d.decision === "approved")
    .map(d => ({
      id: d.id, kind: "spontaneous" as const, pixels: d.pixels, canvasW: d.canvasW, canvasH: d.canvasH,
      title: `Spontaneous drawing by Normie #${d.submittedBy}`, agentTokenId: d.submittedBy, publishedAt: d.decidedAt ?? d.submittedAt,
    }));
  return [...celebrationItems, ...spontaneousItems].sort((a, b) => b.publishedAt - a.publishedAt);
}

async function buildRecentBurns(): Promise<PublicSnapshot["recentBurns"]> {
  try {
    const recent = await getBurnedTokens(24, 0);
    return recent.map(t => ({
      tokenId: Number(t.tokenId),
      imageUrl: getBurnedTokenImageUrl(t.tokenId),
      burnedAt: new Date(Number(t.timestamp) * 1000).toISOString(),
    }));
  } catch (e) {
    console.error("[publicSnapshot] buildRecentBurns failed:", e);
    return [];
  }
}

// ─── Build / write / read ───────────────────────────────────────────────────

export async function buildPublicSnapshot(): Promise<PublicSnapshot> {
  const [status, works, drawings, members, salons, activity, recentBurns] = await Promise.all([
    buildStatus(),
    listWorks().catch(() => [] as ANAWork[]),
    listDrawings().catch(() => [] as SpontaneousDrawing[]),
    buildMembers(),
    buildSalons(),
    buildActivity(),
    buildRecentBurns(),
  ]);
  const memorials = await buildMemorials(works);
  const anaArtFeed = buildAnaArtFeed(works, drawings);

  return { generatedAt: Date.now(), status, works, members, salons, activity, memorials, anaArtFeed, recentBurns };
}

export async function writePublicSnapshot(snapshot: PublicSnapshot): Promise<void> {
  await put(SNAPSHOT_PATHNAME, JSON.stringify(snapshot), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    // Short edge cache on the blob object itself -- readPublicSnapshot()
    // below always does its own `head()` lookup + no-store fetch, so this
    // only bounds how stale a DIRECT fetch of the blob's public URL (e.g.
    // from outside this app) could be. Not load-bearing for correctness.
    cacheControlMaxAge: 60,
  });
}

/**
 * The ONLY function a public route should call. Returns null if no
 * snapshot has ever been built or Blob storage is unreachable -- callers
 * MUST treat null as "no data available" (an explicit error/503), never as
 * license to fall back to reading Neon themselves.
 */
export async function readPublicSnapshot(): Promise<PublicSnapshot | null> {
  try {
    const meta = await head(SNAPSHOT_PATHNAME);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json() as PublicSnapshot;
  } catch {
    return null;
  }
}

/** Builds a fresh snapshot and replaces the stored one. If the build throws,
 * the previous snapshot is left untouched (put() is simply never reached). */
export async function refreshPublicSnapshot(): Promise<{ ok: true; generatedAt: number } | { ok: false; error: string }> {
  try {
    const snapshot = await buildPublicSnapshot();
    await writePublicSnapshot(snapshot);
    return { ok: true, generatedAt: snapshot.generatedAt };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[publicSnapshot] refresh failed, previous snapshot left in place:", error);
    return { ok: false, error };
  }
}
