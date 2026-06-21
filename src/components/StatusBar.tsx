"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

interface StatusData {
  deployed:      boolean;
  memberCount:   number;
  workCount:     number;
  activeWorks:   number;
  sessionActive: boolean;
  sessionPhase:  string;
  chain:         string;
}

function useClock() {
  const [time, setTime] = useState("——:——:——");
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    setTime(fmt());
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize:   10,
  whiteSpace: "nowrap",
};

function Label({ t }: { t: string }) {
  return (
    <span style={{ ...mono, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {t}
    </span>
  );
}

function Val({ t, green = false }: { t: string; green?: boolean }) {
  return (
    <span style={{ ...mono, fontWeight: 700, color: green ? "#16a34a" : "var(--fg)", marginLeft: 5 }}>
      {t}
    </span>
  );
}

function Sep() {
  return (
    <span style={{ ...mono, color: "var(--fg-muted)", opacity: 0.4, margin: "0 14px" }}>·</span>
  );
}

export function StatusBar() {
  const t = useTranslations("statusBar");
  const [data, setData] = useState<StatusData | null>(null);
  const clock           = useClock();

  useEffect(() => {
    const load = () =>
      fetch("/api/status").then(r => r.json()).then(setData).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const memberCount = data?.memberCount ?? 0;
  const workCount   = data?.workCount   ?? 0;
  const activeWorks = data?.activeWorks ?? 0;
  const phase       = data?.sessionPhase ?? t("registrationPhase");
  const chain       = data?.chain        ?? "Base";
  const isActive    = data?.sessionActive ?? false;

  // ── Strip content (one logical strip — duplicated in DOM for seamless loop) ──
  //
  // Each strip has min-width: 100vw so 2 copies always fill 200vw+ → no visible seam.
  // Animation: translateX(0) → translateX(-50%) scrolls exactly one strip width.

  const stripStyle: React.CSSProperties = {
    display:    "inline-flex",
    alignItems: "center",
    minWidth:   "100vw",       // Guarantees: 2 copies > viewport width, seam never shows
    paddingLeft: 32,
    flexShrink: 0,
  };

  const strip = (
    <span style={stripStyle}>
      {/* Live clock */}
      <span style={{ ...mono, color: "var(--fg-muted)", letterSpacing: "0.08em", minWidth: "7ch" }}>
        {clock}
      </span>

      <Sep />

      {/* Member count */}
      <Label t="Normies" />
      <Val t={data ? String(memberCount) : "—"} />

      <Sep />

      {/* Session state with live dot */}
      <span style={{
        display:      "inline-block",
        width:        5, height: 5,
        borderRadius: "50%",
        background:   isActive ? "#16a34a" : "#ca8a04",
        marginRight:  6,
        flexShrink:   0,
        animation:    isActive ? "sb-pulse 2s ease-in-out infinite" : "none",
      }} />
      <Label t="Session" />
      <Val t={phase} green={isActive} />

      <Sep />

      {/* Work counts */}
      <Label t={t("works")} />
      <Val t={data ? String(workCount) : "—"} />

      {activeWorks > 0 && (
        <>
          <Sep />
          <Label t={t("inProgress")} />
          <Val t={String(activeWorks)} green />
        </>
      )}

      <Sep />

      {/* Network */}
      <Label t={t("network")} />
      <Val t={chain} />

      {/* Trailing gap before next copy */}
      <span style={{ display: "inline-block", width: 32 }} />
    </span>
  );

  return (
    <>
      <style>{`
        @keyframes sb-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes sb-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>

      <div style={{
        height:       32,
        overflow:     "hidden",
        background:   "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
        position:     "relative",
      }}>
        {/* Absolute-positioned track so the animation starts flush at the left edge */}
        <div style={{
          position:   "absolute",
          top:        0, left: 0,
          height:     "100%",
          display:    "flex",
          alignItems: "center",
          animation:  "sb-scroll 30s linear infinite",
          willChange: "transform",
        }}>
          {strip}
          {strip}
        </div>
      </div>
    </>
  );
}
