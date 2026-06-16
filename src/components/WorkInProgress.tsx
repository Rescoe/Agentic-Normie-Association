"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
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

const STATE_LABELS: Record<WorkState, string> = {
  PROPOSED:     "Proposition",
  VOTE_OPEN:    "Vote en cours",
  VOTE_TALLIED: "Vote compté",
  BRIEFING:     "Brief en cours",
  CREATING:     "Création",
  VALIDATING:   "Validation",
  PUBLISHING:   "Publication",
  PUBLISHED:    "Publiée",
  REJECTED:     "Rejetée",
};

const STATE_STEPS: WorkState[] = [
  "PROPOSED", "VOTE_OPEN", "VOTE_TALLIED", "BRIEFING", "CREATING", "VALIDATING", "PUBLISHING",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkInProgress() {
  const [work, setWork] = useState<ActiveWork | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res  = await fetch("/api/works");
        const all  = await res.json() as ActiveWork[];
        // Find the most advanced active work
        const active = all
          .filter(w => ACTIVE_STATES.includes(w.state))
          .sort((a, b) => STATE_STEPS.indexOf(b.state) - STATE_STEPS.indexOf(a.state));
        if (mounted) setWork(active[0] ?? null);
      } catch { /* ignore */ }
      finally { if (mounted) setLoading(false); }
    };
    load();
    const id = setInterval(load, 120_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  if (loading) return null;
  if (!work) return null;

  const stepIdx  = STATE_STEPS.indexOf(work.state);
  const progress = Math.round(((stepIdx + 1) / STATE_STEPS.length) * 100);

  return (
    <section className="px-6 mb-12">
      <div className="max-w-6xl mx-auto">
        <div className="border border-[--border] bg-[--bg-card]">
          {/* Header */}
          <div className="border-b border-[--border] px-5 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shrink-0" />
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                En cours
              </p>
            </div>
            <span className="font-mono text-xs border border-purple-400 text-purple-600 px-2 py-0.5">
              {STATE_LABELS[work.state]}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* Title + proposal */}
            <div>
              <p className="font-bold text-lg leading-snug">« {work.title} »</p>
              {work.isBurnMemorial && (
                <span className="font-mono text-[10px] text-orange-600 border border-orange-300 px-1.5 py-0.5 mr-2">
                  mémorial
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
                  Progression
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
                    title={STATE_LABELS[s]}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
            </div>

            {/* People */}
            <div className="flex flex-wrap gap-4">
              <RolePill label="Proposant" tokenId={work.proposedBy} name={work.proposedByName} />
              {work.rapporteurTokenId && (
                <RolePill label="Rapporteur" tokenId={work.rapporteurTokenId} name={work.rapporteurName ?? ""} />
              )}
              {work.authorTokenId && (
                <RolePill label="Auteur" tokenId={work.authorTokenId} name={work.authorName ?? ""} />
              )}
              {work.curatorTokenId && (
                <RolePill label="Curateur" tokenId={work.curatorTokenId} name={work.curatorName ?? ""} />
              )}
            </div>

            {/* Vote tally (if vote started) */}
            {(work.yesCount != null || work.noCount != null) && (
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="text-green-600">✅ {work.yesCount ?? 0} oui</span>
                <span className="text-red-500">❌ {work.noCount ?? 0} non</span>
                {work.totalVoters && (
                  <span className="text-[--fg-muted]">/ {work.totalVoters} votants</span>
                )}
              </div>
            )}

            {/* Brief preview */}
            {work.brief && work.state === "CREATING" && (
              <details className="group">
                <summary className="font-mono text-xs text-[--fg-muted] cursor-pointer list-none flex items-center gap-1 hover:text-[--fg]">
                  <span className="group-open:rotate-90 transition-transform inline-block">›</span>
                  Brief artistique
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
                  Œuvre soumise (en cours de validation)
                </summary>
                <p className="mt-2 font-mono text-xs text-[--fg-muted] leading-relaxed border-l-2 border-purple-300 pl-3 whitespace-pre-wrap">
                  {work.artworkText}
                </p>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
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
        <p className="font-mono text-xs text-[--fg] leading-tight">{name || `#${tokenId}`}</p>
      </div>
    </div>
  );
}
