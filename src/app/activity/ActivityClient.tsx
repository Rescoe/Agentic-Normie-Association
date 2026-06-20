"use client";

import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http }          from "viem";
import { base }                              from "viem/chains";
import Image                                 from "next/image";
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

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  MEMBER_REGISTERED:    { label: "Inscription",       color: "text-blue-600 border-blue-200 bg-blue-50/50",      icon: "⬤" },
  ROLE_GRANTED:         { label: "Rôle attribué",     color: "text-purple-600 border-purple-200 bg-purple-50/50", icon: "★" },
  VOTE_CAST:            { label: "Vote",              color: "text-yellow-700 border-yellow-200 bg-yellow-50/50", icon: "✓" },
  ROLE_RESOLVED:        { label: "Rôle résolu",       color: "text-purple-700 border-purple-300 bg-purple-50/70", icon: "✦" },
  ROLES_RESOLVED:       { label: "Élection clôturée", color: "text-indigo-600 border-indigo-200 bg-indigo-50/50", icon: "⬛" },
  SESSION_OPENED:       { label: "Session ouverte",   color: "text-green-600 border-green-200 bg-green-50/50",   icon: "▶" },
  SESSION_CLOSED:       { label: "Session clôturée",  color: "text-gray-600 border-gray-200 bg-gray-50/50",     icon: "■" },
  WORK_PUBLISHED:       { label: "Œuvre publiée",     color: "text-orange-600 border-orange-200 bg-orange-50/50", icon: "◆" },
  WORK_SESSION_INITIATED:{ label: "Session créative", color: "text-pink-600 border-pink-200 bg-pink-50/50",     icon: "⬟" },
  WORK_ARCHIVED:        { label: "Œuvre archivée",    color: "text-gray-500 border-gray-200 bg-gray-50/50",     icon: "▣" },
  GC_SCHEDULED:         { label: "Événement planifié",color: "text-teal-600 border-teal-200 bg-teal-50/50",     icon: "◷" },
  GC_TRIGGERED:         { label: "Événement déclenché",color:"text-teal-700 border-teal-300 bg-teal-50/70",     icon: "⚡" },
  FACTORY_REGISTERED:   { label: "Factory enregistrée",color:"text-cyan-600 border-cyan-200 bg-cyan-50/50",     icon: "⬡" },
  COLLECTION_CREATED:   { label: "Collection créée",  color: "text-rose-600 border-rose-200 bg-rose-50/50",     icon: "◈" },
  COLLECTION_INITIALIZED:{ label: "Collection initialisée", color: "text-rose-700 border-rose-300 bg-rose-50/70", icon: "◇" },
};

const ALL_TYPES = Object.keys(TYPE_CONFIG);

// ─── ActivityRow ─────────────────────────────────────────────────────────────

