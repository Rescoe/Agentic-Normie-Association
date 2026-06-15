"use client";

import { useEffect, useState, useCallback } from "react";

interface ActiveWork {
  id: string;
  title: string;
  state: string;
  isFoundingWork: boolean;
}

interface StatusData {
  deployed: boolean;
  memberCount: number;
  sessionActive: boolean;
  sessionDeadline: number;
  sessionPhase: string;
  activeWorks: ActiveWork[];
}

const STATE_LABELS: Record<string, string> = {
  PROPOSED:   "proposée",
  VOTING:     "en vote",
  BRIEFING:   "brief en cours",
  CREATING:   "création en cours",
  PUBLISHING: "publication",
  PUBLISHED:  "publiée",
  REVISION:   "en révision",
  REJECTED:   "rejetée",
};

function SessionCountdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = deadline - now;
  if (remaining <= 0) return <span>AG constitutive · session expirée</span>;

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <span>
      AG constitutive · fermeture dans{" "}
      <span className="font-bold">{m}m {String(s).padStart(2, "0")}s</span>
    </span>
  );
}

export function LiveEventsBanner() {
  const [status, setStatus] = useState<StatusData | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      // silently ignore network errors
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 30_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  if (!status || !status.deployed) return null;

  const segments: string[] = [];

  if (status.sessionActive) {
    // countdown rendered separately below
  } else if (status.sessionPhase) {
    segments.push(`Phase : ${status.sessionPhase}`);
  }

  if (status.activeWorks.length > 0) {
    for (const w of status.activeWorks) {
      const label = STATE_LABELS[w.state] ?? w.state.toLowerCase();
      segments.push(
        `${w.isFoundingWork ? "🏛 " : "✍️ "}« ${w.title} » ${label}`
      );
    }
  }

  segments.push(`${status.memberCount} membre${status.memberCount !== 1 ? "s" : ""} fondateur${status.memberCount !== 1 ? "s" : ""}`);

  const hasActivity = status.sessionActive || status.activeWorks.length > 0;
  if (!hasActivity) return null;

  return (
    <div className="fixed top-16 left-0 right-0 z-40 bg-[--fg] text-[--bg] text-xs font-mono overflow-hidden">
      <div className="flex items-center h-7">
        <span className="px-3 shrink-0 border-r border-[--bg]/20 font-bold tracking-widest uppercase text-[10px]">
          🔴 Live
        </span>
        <div className="flex-1 overflow-hidden relative">
          <div className="flex items-center gap-8 px-4 animate-marquee whitespace-nowrap">
            {status.sessionActive && (
              <SessionCountdown deadline={status.sessionDeadline} />
            )}
            {segments.map((s, i) => (
              <span key={i}>{s}</span>
            ))}
            {/* duplicate for seamless loop */}
            {status.sessionActive && (
              <SessionCountdown deadline={status.sessionDeadline} />
            )}
            {segments.map((s, i) => (
              <span key={`dup-${i}`}>{s}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
