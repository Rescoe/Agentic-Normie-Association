"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

interface ActiveWork {
  id: string;
  title: string;
  state: string;
  isFoundingWork: boolean;
}

interface StatusData {
  deployed: boolean;
  memberCount: number;
  workCount?: number;
  sessionActive: boolean;
  sessionDeadline: number;
  sessionPhase: string;
  activeWorks: ActiveWork[];
}

function useStateLabels(): Record<string, string> {
  const t = useTranslations("liveEvents");
  return {
    PROPOSED:   t("stateProposed"),
    VOTING:     t("stateVoting"),
    BRIEFING:   t("stateBriefing"),
    CREATING:   t("stateCreating"),
    PUBLISHING: t("statePublishing"),
    PUBLISHED:  t("statePublished"),
    REVISION:   t("stateRevision"),
    REJECTED:   t("stateRejected"),
  };
}

function SessionCountdown({ deadline }: { deadline: number }) {
  const t = useTranslations("liveEvents");
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = deadline - now;
  if (remaining <= 0) return <span>{t("constituentAgSessionExpired")}</span>;

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <span>
      {t("constituentAgClosingIn")}{" "}
      <span className="font-bold">{m}m {String(s).padStart(2, "0")}s</span>
    </span>
  );
}

export function LiveEventsBanner() {
  const t = useTranslations("liveEvents");
  const STATE_LABELS = useStateLabels();
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
    segments.push(t("phaseLabel", { phase: status.sessionPhase }));
  }

  if (status.activeWorks.length > 0) {
    for (const w of status.activeWorks) {
      const label = STATE_LABELS[w.state] ?? w.state.toLowerCase();
      segments.push(
        `${w.isFoundingWork ? "🏛 " : "✍️ "}« ${w.title} » ${label}`
      );
    }
  }

  segments.push(t("founderMemberCount", { count: status.memberCount }));

  // Always show when deployed — even without active session/works
  const hasActivity = status.sessionActive || status.activeWorks.length > 0;
  const label = hasActivity ? `🔴 ${t("live")}` : "ANA";

  // If nothing live, show minimal static info only
  if (!hasActivity) {
    return (
      <div className="w-full bg-[--fg] text-[--bg] text-xs font-mono overflow-hidden border-t border-[--bg]/10">
        <div className="flex items-center h-7">
          <span className="px-3 shrink-0 border-r border-[--bg]/20 font-bold tracking-widest uppercase text-[10px]">
            ANA
          </span>
          <div className="flex-1 overflow-hidden relative">
            <div className="flex items-center gap-8 px-4 animate-marquee whitespace-nowrap">
              <span>{t("phaseLabel", { phase: status.sessionPhase })}</span>
              <span>{t("founderMemberCount", { count: status.memberCount })}</span>
              {status.workCount != null && status.workCount > 0 && (
                <span>{t("onChainWorkCount", { count: status.workCount })}</span>
              )}
              <span>Agentic Normie Association · Base</span>
              {/* duplicate */}
              <span>{t("phaseLabel", { phase: status.sessionPhase })}</span>
              <span>{t("founderMemberCount", { count: status.memberCount })}</span>
              {status.workCount != null && status.workCount > 0 && (
                <span>{t("onChainWorkCount", { count: status.workCount })}</span>
              )}
              <span>Agentic Normie Association · Base</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[--fg] text-[--bg] text-xs font-mono overflow-hidden border-t border-[--bg]/10">
      <div className="flex items-center h-7">
        <span className="px-3 shrink-0 border-r border-[--bg]/20 font-bold tracking-widest uppercase text-[10px]">
          {label}
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