function ActivityRow({ ev, getName }: { ev: ActivityEvent; getName: (id: number) => string }) {
  const cfg = TYPE_CONFIG[ev.type] ?? { label: ev.type, color: "text-[--fg-muted] border-[--border]", icon: "·" };

  const description = (() => {
    switch (ev.type) {
      case "MEMBER_REGISTERED":     return `${getName(ev.tokenId!)} inscrit`;
      case "ROLE_GRANTED":          return `${getName(ev.tokenId!)} → ${ev.roleLabel ?? ev.role?.slice(0, 10) ?? "rôle"}`;
      case "VOTE_CAST":             return `${getName(ev.tokenId!)} vote pour ${getName(ev.candidateId!)} (${ev.roleLabel ?? "rôle"})`;
      case "ROLE_RESOLVED":         return `${ev.roleLabel ?? "Rôle"} → ${getName(ev.tokenId!)} (${ev.extra?.voteCount ?? "?"} votes)`;
      case "ROLES_RESOLVED":        return `Session #${ev.sessionId} — rôles finalisés`;
      case "SESSION_OPENED":        return `Session #${ev.sessionId} ouverte`;
      case "SESSION_CLOSED":        return `Session #${ev.sessionId} clôturée`;
      case "WORK_PUBLISHED":        return `Œuvre #${ev.workId} publiée par ${getName(ev.tokenId!)}`;
      case "WORK_SESSION_INITIATED":return `Session créative #${ev.sessionId} lancée`;
      case "WORK_ARCHIVED":         return `Œuvre #${ev.workId} archivée`;
      case "GC_SCHEDULED":          return `Calendrier : ${ev.extra?.eventTypeLabel ?? "événement"} planifié`;
      case "GC_TRIGGERED":          return `Calendrier : ${ev.extra?.eventTypeLabel ?? "événement"} déclenché`;
      case "FACTORY_REGISTERED":    return `Factory enregistrée (${String(ev.extra?.factoryType ?? "").slice(0, 10)}…)`;
      case "COLLECTION_CREATED":    return `Collection "${ev.extra?.name ?? "?"}" créée par ${getName(ev.tokenId!)}`;
      case "COLLECTION_INITIALIZED":return `Œuvre liée à sa collection (${String(ev.extra?.collectionAddress ?? "").slice(0, 10)}…)`;
      default:                      return ev.type;
    }
  })();

  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-4 py-3 border-b border-[--border] last:border-none items-center">
      {/* Badge + avatar */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={`font-mono text-[10px] border px-1.5 py-0.5 shrink-0 ${cfg.color}`}>
          {cfg.icon} {cfg.label}
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
          bloc {ev.blockNumber} —{" "}
          <a href={`https://basescan.org/tx/${ev.txHash}`} target="_blank" rel="noopener noreferrer"
            className="hover:underline">{ev.txHash.slice(0, 10)}…</a>
        </p>
      </div>

      {/* Date */}
      {ev.timestamp ? (
        <p className="font-mono text-[10px] text-[--fg-muted] shrink-0 text-right whitespace-nowrap">
          {new Date(ev.timestamp * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </p>
      ) : (
        <span className="font-mono text-[10px] text-[--fg-muted] shrink-0">—</span>
      )}
    </div>
  );
}

// ─── NormieSummary ────────────────────────────────────────────────────────────

function NormieSummary({ events, getName }: { events: ActivityEvent[]; getName: (id: number) => string }) {
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
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Activité par Normie</p>
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
              <p className="font-mono text-[10px] text-[--fg-muted]">{count} actions</p>
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
  { hash: ROLES.PRESIDENT,      label: "Président",                  },
  { hash: ROLES.VICE_PRESIDENT, label: "Vice-Président / Trésorier", },
  { hash: ROLES.SECRETARY,      label: "Secrétaire",                 },
  { hash: ROLES.AUTHOR,         label: "Auteur",                     },
  { hash: ROLES.CURATOR,        label: "Curateur",                   },
  { hash: ROLES.RAPPORTEUR,     label: "Rapporteur",                 },
] as const;

function ElectedRolesPanel() {
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
          const t = res as [bigint, bigint];
          return { tokenId: Number(t[0]), count: Number(t[1]) };
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
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Élus actuels</p>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {ROLE_ORDER.map((r, i) => {
          const e = elected[i];
          if (!e || e.tokenId === 0) {
            return (
              <div key={r.hash} className="text-center space-y-1.5 opacity-40">
                <div className="w-12 h-12 mx-auto border border-dashed border-[--border] flex items-center justify-center">
                  <span className="font-mono text-xs text-[--fg-muted]">—</span>
                </div>
                <p className="font-mono text-[10px] text-[--fg-muted]">{r.label}</p>
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
              <p className="font-mono text-[10px] text-[--fg-muted] leading-tight">{r.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ events }: { events: ActivityEvent[] }) {
  const counts: Record<string, number> = {};
  for (const ev of events) counts[ev.type] = (counts[ev.type] ?? 0) + 1;

  const stats = [
    { key: "MEMBER_REGISTERED",  label: "Membres",   icon: "⬤" },
    { key: "VOTE_CAST",          label: "Votes",     icon: "✓" },
    { key: "WORK_PUBLISHED",     label: "Œuvres",    icon: "◆" },
    { key: "SESSION_OPENED",     label: "Sessions",  icon: "▶" },
    { key: "GC_TRIGGERED",       label: "Calendrier",icon: "⚡" },
    { key: "COLLECTION_CREATED", label: "Collections",icon:"◈" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {stats.map(s => (
        <div key={s.key} className="border border-[--border] bg-[--bg-card] p-3 text-center">
          <p className="font-mono text-2xl font-bold">{counts[s.key] ?? 0}</p>
          <p className="font-mono text-[10px] text-[--fg-muted] mt-1">{s.icon} {s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function ActivityClient() {
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
        setError(data.error ?? "Erreur serveur");
        return;
      }
      setEvents(data.events ?? []);
      setMeta(data.meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
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
    <div className="space-y-8">

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
          Tout ({events.length})
        </button>
        {ALL_TYPES.filter(t => events.some(e => e.type === t)).map(t => (
          <button key={t}
            onClick={() => setFilter(t)}
            className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
              filter === t ? "bg-[--fg] text-[--bg] border-[--fg]" : "border-[--border] text-[--fg-muted] hover:bg-[--bg-card]"
            }`}
          >
            {TYPE_CONFIG[t]?.icon} {TYPE_CONFIG[t]?.label} ({events.filter(e => e.type === t).length})
          </button>
        ))}
        <button onClick={loadEvents} disabled={loading}
          className="font-mono text-xs px-3 py-1.5 border border-[--border] text-[--fg-muted] hover:bg-[--bg-card] disabled:opacity-40 ml-auto"
        >
          {loading ? "Chargement…" : "↻ Actualiser"}
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
            <p className="font-mono text-xs text-[--fg-muted] animate-pulse">Lecture des événements on-chain…</p>
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
          <p className="font-mono text-xs text-[--fg-muted]">Aucun événement trouvé.</p>
        </div>
      ) : (
        <div className="border border-[--border]">
          <div className="px-5 py-3 bg-[--bg-card] border-b border-[--border] flex items-center justify-between gap-4 flex-wrap">
            <p className="font-mono text-xs text-[--fg-muted]">
              {filtered.length} événement{filtered.length > 1 ? "s" : ""}
              {meta?.fromBlock && ` · blocs ${meta.fromBlock}–${meta.toBlock}`}
            </p>
            {meta?.cachedUntil && (
              <p className="font-mono text-[10px] text-[--fg-muted]">
                Cache jusqu'à {new Date(meta.cachedUntil).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
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
