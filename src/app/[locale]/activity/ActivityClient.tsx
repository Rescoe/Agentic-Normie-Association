"use client";

import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http }          from "viem";
import { base }                              from "viem/chains";
import Image                                 from "next/image";
import { useTranslations } from "next-intl";
import { CONTRACT_ADDRESSES, CONSTITUENT_ASSEMBLY_ABI, ROLE_LABELS, ROLES } from "@/lib/contracts";
import { getNormieImageUrl }                 from "@/lib/normiesApi";
import type { ActivityEvent }                from "@/app/api/activity/events/route";

// ─── Chain client (only for ElectedRolesPanel — 6 small calls) ───────────────

const rpcClient = createPublicClient({
  chain:     base,
  transport: http("https://mainnet.base.org"),
});

// ─── Types ────────────────────────────────────────────────────────────────────

// Re-export so components can use the server type
export type { ActivityEvent };

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { labelKey: string; color: string; icon: string }> = {
  MEMBER_REGISTERED:    { labelKey: "typeMemberRegistered",      color: "text-blue-600 border-blue-200 bg-blue-50/50",      icon: "⬤" },
  ROLE_GRANTED:         { labelKey: "typeRoleGranted",           color: "text-purple-600 border-purple-200 bg-purple-50/50", icon: "★" },
  VOTE_CAST:            { labelKey: "typeVoteCast",              color: "text-yellow-700 border-yellow-200 bg-yellow-50/50", icon: "✓" },
  ROLE_RESOLVED:        { labelKey: "typeRoleResolved",          color: "text-purple-700 border-purple-300 bg-purple-50/70", icon: "✦" },
  ROLES_RESOLVED:       { labelKey: "typeRolesResolved",         color: "text-indigo-600 border-indigo-200 bg-indigo-50/50", icon: "⬛" },
  SESSION_OPENED:       { labelKey: "typeSessionOpened",         color: "text-green-600 border-green-200 bg-green-50/50",   icon: "▶" },
  SESSION_CLOSED:       { labelKey: "typeSessionClosed",         color: "text-gray-600 border-gray-200 bg-gray-50/50",     icon: "■" },
  WORK_PUBLISHED:       { labelKey: "typeWorkPublished",         color: "text-orange-600 border-orange-200 bg-orange-50/50", icon: "◆" },
  WORK_SESSION_INITIATED:{ labelKey: "typeWorkSessionInitiated", color: "text-pink-600 border-pink-200 bg-pink-50/50",     icon: "⬟" },
  WORK_ARCHIVED:        { labelKey: "typeWorkArchived",          color: "text-gray-500 border-gray-200 bg-gray-50/50",     icon: "▣" },
  GC_SCHEDULED:         { labelKey: "typeGcScheduled",           color: "text-teal-600 border-teal-200 bg-teal-50/50",     icon: "◷" },
  GC_TRIGGERED:         { labelKey: "typeGcTriggered",           color:"text-teal-700 border-teal-300 bg-teal-50/70",     icon: "⚡" },
  FACTORY_REGISTERED:   { labelKey: "typeFactoryRegistered",     color:"text-cyan-600 border-cyan-200 bg-cyan-50/50",     icon: "⬡" },
  COLLECTION_CREATED:   { labelKey: "typeCollectionCreated",     color: "text-rose-600 border-rose-200 bg-rose-50/50",     icon: "◈" },
  COLLECTION_INITIALIZED:{ labelKey: "typeCollectionInitialized", color: "text-rose-700 border-rose-300 bg-rose-50/70", icon: "◇" },
  EDITION_MINTED:       { labelKey: "typeEditionMinted",         color: "text-emerald-600 border-emerald-200 bg-emerald-50/50", icon: "$" },
};

const ALL_TYPES = Object.keys(TYPE_CONFIG);

// ─── ActivityRow ─────────────────────────────────────────────────────────────

