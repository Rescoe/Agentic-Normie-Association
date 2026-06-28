"use client";

/**
 * Replaces the old hardcoded "June 30, 2026" homepage strings with the real
 * next-election window, read from on-chain ConstituentAssembly state via
 * GET /api/election/next (see src/lib/electionSchedule.ts for the shared
 * timing rules). Falls back to the static translated string while loading
 * or if the chain read fails, so the homepage never shows a blank/broken date.
 */
import { useEffect, useState } from "react";

interface NextElection {
  opensAt:  number;
  closesAt: number;
  isOpen:   boolean;
}

function useNextElection(): NextElection | null {
  const [data, setData] = useState<NextElection | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/election/next").then(r => r.json()).then((d: NextElection) => {
      if (!cancelled && typeof d.opensAt === "number") setData(d);
    }).catch(() => null);
    return () => { cancelled = true; };
  }, []);
  return data;
}

const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Small badge text — "Constituent AG · <date>" or "General Assembly · <date>" once it's recurring. */
export function ElectionBadgeDate({ fallback }: { fallback: string }) {
  const next = useNextElection();
  if (!next) return <>{fallback}</>;
  const label = next.isOpen ? "General Assembly open" : "General Assembly";
  return <>{label} · {fmt(next.opensAt)}</>;
}

/** The two timeline entries: open date and close date. Mirrors AGCalendarStrip's existing markup. */
export function ElectionTimelineDates({
  openLabel, closeLabel,
}: { openLabel: string; closeLabel: string }) {
  const next = useNextElection();
  const opensAt  = next ? fmt(next.opensAt)  : "…";
  const closesAt = next ? fmt(next.closesAt) : "…";
  const entries = [
    { date: opensAt,  label: openLabel,  color: "border-purple-500 text-purple-500" },
    { date: closesAt, label: closeLabel, color: "border-[--fg-muted] text-[--fg-muted]" },
  ];
  return (
    <>
      {entries.map((ev, i) => (
        <div key={i} className="flex items-center">
          {i > 0 && <div className="w-8 h-px bg-[--border] shrink-0" />}
          <div className={`border px-3 py-2 ${ev.color} shrink-0`}>
            <p className="font-mono text-[10px] uppercase tracking-widest opacity-70">{ev.date}</p>
            <p className="font-mono text-xs font-semibold mt-0.5">{ev.label}</p>
          </div>
        </div>
      ))}
    </>
  );
}

/** CTA section date range — "<open> – <close>". */
export function ElectionCtaRange({ fallback }: { fallback: string }) {
  const next = useNextElection();
  if (!next) return <>{fallback}</>;
  return <>General Assembly · {fmt(next.opensAt)} – {fmt(next.closesAt)}</>;
}
