"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { getNormieImageUrl } from "@/lib/normiesApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkState =
  | "PROPOSED" | "VOTE_OPEN" | "VOTE_TALLIED" | "BRIEFING"
  | "CREATING" | "VALIDATING" | "PUBLISHING" | "PUBLISHED" | "REJECTED";

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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATES: WorkState[] = [
  "PROPOSED", "VOTE_OPEN", "VOTE_TALLIED", "BRIEFING", "CREATING", "VALIDATING", "PUBLISHING",
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
    load();
    const id = setInterval(load, 15_000);
    return () => { mounted = false; clearInterval(id); };
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
  const stepIdx  = STATE_STEPS.indexOf(work.state);
  const progress = Math.round(((stepIdx + 1) / STATE_STEPS.length) * 100);

  return (
    <div className="border border-[--border] bg-[--bg-card]">
      {/* Header */}
      <div className="border-b border-[--border] px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shrink-0" />
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            {t("inProgress")}
          </p>
        </div>
        <span className="font-mono text-xs border border-purple-400 text-purple-600 px-2 py-0.5">
          {stateLabels[work.state]}
        </span>
      </div>

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
