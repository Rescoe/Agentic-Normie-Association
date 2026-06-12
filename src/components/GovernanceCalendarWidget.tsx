"use client";

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { useState, useEffect } from "react";
import { keccak256, stringToBytes } from "viem";
import { GOVERNANCE_CALENDAR_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

const CAL_ADDR  = CONTRACT_ADDRESSES.GovernanceCalendar as `0x${string}`;
const deployed  = !!CONTRACT_ADDRESSES.GovernanceCalendar;

// Mirror of contract constants
const EVENT_TYPES: Record<string, { label: string; color: string }> = {
  [keccak256(stringToBytes("INSCRIPTION_OPEN"))]:  { label: "Inscriptions",      color: "bg-blue-100 text-blue-700 border-blue-200" },
  [keccak256(stringToBytes("INSCRIPTION_CLOSE"))]: { label: "Clôture inscriptions", color: "bg-orange-100 text-orange-700 border-orange-200" },
  [keccak256(stringToBytes("ELECTION"))]:          { label: "Élection",          color: "bg-purple-100 text-purple-700 border-purple-200" },
  [keccak256(stringToBytes("GENERAL_ASSEMBLY"))]:  { label: "Assemblée générale", color: "bg-green-100 text-green-700 border-green-200" },
  [keccak256(stringToBytes("WORK_SESSION"))]:      { label: "Session de création", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  [keccak256(stringToBytes("BURN_CREATION"))]:     { label: "Création burn",      color: "bg-red-100 text-red-700 border-red-200" },
};

interface CalendarEvent {
  id:              bigint;
  eventType:       `0x${string}`;
  description:     string;
  scheduledAt:     bigint;
  durationSeconds: bigint;
  executed:        boolean;
  recurring:       boolean;
  periodSeconds:   bigint;
  cancelled:       boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function formatTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZoneName: "short"
  });
}

function formatCountdown(ts: bigint): string {
  const diff = Number(ts) - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Dû maintenant";
  const days    = Math.floor(diff / 86400);
  const hours   = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return `dans ${days}j ${hours}h`;
  if (hours > 0) return `dans ${hours}h ${minutes}min`;
  return `dans ${minutes}min`;
}

function formatPeriod(secs: bigint): string {
  const s = Number(secs);
  if (s === 0) return "Unique";
  if (s % (90 * 86400) === 0) return `Tous les ${s / (90 * 86400) * 90}j`;
  if (s % (30 * 86400) === 0) return `Tous les ${s / (30 * 86400) * 30}j`;
  if (s % 86400 === 0) return `Tous les ${s / 86400}j`;
  return `Toutes les ${Math.round(s / 3600)}h`;
}

// ─── EventRow ─────────────────────────────────────────────────────────────────

