"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { getNormieImageUrl } from "@/lib/normiesApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkState =
  | "PROPOSED" | "VOTE_OPEN" | "VOTE_TALLIED" | "BRIEFING"
  | "CREATING" | "VALIDATING" | "PUBLISHING" | "PUBLISHED" | "REJECTED"
  | "NEEDS_RETHINK" | "BLOCKED_TECHNICAL";

interface ActiveWork {
  id:                string;
  title:             string;
  proposal:          string;
  state:             WorkState;
  proposedBy:        number;
  proposedByName:    string;
  proposedAt:        number;
  yesCount?:         number;
  noCount?:          number;
  totalVoters?:      number;
  authorName?:       string;
  authorTokenId?:    number;
  curatorName?:      string;
  curatorTokenId?:   number;
  rapporteurName?:   string;
  rapporteurTokenId?: number;
  brief?:            string;
  artworkText?:      string;
  isBurnMemorial?:   boolean;
  // Present only for a paused work (see workStore.ts) — never a raw
  // diagnostic string, just enough to label the pause honestly without
  // implying an artistic rejection.
  needsRethinkReason?: "technical" | "creative";
  pausedFromState?:    WorkState;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// A paused work (NEEDS_RETHINK/BLOCKED_TECHNICAL) must stay visible here — it
// is neither published nor rejected, and hiding it (the 29/09/2026 incident:
// "Unburned Roots' Reverie" vanished from every public/admin view the moment
// it paused) makes a real, still-in-progress piece look lost.
const ACTIVE_STATES: WorkState[] = [
  "PROPOSED", "VOTE_OPEN", "VOTE_TALLIED", "BRIEFING", "CREATING", "VALIDATING", "PUBLISHING",
  "NEEDS_RETHINK", "BLOCKED_TECHNICAL",
];

const STATE_STEPS: WorkState[] = [
  "PROPOSED", "VOTE_OPEN", "VOTE_TALLIED", "BRIEFING", "CREATING", "VALIDATING", "PUBLISHING",
];

function useStateLabels(): Record<WorkState, string> {
  const t = useTranslations("workInProgress");
  return {
    PROPOSED:     t("stateProposed"),
    VOTE_OPEN:    t("stateVoteOpen"),
    VOTE_TALLIED: t("stateVoteTallied"),
    BRIEFING:     t("stateBriefing"),
    CREATING:     t("stateCreating"),
    VALIDATING:   t("stateValidating"),
    PUBLISHING:   t("statePublishing"),
    PUBLISHED:    t("statePublished"),
    REJECTED:     t("stateRejected"),
    NEEDS_RETHINK:     t("stateNeedsRethink"),
    BLOCKED_TECHNICAL: t("stateBlockedTechnical"),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkInProgress() {
  const t = useTranslations("workInProgress");
  const STATE_LABELS = useStateLabels();
  const [works,   setWorks]   = useState<ActiveWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameMap, setNameMap] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res  = await fetch("/api/works");
        const all  = await res.json() as ActiveWork[];
        // Show ALL active works, not just the most advanced one — a single stuck
        // work (e.g. blocked on-chain publish) must never hide the others.
        const active = all
          .filter(w => ACTIVE_STATES.includes(w.state))
          .sort((a, b) => STATE_STEPS.indexOf(b.state) - STATE_STEPS.indexOf(a.state));
        if (mounted) setWorks(active);
      } catch { /* ignore */ }
      finally { if (mounted) setLoading(false); }
    };
    // Was 15s -- this component is mounted on the homepage, so every visitor
    // (or a tab left open, per Neon's Sept 2026 cost audit) pinged /api/works
    // -> Neon often enough to keep the compute's 5-minute scale-to-zero timer
    // from ever completing, same root cause as LiveEventsBanner's. Same fix:
    // 30 minutes, paused entirely while the tab is hidden/backgrounded.
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!interval) interval = setInterval(load, 1_800_000); };
    const stop  = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { load(); start(); }
      else stop();
    };
    load();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Batch-resolve real Normie names for everyone involved across all active works
  useEffect(() => {
    const ids = [...new Set(
      works.flatMap(w => [w.proposedBy, w.authorTokenId, w.rapporteurTokenId, w.curatorTokenId])
    )].filter((id): id is number => !!id && !nameMap.has(id));
    if (!ids.length) return;
    fetch(`/api/normies/persona?tokenIds=${ids.join(",")}`)
      .then(r => r.json())
      .then(d => {
        const resolved = new Map<number, string>();
        (d.personas ?? []).forEach((p: { tokenId: number; name: string }) => {
          if (p.name && !p.name.startsWith("Normie #")) resolved.set(p.tokenId, p.name);
        });
        if (resolved.size) setNameMap(prev => new Map([...prev, ...resolved]));
      })
      .catch(() => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [works]);

  const getName = useCallback((id: number, fallback?: string) => {
    const resolved = nameMap.get(id);
    if (resolved) return resolved;
    if (fallback && !fallback.startsWith("Normie #")) return fallback;
    return `#${id}`;
  }, [nameMap]);

  if (loading) return null;
  if (works.length === 0) return null;

  return (
    <section className="px-6 mb-12">
      <div className="max-w-6xl mx-auto space-y-4">
        {works.map(work => (
          <WorkCard key={work.id} work={work} getName={getName} stateLabels={STATE_LABELS} />
        ))}
      </div>
    </section>
  );
}

function WorkCard({
  work, getName, stateLabels,
}: {
  work: ActiveWork;
  getName: (id: number, fallback?: string) => string;
  stateLabels: Record<WorkState, string>;
}) {
  const t = useTranslations("workInProgress");
  const isPaused = work.state === "NEEDS_RETHINK" || work.state === "BLOCKED_TECHNICAL";
  // A paused work's progress bar freezes at whatever step it was at before
  // pausing (pausedFromState) rather than showing 0% — it hasn't lost its
  // place, it's just stalled there.
  const stepIdx  = STATE_STEPS.indexOf(isPaused ? (work.pausedFromState ?? work.state) : work.state);
  const progress = Math.round((((stepIdx < 0 ? 0 : stepIdx) + 1) / STATE_STEPS.length) * 100);

  return (
    <div className={`border bg-[--bg-card] ${isPaused ? "border-orange-300" : "border-[--border]"}`}>
      {/* Header */}
      <div className="border-b border-[--border] px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${isPaused ? "bg-orange-500" : "bg-purple-500 animate-pulse"}`} />
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            {isPaused ? t("paused") : t("inProgress")}
          </p>
        </div>
        <span className={`font-mono text-xs border px-2 py-0.5 ${isPaused ? "border-orange-400 text-orange-600" : "border-purple-400 text-purple-600"}`}>
          {stateLabels[work.state]}
        </span>
      </div>
      {isPaused && (
        <p className="px-5 pt-3 font-mono text-xs text-orange-700">
          {work.state === "NEEDS_RETHINK" && work.needsRethinkReason !== "technical"
            ? t("pausedCreative")
            : t("pausedTechnical")}
        </p>
      )}

      <div className="p-5 space-y-4">
        {/* Title + proposal */}
        <div>
          <p className="font-bold text-lg leading-snug">« {work.title} »</p>
          {work.isBurnMemorial && (
            <span className="font-mono text-[10px] text-orange-600 border border-orange-300 px-1.5 py-0.5 mr-2">
              {t("memorial")}
            </span>
          )}
          <p className="text-sm text-[--fg-muted] leading-relaxed mt-1 line-clamp-2">
            {work.proposal}
          </p>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">
              {t("progress")}
            </p>
            <p className="font-mono text-[10px] text-[--fg-muted]">{progress}%</p>
          </div>
          <div className="w-full h-1 bg-[--border] rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            {STATE_STEPS.map((s, i) => (
              <span
                key={s}
                className={`font-mono text-[9px] ${i <= stepIdx ? "text-purple-500" : "text-[--fg-muted] opacity-40"}`}
                title={stateLabels[s]}
              >
                {i + 1}
              </span>
            ))}
          </div>
        </div>

        {/* People */}
        <div className="flex flex-wrap gap-4">
          <RolePill label={t("proposedByLabel")}  tokenId={work.proposedBy}        name={getName(work.proposedBy, work.proposedByName)} />
          {work.rapporteurTokenId && (
            <RolePill label={t("rapporteurLabel")} tokenId={work.rapporteurTokenId} name={getName(work.rapporteurTokenId, work.rapporteurName)} />
          )}
          {work.authorTokenId && (
            <RolePill label={t("authorLabel")}     tokenId={work.authorTokenId}     name={getName(work.authorTokenId, work.authorName)} />
          )}
          {work.curatorTokenId && (
            <RolePill label={t("curatorLabel")}    tokenId={work.curatorTokenId}    name={getName(work.curatorTokenId, work.curatorName)} />
          )}
        </div>

        {/* Vote tally (if vote started) */}
        {(work.yesCount != null || work.noCount != null) && (
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-green-600">✅ {t("yesVotes", { count: work.yesCount ?? 0 })}</span>
            <span className="text-red-500">❌ {t("noVotes", { count: work.noCount ?? 0 })}</span>
            {work.totalVoters && (
              <span className="text-[--fg-muted]">/ {t("totalVoters", { count: work.totalVoters })}</span>
            )}
          </div>
        )}

        {/* Brief preview */}
        {work.brief && work.state === "CREATING" && (
          <details className="group">
            <summary className="font-mono text-xs text-[--fg-muted] cursor-pointer list-none flex items-center gap-1 hover:text-[--fg]">
              <span className="group-open:rotate-90 transition-transform inline-block">›</span>
              {t("artisticBrief")}
            </summary>
            <p className="mt-2 font-mono text-xs text-[--fg-muted] leading-relaxed border-l-2 border-[--border] pl-3 whitespace-pre-wrap">
              {work.brief}
            </p>
          </details>
        )}

        {/* Artwork preview (while in VALIDATING) */}
        {work.artworkText && work.state === "VALIDATING" && (
          <details className="group">
            <summary className="font-mono text-xs text-[--fg-muted] cursor-pointer list-none flex items-center gap-1 hover:text-[--fg]">
              <span className="group-open:rotate-90 transition-transform inline-block">›</span>
              {t("submittedWorkValidating")}
            </summary>
            <p className="mt-2 font-mono text-xs text-[--fg-muted] leading-relaxed border-l-2 border-purple-300 pl-3 whitespace-pre-wrap">
              {work.artworkText}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}

function RolePill({ label, tokenId, name }: { label: string; tokenId: number; name: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative w-6 h-6 overflow-hidden rounded-sm shrink-0">
        <Image
          src={getNormieImageUrl(tokenId)}
          alt={name}
          fill
          className="object-contain"
          style={{ imageRendering: "pixelated" }}
          unoptimized
        />
      </div>
      <div>
        <p className="font-mono text-[9px] text-[--fg-muted] uppercase tracking-widest leading-none">
          {label}
        </p>
        <p className="font-mono text-xs text-[--fg] leading-tight">{name}</p>
      </div>
    </div>
  );
}