function ActivityRow({ ev, getName }: { ev: ActivityEvent; getName: (id: number) => string }) {
  const t = useTranslations("activity");
  const cfg = TYPE_CONFIG[ev.type];
  const typeLabel = cfg ? t(cfg.labelKey) : ev.type;
  const color = cfg?.color ?? "text-[--fg-muted] border-[--border]";
  const icon  = cfg?.icon ?? "·";

  // "who" only falls back to a vague mention when the tokenId is genuinely unknown —
  // never invents an actor. addrShort gives something concrete (an address) instead
  // of "?" so there's always a verifiable detail, even for partially-decoded calls.
  const who      = (id?: number) => (id !== undefined && id > 0 ? getName(id) : null);
  const addrShort = (a?: string) => (a && a !== "0x" ? `${a.slice(0, 10)}…` : null);

  const description = (() => {
    switch (ev.type) {
      case "MEMBER_REGISTERED":     return who(ev.tokenId) ? t("descMemberRegistered", { who: who(ev.tokenId) as string }) : t("descMemberRegisteredFallback", { addr: addrShort(ev.address) ?? "?" });
      case "ROLE_GRANTED":          return t("descRoleGranted", { who: who(ev.tokenId) ?? addrShort(ev.address) ?? t("descRoleGrantedFallbackWho"), role: ev.roleLabel ?? ev.role?.slice(0, 10) ?? t("descRoleGrantedFallbackRole") });
      case "VOTE_CAST":             return t("descVoteCast", { voter: who(ev.tokenId) ?? t("descVoteCastFallbackVoter"), candidate: ev.candidateId ? (who(ev.candidateId) as string) : "?", role: ev.roleLabel ?? String(ev.extra?.name ?? t("descRoleGrantedFallbackRole")) });
      case "ROLE_RESOLVED":         return t("descRoleResolved", { role: ev.roleLabel ?? t("descRoleResolvedFallbackRole"), who: who(ev.tokenId) ?? "?", count: String(ev.extra?.voteCount ?? "?") });
      case "ROLES_RESOLVED":        return t("descRolesResolved", { id: ev.sessionId ?? 0 });
      case "SESSION_OPENED":        return t("descSessionOpened", { id: ev.sessionId ?? 0 });
      case "SESSION_CLOSED":        return t("descSessionClosed", { id: ev.sessionId ?? 0 });
      case "WORK_PUBLISHED":        return t("descWorkPublished", { workId: ev.workId ? `#${ev.workId} ` : "", by: who(ev.tokenId) ? t("descWorkPublishedBy", { who: who(ev.tokenId) as string }) : "" });
      case "WORK_SESSION_INITIATED":return t("descWorkSessionInitiated", { id: ev.sessionId ?? 0 });
      case "WORK_ARCHIVED":         return t("descWorkArchived", { id: ev.workId ?? 0 });
      case "GC_SCHEDULED":          return t("descCalendarScheduled", { label: String(ev.extra?.eventTypeLabel ?? t("descEventFallback")) });
      case "GC_TRIGGERED":          return t("descCalendarTriggered", { label: String(ev.extra?.eventTypeLabel ?? t("descEventFallback")) });
      case "FACTORY_REGISTERED":    return t("descFactoryRegistered", { type: String(ev.extra?.factoryType ?? "").slice(0, 10) });
      case "COLLECTION_CREATED": {
        const name = ev.extra?.name ? String(ev.extra.name) : null;
        const actor = who(ev.tokenId);
        const by = actor ? t("descCreatedBy", { who: actor }) : "";
        if (name) return t("descCollectionCreatedNamed", { name, by });
        return t("descCollectionCreatedUnnamed", { addr: addrShort(ev.address) ?? t("descCollectionCreatedUnknownAddr") }) + by;
      }
      case "COLLECTION_INITIALIZED": {
        const title = ev.extra?.name ? String(ev.extra.name) : null;
        const addr  = addrShort(String(ev.extra?.collectionAddress ?? ev.address ?? ""));
        return title
          ? t("descCollectionInitializedTitled", { title, addr: addr ? ` (${addr})` : "" })
          : t("descCollectionInitializedUntitled", { addr: addr ? ` (${addr})` : "" });
      }
      case "EDITION_MINTED": {
        const buyer = addrShort(ev.address);
        const coll  = addrShort(String(ev.extra?.collectionAddress ?? ""));
        return t("descEditionMinted", {
          buyer: buyer ? t("descEditionMintedBy", { buyer }) : "",
          collection: coll ? t("descEditionMintedCollection", { collection: coll }) : "",
        });
      }
      default: {
        const fn = ev.extra?.functionName ?? ev.extra?.contractName;
        return fn ? t("descDefaultContractFn", { contract: String(ev.extra?.contractName ?? t("descDefaultContractFallback")), fn: String(ev.extra?.functionName ?? "?") }) : ev.type;
      }
    }
  })();

  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-4 py-3 border-b border-[--border] last:border-none items-center">
      {/* Badge + avatar */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={`font-mono text-[10px] border px-1.5 py-0.5 shrink-0 ${color}`}>
          {icon} {typeLabel}
        </span>
        {ev.tokenId !== undefined && ev.tokenId > 0 && (
          <div className="relative w-6 h-6 shrink-0 overflow-hidden">
            <Image src={getNormieImageUrl(ev.tokenId)} alt={getName(ev.tokenId)} fill
              className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
          </div>
        )}
      </div>

      {/* Description */}
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{description}</p>
        <p className="font-mono text-[10px] text-[--fg-muted] truncate">
          {t("block", { n: ev.blockNumber })} —{" "}
          <a href={`https://basescan.org/tx/${ev.txHash}`} target="_blank" rel="noopener noreferrer"
            className="hover:underline">{ev.txHash.slice(0, 10)}…</a>
          {ev.address && (
            <>
              {" · "}
              <a href={`https://basescan.org/address/${ev.address}`} target="_blank" rel="noopener noreferrer"
                className="hover:underline" title={t("contractAddressTitle")}>{ev.address.slice(0, 10)}…</a>
            </>
          )}
        </p>
      </div>

      {/* Date */}
      {ev.timestamp ? (
        <p className="font-mono text-[10px] text-[--fg-muted] shrink-0 text-right whitespace-nowrap">
          {new Date(ev.timestamp * 1000).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
        </p>
      ) : (
        <span className="font-mono text-[10px] text-[--fg-muted] shrink-0">—</span>
      )}
    </div>
  );
}

// ─── NormieSummary ────────────────────────────────────────────────────────────

function NormieSummary({ events, getName }: { events: ActivityEvent[]; getName: (id: number) => string }) {
  const t = useTranslations("activity");
  const byNormie: Record<number, number> = {};
  for (const ev of events) {
    if (ev.tokenId && ev.tokenId > 0) byNormie[ev.tokenId] = (byNormie[ev.tokenId] ?? 0) + 1;
  }
  const sorted = Object.entries(byNormie)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (sorted.length === 0) return null;

  return (
    <div className="border border-[--border] p-5 space-y-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("activityByNormie")}</p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {sorted.map(([id, count]) => {
          const name = getName(Number(id));
          return (
            <div key={id} className="text-center space-y-1.5">
              <div className="relative w-12 h-12 mx-auto overflow-hidden">
                <Image src={getNormieImageUrl(Number(id))} alt={name} fill
                  className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
              </div>
              <p className="font-mono text-xs font-bold truncate" title={name}>{name}</p>
              <p className="font-mono text-[10px] text-[--fg-muted]">{count} {t("actions")}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ElectedRolesPanel (reads current state from chain — small, always fresh) ─

const CA_ADDR = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined;

const ROLE_ORDER = [
  { hash: ROLES.PRESIDENT,      labelKey: "statRolePresident",      },
  { hash: ROLES.VICE_PRESIDENT, labelKey: "statRoleVicePresident",  },
  { hash: ROLES.SECRETARY,      labelKey: "statRoleSecretary",      },
  { hash: ROLES.AUTHOR,         labelKey: "statRoleAuthor",         },
  { hash: ROLES.CURATOR,        labelKey: "statRoleCurator",        },
  { hash: ROLES.RAPPORTEUR,     labelKey: "statRoleRapporteur",     },
] as const;

function ElectedRolesPanel() {
  const t = useTranslations("activity");
  const [elected, setElected] = useState<Array<{ tokenId: number; count: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!CA_ADDR) { setLoading(false); return; }
    Promise.all(
      ROLE_ORDER.map(r =>
        rpcClient.readContract({
          address:      CA_ADDR!,
          abi:          CONSTITUENT_ASSEMBLY_ABI,
          functionName: "getLeader",
          args:         [r.hash as `0x${string}`],
        }).then(res => {
          const tuple = res as [bigint, bigint];
          return { tokenId: Number(tuple[0]), count: Number(tuple[1]) };
        }).catch(() => ({ tokenId: 0, count: 0 }))
      )
    ).then(results => { setElected(results); setLoading(false); });
  }, []);

  const hasAny = elected.some(e => e.tokenId > 0);
  if (loading) {
    return (
      <div className="border border-[--border] p-5 animate-pulse">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {ROLE_ORDER.map(r => (
            <div key={r.hash} className="space-y-1">
              <div className="w-12 h-12 bg-[--border] rounded mx-auto" />
              <div className="h-2 bg-[--border] rounded w-16 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!hasAny) return null;

  return (
    <div className="border border-[--border] p-5 space-y-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("electedRolesTitle")}</p>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {ROLE_ORDER.map((r, i) => {
          const e = elected[i];
          if (!e || e.tokenId === 0) {
            return (
              <div key={r.hash} className="text-center space-y-1.5 opacity-40">
                <div className="w-12 h-12 mx-auto border border-dashed border-[--border] flex items-center justify-center">
                  <span className="font-mono text-xs text-[--fg-muted]">—</span>
                </div>
                <p className="font-mono text-[10px] text-[--fg-muted]">{t(r.labelKey)}</p>
              </div>
            );
          }
          return (
            <div key={r.hash} className="text-center space-y-1.5">
              <div className="relative w-12 h-12 mx-auto overflow-hidden ring-2 ring-[--fg]">
                <Image src={getNormieImageUrl(e.tokenId)} alt={`#${e.tokenId}`} fill
                  className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
              </div>
              <p className="font-mono text-xs font-bold">#{e.tokenId}</p>
              <p className="font-mono text-[10px] text-[--fg-muted] leading-tight">{t(r.labelKey)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ events }: { events: ActivityEvent[] }) {
  const t = useTranslations("activity");
  const counts: Record<string, number> = {};
  for (const ev of events) counts[ev.type] = (counts[ev.type] ?? 0) + 1;

  const stats = [
    { key: "MEMBER_REGISTERED",  labelKey: "statMembers",     icon: "⬤" },
    { key: "VOTE_CAST",          labelKey: "statVotes",       icon: "✓" },
    { key: "WORK_PUBLISHED",     labelKey: "statWorks",       icon: "◆" },
    { key: "SESSION_OPENED",     labelKey: "statSessions",    icon: "▶" },
    { key: "GC_TRIGGERED",       labelKey: "statCalendar",    icon: "⚡" },
    { key: "COLLECTION_CREATED", labelKey: "statCollections", icon:"◈" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {stats.map(s => (
        <div key={s.key} className="border border-[--border] bg-[--bg-card] p-3 text-center">
          <p className="font-mono text-2xl font-bold">{counts[s.key] ?? 0}</p>
          <p className="font-mono text-[10px] text-[--fg-muted] mt-1">{s.icon} {t(s.labelKey)}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function ActivityClient() {
  const t = useTranslations("activity");
  const [events,   setEvents]   = useState<ActivityEvent[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<string>("ALL");
  const [nameMap,  setNameMap]  = useState<Map<number, string>>(new Map());
  const [meta,     setMeta]     = useState<{ fromBlock?: string; toBlock?: string; cachedUntil?: number } | null>(null);

  const getName = useCallback((id: number) => nameMap.get(id) ?? `#${id}`, [nameMap]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/activity/events");
      const data = await res.json() as { events: ActivityEvent[]; meta?: typeof meta; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Server error");
        return;
      }
      setEvents(data.events ?? []);
      setMeta(data.meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Batch-resolve Normie names
  useEffect(() => {
    const ids = [...new Set(
      events.flatMap(ev => [ev.tokenId, ev.candidateId].filter((id): id is number => !!id && id > 0))
    )].filter(id => !nameMap.has(id));
    if (!ids.length) return;
    fetch(`/api/normies/persona?tokenIds=${ids.join(",")}`)
      .then(r => r.json())
      .then(d => {
        const resolved: [number, string][] = (d.personas ?? [])
          .filter((p: { name: string }) => p.name && !p.name.startsWith("Normie #"))
          .map((p: { tokenId: number; name: string }) => [p.tokenId, p.name] as [number, string]);
        if (resolved.length) setNameMap(prev => new Map([...prev, ...resolved]));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const filtered = filter === "ALL" ? events : events.filter(e => e.type === filter);

  return (
    // translate="no" — this subtree re-renders on every poll/filter change. Google
    // Translate rewrites text nodes in place; when React then patches the same nodes
    // it can throw "Failed to execute 'removeChild' on 'Node'" (client-side exception).
    // Excluding it from translation avoids the conflict without disabling the widget
    // for the rest of the site.
    <div className="space-y-8 notranslate" translate="no">

      {/* Elected roles — reads getLeader() directly (6 calls, always fresh) */}
      {CA_ADDR && <ElectedRolesPanel />}

      {/* Stats — show skeleton while loading */}
      {loading && events.length === 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="border border-[--border] bg-[--bg-card] p-3 text-center">
              <div className="h-8 bg-[--border] rounded w-8 mx-auto mb-2" />
              <div className="h-2 bg-[--border] rounded w-16 mx-auto" />
            </div>
          ))}
        </div>
      ) : (
        events.length > 0 && <StatsBar events={events} />
      )}

      {/* Normie summary */}
      <NormieSummary events={events} getName={getName} />

      {/* Filter bar — always visible */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter("ALL")}
          className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
            filter === "ALL" ? "bg-[--fg] text-[--bg] border-[--fg]" : "border-[--border] text-[--fg-muted] hover:bg-[--bg-card]"
          }`}
        >
          {t("all", { count: events.length })}
        </button>
        {ALL_TYPES.filter(type => events.some(e => e.type === type)).map(type => (
          <button key={type}
            onClick={() => setFilter(type)}
            className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
              filter === type ? "bg-[--fg] text-[--bg] border-[--fg]" : "border-[--border] text-[--fg-muted] hover:bg-[--bg-card]"
            }`}
          >
            {TYPE_CONFIG[type]?.icon} {t(TYPE_CONFIG[type]?.labelKey ?? "")} ({events.filter(e => e.type === type).length})
          </button>
        ))}
        <button onClick={loadEvents} disabled={loading}
          className="font-mono text-xs px-3 py-1.5 border border-[--border] text-[--fg-muted] hover:bg-[--bg-card] disabled:opacity-40 ml-auto"
        >
          {loading ? t("refreshing") : t("refresh")}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border border-red-300 p-4">
          <p className="font-mono text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Events list */}
      {loading && events.length === 0 ? (
        <div className="border border-[--border]">
          <div className="px-5 py-3 bg-[--bg-card] border-b border-[--border]">
            <p className="font-mono text-xs text-[--fg-muted] animate-pulse">{t("readingOnchainEvents")}</p>
          </div>
          <div className="px-5 divide-y divide-[--border]">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_auto] gap-4 py-3 animate-pulse">
                <div className="h-5 w-24 bg-[--border] rounded" />
                <div className="space-y-1.5">
                  <div className="h-3 bg-[--border] rounded w-48" />
                  <div className="h-2 bg-[--border] rounded w-32" />
                </div>
                <div className="h-2 w-12 bg-[--border] rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-mono text-xs text-[--fg-muted]">{t("noEventsFound")}</p>
        </div>
      ) : (
        <div className="border border-[--border]">
          <div className="px-5 py-3 bg-[--bg-card] border-b border-[--border] flex items-center justify-between gap-4 flex-wrap">
            <p className="font-mono text-xs text-[--fg-muted]">
              {filtered.length > 1 ? t("eventCountPlural", { count: filtered.length }) : t("eventCountSingular", { count: filtered.length })}
              {meta?.fromBlock && ` · ${t("blocksRange", { from: meta.fromBlock, to: meta.toBlock ?? "" })}`}
            </p>
            {meta?.cachedUntil && (
              <p className="font-mono text-[10px] text-[--fg-muted]">
                {t("cachedUntil", { time: new Date(meta.cachedUntil).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) })}
              </p>
            )}
          </div>
          <div className="px-5">
            {filtered.map(ev => <ActivityRow key={ev.id} ev={ev} getName={getName} />)}
          </div>
        </div>
      )}
    </div>
  );
}