function EventRow({
  ev,
  isOwner,
  onTrigger,
}: {
  ev: CalendarEvent;
  isOwner: boolean;
  onTrigger: (id: bigint) => void;
}) {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const isDue    = now >= Number(ev.scheduledAt);
  const isPast   = ev.executed;
  const typeInfo = EVENT_TYPES[ev.eventType] ?? { label: "Événement", color: "bg-[--bg-card] text-[--fg-muted] border-[--border]" };

  return (
    <div className={`grid grid-cols-[1fr_auto] gap-4 py-4 border-b border-[--border] last:border-none items-start ${isPast ? "opacity-50" : ""}`}>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-xs border px-2 py-0.5 shrink-0 ${typeInfo.color}`}>
            {typeInfo.label}
          </span>
          {ev.recurring && (
            <span className="font-mono text-xs text-[--fg-muted]">↻ {formatPeriod(ev.periodSeconds)}</span>
          )}
          {isPast && <span className="font-mono text-xs text-green-600">✓</span>}
        </div>
        <p className="font-bold text-sm">{ev.description || typeInfo.label}</p>
        <div className="flex items-center gap-4 flex-wrap">
          <p className="font-mono text-xs text-[--fg-muted]">
            {formatDate(ev.scheduledAt)} — {formatTime(ev.scheduledAt)}
          </p>
          {!isPast && (
            <p className={`font-mono text-xs ${isDue ? "text-orange-600 font-bold" : "text-[--fg-muted]"}`}>
              {formatCountdown(ev.scheduledAt)}
            </p>
          )}
          {ev.durationSeconds > 0n && (
            <p className="font-mono text-xs text-[--fg-muted]">
              Durée : {Number(ev.durationSeconds) >= 86400
                ? `${Number(ev.durationSeconds) / 86400}j`
                : `${Number(ev.durationSeconds) / 3600}h`}
            </p>
          )}
        </div>
      </div>

      {/* Trigger button */}
      {!isPast && (isDue || isOwner) && (
        <button
          onClick={() => onTrigger(ev.id)}
          className={`font-mono text-xs px-3 py-1.5 border shrink-0 ${
            isDue
              ? "bg-[--fg] text-[--bg] border-[--fg] hover:opacity-80"
              : "border-[--border] text-[--fg-muted] hover:bg-[--bg-card]"
          }`}
        >
          {isDue ? "Déclencher →" : "Forcer (admin)"}
        </button>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function GovernanceCalendarWidget() {
  const { address } = useAccount();

  const { data: eventsRaw, refetch } = useReadContract({
    address:      CAL_ADDR,
    abi:          GOVERNANCE_CALENDAR_ABI,
    functionName: "getUpcomingEvents",
    query: { enabled: deployed, refetchInterval: 30_000 },
  });

  const { data: ownerRaw } = useReadContract({
    address: CAL_ADDR, abi: GOVERNANCE_CALENDAR_ABI, functionName: "owner",
    query: { enabled: deployed },
  });

  const [triggerHash, setTriggerHash] = useState<`0x${string}` | null>(null);
  const [pendingId,   setPendingId]   = useState<bigint | null>(null);
  const { writeContractAsync } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: triggerHash ?? undefined });
  useEffect(() => {
    if (isSuccess) { refetch(); setPendingId(null); }
  }, [isSuccess, refetch]);

  const isOwner = !!(address && ownerRaw &&
    address.toLowerCase() === (ownerRaw as string).toLowerCase());

  const handleTrigger = async (eventId: bigint) => {
    setPendingId(eventId);
    try {
      const hash = await writeContractAsync({
        address: CAL_ADDR, abi: GOVERNANCE_CALENDAR_ABI,
        functionName: "triggerEvent", args: [eventId],
      });
      setTriggerHash(hash);
    } catch {
      setPendingId(null);
    }
  };

  const upcomingEvents = (eventsRaw as CalendarEvent[] | undefined) ?? [];

  // Static fallback when contract not deployed
  const STATIC_EVENTS = [
    { date: "15 juin 2026",   label: "Ouverture des inscriptions",        type: "Inscriptions",       recurring: false },
    { date: "15 juillet 2026",label: "Clôture inscriptions + vote constituant", type: "Élection", recurring: false },
    { date: "17 juillet 2026",label: "Clôture du vote (48h)",             type: "Élection",           recurring: false },
    { date: "1er août 2026",  label: "Première assemblée générale",       type: "Assemblée générale", recurring: true  },
    { date: "1er août 2026",  label: "Première session de création",      type: "Session de création",recurring: true  },
    { date: "1er octobre 2026",label: "Première élection trimestrielle",  type: "Élection",           recurring: true  },
  ];

  return (
    <div className="border border-[--border] bg-[--bg]">
      {/* Header */}
      <div className="bg-[--bg-card] border-b border-[--border] px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-0.5">
            Calendrier de gouvernance
          </p>
          <h2 className="font-bold">Prochains événements</h2>
        </div>
        {deployed && (
          <span className="flex items-center gap-1.5 font-mono text-xs text-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            On-chain
          </span>
        )}
      </div>

      <div className="px-6">
        {!deployed ? (
          /* Static fallback — before GovernanceCalendar deployment */
          <div>
            <p className="font-mono text-xs text-[--fg-muted] py-3 border-b border-[--border]">
              Calendrier fixe — GovernanceCalendar non encore déployé
            </p>
            {STATIC_EVENTS.map((ev, i) => (
              <div key={i} className="grid grid-cols-[180px_1fr_auto] gap-4 py-3.5 border-b border-[--border] last:border-none items-center">
                <p className="font-mono text-xs text-[--fg-muted]">{ev.date}</p>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{ev.label}</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[--fg-muted]">{ev.type}</span>
                    {ev.recurring && <span className="font-mono text-xs text-[--fg-muted]">↻ Récurrent</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : upcomingEvents.length === 0 ? (
          <p className="font-mono text-xs text-[--fg-muted] py-6">
            Aucun événement à venir — calendrier non initialisé.
          </p>
        ) : (
          upcomingEvents.map(ev => (
            <EventRow
              key={String(ev.id)}
              ev={ev}
              isOwner={isOwner}
              onTrigger={pendingId === null ? handleTrigger : () => {}}
            />
          ))
        )}
      </div>

      {/* Footer note */}
      <div className="px-6 py-3 bg-[--bg-card] border-t border-[--border]">
        <p className="font-mono text-xs text-[--fg-muted]">
          Les événements récurrents se reprogramment automatiquement après déclenchement.
          Tout le monde peut déclencher un événement à l'heure prévue.
          L'owner peut forcer le déclenchement à tout moment.
        </p>
      </div>
    </div>
  );
}
