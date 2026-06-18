"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useReadContract } from "wagmi";
import { createPublicClient, http, parseAbiItem } from "viem";
import { base as baseChain } from "viem/chains";
import Image from "next/image";
import Link from "next/link";
import { WORK_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";
import type { ANAWork, WorkState } from "@/lib/workStore";

// ─── Viem client (on-chain log fetching) ─────────────────────────────────────

const viemClient = createPublicClient({
  chain: baseChain,
  transport: http("https://mainnet.base.org"),
});

// ─── Constants ────────────────────────────────────────────────────────────────

const WR_ADDR  = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;
const deployed = !!CONTRACT_ADDRESSES.WorkRegistry;

const ACTIVE_STATES: WorkState[] = [
  "PROPOSED", "VOTE_OPEN", "VOTE_TALLIED",
  "BRIEFING", "CREATING", "VALIDATING", "PUBLISHING",
];

const STATE_LABEL: Record<string, string> = {
  PROPOSED:     "Proposée",
  VOTE_OPEN:    "Vote en cours",
  VOTE_TALLIED: "Vote clôturé",
  BRIEFING:     "Brief en rédaction",
  CREATING:     "Création en cours",
  VALIDATING:   "Validation",
  PUBLISHING:   "Publication on-chain…",
};

const STATE_COLOR: Record<string, string> = {
  PROPOSED:     "text-blue-500 border-blue-500/30",
  VOTE_OPEN:    "text-yellow-500 border-yellow-500/30",
  VOTE_TALLIED: "text-orange-500 border-orange-500/30",
  BRIEFING:     "text-purple-500 border-purple-500/30",
  CREATING:     "text-indigo-500 border-indigo-500/30",
  VALIDATING:   "text-cyan-500 border-cyan-500/30",
  PUBLISHING:   "text-teal-500 border-teal-500/30",
};

// ─── InProgressWorkCard ───────────────────────────────────────────────────────

type GetName = (tokenId: number | undefined, fallback?: string | null) => string;

function InProgressWorkCard({ work, getName }: { work: ANAWork; getName: GetName }) {
  const label    = STATE_LABEL[work.state]  ?? work.state;
  const colorCls = STATE_COLOR[work.state]  ?? "text-[--fg-muted] border-[--border]";
  const lastStep = work.stateHistory[work.stateHistory.length - 1];
  const trio = [
    { label: "Rapporteur", tid: work.rapporteurTokenId, name: getName(work.rapporteurTokenId, work.rapporteurName) },
    { label: "Auteur",     tid: work.authorTokenId,     name: getName(work.authorTokenId,     work.authorName) },
    { label: "Curateur",   tid: work.curatorTokenId,    name: getName(work.curatorTokenId,    work.curatorName) },
  ].filter(r => r.tid != null);

  const STEPS: { state: WorkState; short: string }[] = [
    { state: "PROPOSED",     short: "Proposition" },
    { state: "VOTE_OPEN",    short: "Vote"         },
    { state: "BRIEFING",     short: "Brief"        },
    { state: "CREATING",     short: "Création"     },
    { state: "VALIDATING",   short: "Validation"   },
    { state: "PUBLISHING",   short: "Publication"  },
  ];
  // VOTE_TALLIED = still in vote phase for progress display
  const progressState = work.state === "VOTE_TALLIED" ? "VOTE_OPEN" : work.state as WorkState;
  const currentStep   = STEPS.findIndex(s => s.state === progressState);

  return (
    <div className="border border-[--border] bg-[--bg] flex flex-col gap-4 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-bold text-sm leading-snug">{work.title}</p>
          <p className="font-mono text-xs text-[--fg-muted] mt-0.5">
            par {getName(work.proposedBy, work.proposedByName)} · {new Date(work.proposedAt).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <span className={`font-mono text-[10px] border px-2 py-0.5 shrink-0 ${colorCls}`}>
          {label}
        </span>
      </div>

      {/* Progress steps — named labels */}
      <div className="flex gap-0.5 items-end">
        {STEPS.map((s, i) => {
          const done    = i < currentStep;
          const active  = i === currentStep;
          const pending = i > currentStep;
          return (
            <div key={s.state} className="flex-1 flex flex-col gap-1 items-center">
              <div
                className={`h-1 w-full rounded-sm transition-colors ${
                  done   ? "bg-[--fg]/80" :
                  active ? "bg-[--fg]/60 animate-pulse" :
                           "bg-[--border]"
                }`}
              />
              <span
                className={`font-mono text-[8px] leading-none hidden sm:block ${
                  pending ? "text-[--border]" :
                  active  ? "text-[--fg]"    :
                            "text-[--fg-muted]"
                }`}
              >
                {s.short}
              </span>
            </div>
          );
        })}
      </div>

      {/* Proposal */}
      {work.proposal && (
        <p className="text-xs text-[--fg-muted] leading-relaxed line-clamp-2 italic border-l-2 border-[--border] pl-2">
          {work.proposal}
        </p>
      )}

      {/* Trio (only after roles assigned) */}
      {trio.length > 0 && (
        <div className="flex gap-4">
          {trio.map(({ label: roleLabel, tid, name }) => (
            <div key={roleLabel} className="flex items-center gap-1.5">
              <div className="relative w-6 h-6 overflow-hidden shrink-0">
                <Image
                  src={getNormieImageUrl(tid!)}
                  alt={`#${tid}`}
                  fill
                  className="object-contain"
                  style={{ imageRendering: "pixelated" }}
                  unoptimized
                />
              </div>
              <div>
                <p className="font-mono text-[9px] text-[--fg-muted]">{roleLabel}</p>
                <p className="font-mono text-[10px]">{name ?? `#${tid}`}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vote results */}
      {work.yesCount != null && (
        <div className="flex gap-3 font-mono text-xs">
          <span className="text-green-500">✓ {work.yesCount} oui</span>
          <span className="text-red-400">✗ {work.noCount ?? 0} non</span>
          {(work.absCount ?? 0) > 0 && <span className="text-[--fg-muted]">– {work.absCount} abs</span>}
        </div>
      )}

      {/* Salon link */}
      {work.salonId && work.salonId !== "salon_agora_ana" && (
        <Link
          href={`/salon?s=${work.salonId}`}
          className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors underline-offset-2 hover:underline"
        >
          → Salon dédié ↗
        </Link>
      )}

      {/* Last step note */}
      {lastStep?.note && (
        <p className="font-mono text-[10px] text-[--fg-muted] truncate">
          ▸ {lastStep.note}
        </p>
      )}
    </div>
  );
}

// ─── WorkCard (Neon data — PUBLISHED) ────────────────────────────────────────

// ─── WorkChainProof — fetches on-chain events for a specific workId ───────────

interface ChainEvent {
  type:    "PUBLISHED" | "SESSION" | "ARCHIVED";
  txHash:  string;
  block:   bigint;
  ts:      number;
  extra?:  string;
}

function WorkChainProof({ onChainId }: { onChainId: number }) {
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

  useEffect(() => {
    if (!WR_ADDR) { setLoading(false); return; }

    const EV_PUBLISHED = parseAbiItem(
      "event WorkPublished(uint256 indexed workId, string content, uint256 indexed authorTokenId, uint256 indexed rapporteurTokenId, uint256 timestamp)"
    );
    const EV_ARCHIVED  = parseAbiItem("event WorkArchived(uint256 indexed workId)");
    const EV_SESSION   = parseAbiItem(
      "event WorkSessionInitiated(uint256 indexed sessionId, uint256 initiatedAt, address indexed initiatedBy)"
    );

    (async () => {
      try {
        const latest    = await viemClient.getBlockNumber();
        const fromBlock = latest > 3_000_000n ? latest - 3_000_000n : 0n;
        const id        = BigInt(onChainId);

        const [pubLogs, archLogs, sessLogs] = await Promise.allSettled([
          viemClient.getLogs({ address: WR_ADDR, event: EV_PUBLISHED, args: { workId: id }, fromBlock, toBlock: latest }),
          viemClient.getLogs({ address: WR_ADDR, event: EV_ARCHIVED,  args: { workId: id }, fromBlock, toBlock: latest }),
          viemClient.getLogs({ address: WR_ADDR, event: EV_SESSION,   fromBlock, toBlock: latest }),
        ]);

        const result: ChainEvent[] = [];

        if (pubLogs.status === "fulfilled") {
          for (const log of pubLogs.value) {
            const block = await viemClient.getBlock({ blockNumber: log.blockNumber! }).catch(() => null);
            result.push({
              type:   "PUBLISHED",
              txHash: log.transactionHash ?? "",
              block:  log.blockNumber ?? 0n,
              ts:     block ? Number(block.timestamp) * 1000 : 0,
            });
          }
        }
        if (archLogs.status === "fulfilled") {
          for (const log of archLogs.value) {
            const block = await viemClient.getBlock({ blockNumber: log.blockNumber! }).catch(() => null);
            result.push({
              type:   "ARCHIVED",
              txHash: log.transactionHash ?? "",
              block:  log.blockNumber ?? 0n,
              ts:     block ? Number(block.timestamp) * 1000 : 0,
            });
          }
        }
        if (sessLogs.status === "fulfilled" && sessLogs.value.length > 0) {
          for (const log of sessLogs.value) {
            const sessionId = Number((log.args as Record<string, unknown>).sessionId ?? 0n);
            if (Math.abs(sessionId - onChainId) <= 2) {
              const block = await viemClient.getBlock({ blockNumber: log.blockNumber! }).catch(() => null);
              result.push({
                type:   "SESSION",
                txHash: log.transactionHash ?? "",
                block:  log.blockNumber ?? 0n,
                ts:     block ? Number(block.timestamp) * 1000 : 0,
                extra:  `Session #${sessionId}`,
              });
            }
          }
        }

        result.sort((a, b) => Number(a.block) - Number(b.block));
        setEvents(result);
      } catch { /* RPC errors are silent */ }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChainId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <div className="w-3 h-3 border border-[--border] border-t-[--fg-muted] rounded-full animate-spin" />
        <p className="font-mono text-[10px] text-[--fg-muted]">Fetching on-chain proof…</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="font-mono text-[10px] text-[--fg-muted]">No on-chain events found in recent blocks.</p>
    );
  }

  const TYPE_LABEL: Record<string, string> = {
    PUBLISHED: "◆ WorkPublished",
    SESSION:   "⬟ WorkSession",
    ARCHIVED:  "▣ Archived",
  };

  return (
    <div className="space-y-1.5">
      {events.map((ev, i) => (
        <div key={i} className="flex flex-col gap-0.5 font-mono text-[10px]">
          <div className="flex items-center gap-2">
            <span className="text-[--fg]">{TYPE_LABEL[ev.type] ?? ev.type}</span>
            {ev.extra && <span className="text-[--fg-muted]">· {ev.extra}</span>}
            <span className="text-[--fg-muted]">block #{String(ev.block)}</span>
            {ev.ts > 0 && (
              <span className="text-[--fg-muted]">
                · {new Date(ev.ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          {ev.txHash && (
            <a
              href={`https://basescan.org/tx/${ev.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[--fg-muted] hover:text-[--fg] transition-colors break-all"
            >
              {ev.txHash}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function GovernanceReport({ work, onChainId }: { work: ANAWork; onChainId?: number }) {
  const yes = work.yesCount ?? 0;
  const no  = work.noCount  ?? 0;
  const abs = work.absCount ?? 0;
  return (
    <div className="border-t border-[--border] bg-[--bg-card] p-4 space-y-4">
      <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">Governance report</p>

      <div className="space-y-1">
        <p className="font-mono text-xs font-semibold">Assembly vote</p>
        <p className="font-mono text-xs">
          <span className="text-green-500">✓ {yes} yes</span>
          {" · "}
          <span className="text-red-400">✗ {no} no</span>
          {" · "}
          <span className="text-[--fg-muted]">– {abs} abstain</span>
        </p>
        {(work.votes ?? []).map(v => (
          <p key={v.tokenId} className="font-mono text-[10px] text-[--fg-muted] leading-relaxed pl-2 border-l border-[--border]">
            {v.vote === "yes" ? "✓" : v.vote === "no" ? "✗" : "–"}{" "}
            <span className="text-[--fg]">{v.name}</span> — {v.reason}
          </p>
        ))}
      </div>

      {work.brief && (
        <div className="space-y-1">
          <p className="font-mono text-xs font-semibold">Creative brief</p>
          <p className="font-mono text-[10px] text-[--fg-muted] leading-relaxed whitespace-pre-wrap">
            {work.brief}
          </p>
        </div>
      )}

      <div className="space-y-0.5">
        <p className="font-mono text-xs font-semibold">Process log</p>
        {(work.stateHistory ?? []).map((h, i) => (
          <p key={i} className="font-mono text-[10px] text-[--fg-muted]">
            ▸ <span className="text-[--fg]">{h.state}</span>{" "}
            — {new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            {h.note ? ` — ${h.note}` : ""}
          </p>
        ))}
      </div>

      {work.txHash && (
        <p className="font-mono text-[10px] text-[--fg-muted] break-all">
          Base · WorkRegistry · tx:{" "}
          <a
            href={`https://basescan.org/tx/${work.txHash}`}
            target="_blank" rel="noopener noreferrer"
            className="hover:text-[--fg] transition-colors"
          >
            {work.txHash}
          </a>
        </p>
      )}

      {onChainId != null && (
        <div className="space-y-1.5 pt-2 border-t border-[--border]">
          <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">On-chain proof</p>
          <WorkChainProof onChainId={onChainId} />
        </div>
      )}
    </div>
  );
}

// ─── ArtworkModal — floating panel for both HTML and poem works ───────────────

function ArtworkModal({
  work,
  certUrl,
  isHtml,
  onClose,
}: {
  work: ANAWork;
  certUrl: string;
  isHtml: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-[--fg]/40"
      onClick={onClose}
    >
      {/* Panel */}
      <div
        className={`
          relative flex flex-col bg-[--bg] border border-[--border]
          w-full shadow-2xl
          ${isHtml ? "max-w-5xl h-[88vh]" : "max-w-xl max-h-[85vh]"}
        `}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[--border] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest shrink-0">
              {isHtml ? "Artwork" : (work.artForm ?? "Poem")}
            </p>
            <p className="font-bold text-sm truncate">{work.title}</p>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors ml-4 shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        {isHtml ? (
          <iframe
            src={certUrl}
            className="flex-1 w-full border-0 bg-black"
            sandbox="allow-scripts"
            title={work.title}
          />
        ) : (
          <div className="overflow-y-auto flex-1 px-8 py-10">
            <pre className="font-mono text-sm leading-[2.2] whitespace-pre-wrap text-[--fg] tracking-wide">
              {work.artworkText}
            </pre>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[--border] shrink-0">
          <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">
            {work.artForm ?? "text"} · ANA · Base
            {work.publishedAt ? ` · ${new Date(work.publishedAt).getFullYear()}` : ""}
          </p>
          <a
            href={certUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors flex items-center gap-1 border border-[--border] px-2 py-1 hover:border-[--fg]"
          >
            ◈ Certificate immutable
          </a>
        </div>
      </div>
    </div>
  );
}

function WorkCard({ work, onChainId, getName }: { work: ANAWork; onChainId: number; getName: GetName }) {
  const [showModal,  setShowModal]  = useState(false);
  const [showReport, setShowReport] = useState(false);

  const date = work.publishedAt ? new Date(work.publishedAt) : null;
  const trio = [
    { label: "Author",     tid: work.authorTokenId,      name: getName(work.authorTokenId,     work.authorName) },
    { label: "Curator",    tid: work.curatorTokenId,     name: getName(work.curatorTokenId,    work.curatorName) },
    { label: "Rapporteur", tid: work.rapporteurTokenId,  name: getName(work.rapporteurTokenId, work.rapporteurName) },
  ];

  const certUrl = `/api/works/html/${onChainId}`;
  const isHtml  = !!(work.artForm?.startsWith("html-") ||
    (work.artworkText && /^<!DOCTYPE|^<html/i.test(work.artworkText.trimStart())));

  return (
    <div className="border border-[--border] bg-[--bg] flex flex-col">

      {/* ── Artwork zone — click opens fullscreen modal ── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setShowModal(true)}
        onKeyDown={e => e.key === "Enter" && setShowModal(true)}
        className="cursor-pointer group overflow-hidden"
      >
        {isHtml ? (
          /* HTML/generative — live but non-interactive preview */
          <div className="relative bg-black" style={{ aspectRatio: "4/3" }}>
            <iframe
              src={certUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts"
              title={work.title}
              style={{ pointerEvents: "none" }}
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
              <span className="font-mono text-xs text-white border border-white/40 px-3 py-1.5">
                ⤢ open fullscreen
              </span>
            </div>
          </div>
        ) : work.artworkText ? (
          /* Poem/text — displayed directly, fades into CTA */
          <div className="relative bg-[--bg-card] px-6 pt-6 pb-0 overflow-hidden" style={{ maxHeight: "220px" }}>
            <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-[--fg]">
              {work.artworkText}
            </pre>
            <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-[--bg-card] to-transparent flex items-end justify-center pb-3">
              <span className="font-mono text-[10px] text-[--fg-muted] group-hover:text-[--fg] transition-colors">
                read in full →
              </span>
            </div>
          </div>
        ) : (
          /* Fallback — no artworkText */
          <div className="relative bg-[--bg-card] flex items-center justify-center" style={{ aspectRatio: "4/3" }}>
            <div className="flex gap-3 items-center">
              {trio.map(({ label, tid }) => tid != null ? (
                <div key={label} className="relative w-12 h-12 overflow-hidden">
                  <Image src={getNormieImageUrl(tid!)} alt={`#${tid}`} fill
                    className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
                </div>
              ) : null)}
            </div>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-[--fg]/5 transition-colors">
              <span className="font-mono text-xs bg-[--bg] border border-[--border] px-3 py-1.5">Open ↗</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Metadata ── */}
      <div className="p-4 space-y-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-sm">{work.title}</p>
            <p className="font-mono text-xs text-[--fg-muted]">
              {date?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) ?? "—"}
            </p>
          </div>
          <span className="font-mono text-xs px-1.5 py-0.5 border border-[--border] text-[--fg-muted] shrink-0">
            #{onChainId}
          </span>
        </div>

        {/* Trio */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {trio.map(({ label, tid, name }) => (
            <div key={label} className="space-y-1">
              {tid != null ? (
                <div className="relative w-8 h-8 mx-auto overflow-hidden">
                  <Image src={getNormieImageUrl(tid!)} alt={`#${tid}`} fill
                    className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
                </div>
              ) : (
                <div className="w-8 h-8 mx-auto bg-[--border]" />
              )}
              <p className="font-mono text-[10px] text-[--fg-muted]">{label}</p>
              <p className="font-mono text-[10px]">{name}</p>
            </div>
          ))}
        </div>

        {/* Edition info */}
        {work.editionSupply && work.editionPrice && (
          <p className="font-mono text-[10px] text-[--fg-muted] border border-[--border] px-2 py-1">
            {work.editionSupply} editions · {work.editionPrice} ETH
          </p>
        )}

        {/* Footer — same for all work types */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-[--border]">
          <button
            onClick={() => setShowReport(r => !r)}
            className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            {showReport ? "↑ Hide process" : "↓ How it was made"}
          </button>
          <div className="flex items-center gap-3">
            <a
              href={certUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs border border-[--border] px-2 py-1 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors flex items-center gap-1"
            >
              <span>◈</span> Certificate
            </a>
            {work.txHash && (
              <a
                href={`https://basescan.org/tx/${work.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors"
              >
                tx ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Inline governance report — all work types */}
      {showReport && <GovernanceReport work={work} onChainId={onChainId} />}

      {/* Fullscreen artwork modal */}
      {showModal && (
        <ArtworkModal
          work={work}
          certUrl={certUrl}
          isHtml={isHtml}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ─── Certificate parser — extracts structured data from the on-chain HTML ────────

interface ParsedCert {
  title:             string;
  artworkText:       string;
  brief:             string;
  yes:               number;
  no:                number;
  abs:               number;
  votes:             { name: string; vote: "yes" | "no" | "abstain"; reason: string }[];
  authorName:        string;
  authorTokenId:     number | null;
  curatorName:       string;
  curatorTokenId:    number | null;
  rapporteurName:    string;
  rapporteurTokenId: number | null;
  txHash:            string;
  publishedDate:     string;
  stateHistory:      { state: string; display: string }[];
  isHtmlArtwork:     boolean;
}

function parseCertHtml(html: string): ParsedCert {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // No .lbl elements → raw generative HTML artwork, not a poem certificate
  const isHtmlArtwork = !doc.querySelector(".lbl");
  const emptyBase = {
    artworkText: "", brief: "", yes: 0, no: 0, abs: 0, votes: [],
    authorName: "", authorTokenId: null, curatorName: "", curatorTokenId: null,
    rapporteurName: "", rapporteurTokenId: null, txHash: "", publishedDate: "",
    stateHistory: [],
  };
  if (isHtmlArtwork) {
    return {
      ...emptyBase,
      title: doc.title?.replace(" — ANA", "").trim() || "Artwork",
      isHtmlArtwork: true,
    };
  }

  const title = doc.querySelector("h1")?.textContent?.trim()
    ?? doc.title?.replace(" — ANA", "").trim()
    ?? "";

  const lblEls    = Array.from(doc.querySelectorAll(".lbl"));
  const findLbl   = (prefix: string) => lblEls.find(l => l.textContent?.trim().startsWith(prefix));
  const getBlock  = (lbl: Element | undefined) =>
    lbl?.closest("section")?.querySelector(".block")?.textContent?.trim() ?? "";

  const artworkText = getBlock(findLbl("Artwork"));
  const brief       = getBlock(findLbl("Creative Brief"));

  // Vote counts from .vleg
  const voteCount = (cls: string) => {
    const m = doc.querySelector(`.vleg ${cls}`)?.textContent?.match(/\d+/);
    return m ? parseInt(m[0]) : 0;
  };
  const yes = voteCount(".y");
  const no  = voteCount(".n");
  const abs = voteCount(".a");

  // Individual votes from .vtab rows
  const votes = Array.from(doc.querySelectorAll(".vtab tr")).flatMap(row => {
    const cells  = row.querySelectorAll("td");
    if (cells.length < 3) return [];
    const name   = cells[0].textContent?.trim() ?? "";
    const icon   = cells[1].textContent?.trim() ?? "";
    const reason = cells[2].textContent?.trim() ?? "";
    if (!name) return [];
    const vote   = icon === "✓" ? "yes" as const : icon === "✗" ? "no" as const : "abstain" as const;
    return [{ name, vote, reason }];
  });

  // Creation team cards
  const cards   = Array.from(doc.querySelectorAll(".credits .card"));
  const getCard = (role: string) => {
    const card    = cards.find(c => c.querySelector(".role")?.textContent?.trim().toLowerCase() === role);
    const name    = card?.querySelector(".name")?.textContent?.trim() ?? "";
    const cidText = card?.querySelector(".cid")?.textContent?.trim() ?? "";
    const tokenId = cidText ? (parseInt(cidText.replace("#", "")) || null) : null;
    return { name, tokenId };
  };
  const author     = getCard("author");
  const curator    = getCard("curator");
  const rapporteur = getCard("rapporteur");

  // Process log entries
  const stateHistory = Array.from(doc.querySelectorAll(".log .entry")).map(entry => ({
    state:   entry.querySelector("strong")?.textContent?.trim() ?? "",
    display: entry.textContent?.trim().replace(/^▸\s*/, "") ?? "",
  }));

  // tx hash from .tx paragraph
  const txText  = doc.querySelector(".tx")?.textContent?.trim() ?? "";
  const txMatch = txText.match(/0x[a-fA-F0-9]{60,66}/);
  const txHash  = txMatch?.[0] ?? "";

  // Published date from header .meta line
  const metaText    = doc.querySelector("p.meta")?.textContent?.trim() ?? "";
  const pubMatch    = metaText.match(/Published on\s+(.+?)(?:\s*$|\s*·)/);
  const publishedDate = pubMatch?.[1]?.trim() ?? "";

  return {
    title, artworkText, brief, yes, no, abs, votes,
    authorName: author.name, authorTokenId: author.tokenId,
    curatorName: curator.name, curatorTokenId: curator.tokenId,
    rapporteurName: rapporteur.name, rapporteurTokenId: rapporteur.tokenId,
    txHash, publishedDate, stateHistory, isHtmlArtwork: false,
  };
}

// ─── OnChainWorkCard — reads & parses the on-chain certificate directly ────────

function OnChainWorkCard({ workId }: { workId: number }) {
  const [cert,       setCert]       = useState<ParsedCert | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [showModal,  setShowModal]  = useState(false);
  const [showReport, setShowReport] = useState(false);

  const certUrl = `/api/works/html/${workId}`;

  useEffect(() => {
    fetch(certUrl)
      .then(r => r.text())
      .then(html => { setCert(parseCertHtml(html)); setLoading(false); })
      .catch(() => setLoading(false));
  }, [certUrl]);

  if (loading) {
    return (
      <div className="border border-[--border] bg-[--bg] flex items-center gap-2 p-6">
        <div className="w-3 h-3 border border-[--border] border-t-[--fg-muted] rounded-full animate-spin" />
        <p className="font-mono text-[10px] text-[--fg-muted]">Loading #{workId} from chain…</p>
      </div>
    );
  }

  if (!cert) {
    return (
      <div className="border border-[--border] bg-[--bg] p-6">
        <p className="font-mono text-xs text-[--fg-muted]">#{workId} — unable to load</p>
      </div>
    );
  }

  // ── HTML / generative artwork ────────────────────────────────────────────────
  if (cert.isHtmlArtwork) {
    return (
      <div className="border border-[--border] bg-[--bg] flex flex-col">
        <div
          role="button" tabIndex={0}
          onClick={() => setShowModal(true)}
          onKeyDown={e => e.key === "Enter" && setShowModal(true)}
          className="relative bg-black overflow-hidden cursor-pointer group"
          style={{ aspectRatio: "4/3" }}
        >
          <iframe src={certUrl} className="w-full h-full border-0" sandbox="allow-scripts"
            title={cert.title} style={{ pointerEvents: "none" }} />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
            <span className="font-mono text-xs text-white border border-white/40 px-3 py-1.5">⤢ open fullscreen</span>
          </div>
        </div>
        <div className="p-4 space-y-3 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold text-sm leading-tight">{cert.title || `Artwork #${workId}`}</p>
            <span className="font-mono text-xs px-1.5 py-0.5 border border-[--border] text-[--fg-muted] shrink-0">#{workId}</span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-[--border]">
            <p className="font-mono text-xs text-[--fg-muted]">on-chain · Base</p>
            <a href={certUrl} target="_blank" rel="noopener noreferrer"
              className="font-mono text-xs border border-[--border] px-2 py-1 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors flex items-center gap-1">
              <span>◈</span> Certificate
            </a>
          </div>
        </div>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-[--fg]/40"
            onClick={() => setShowModal(false)}>
            <div className="relative flex flex-col bg-[--bg] border border-[--border] w-full max-w-5xl h-[88vh] shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-[--border] shrink-0">
                <p className="font-bold text-sm truncate">{cert.title}</p>
                <button onClick={() => setShowModal(false)}
                  className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors ml-4 shrink-0">✕</button>
              </div>
              <iframe src={certUrl} className="flex-1 w-full border-0 bg-black" sandbox="allow-scripts" title={cert.title} />
              <div className="flex items-center justify-between px-5 py-3 border-t border-[--border] shrink-0">
                <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">Artwork · ANA · Base</p>
                <a href={certUrl} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors flex items-center gap-1 border border-[--border] px-2 py-1 hover:border-[--fg]">
                  ◈ Certificate immutable
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Poem / text certificate ──────────────────────────────────────────────────
  const trio = [
    { role: "Author",     name: cert.authorName,     id: cert.authorTokenId },
    { role: "Curator",    name: cert.curatorName,    id: cert.curatorTokenId },
    { role: "Rapporteur", name: cert.rapporteurName, id: cert.rapporteurTokenId },
  ];

  return (
    <div className="border border-[--border] bg-[--bg] flex flex-col">
      {/* Poem preview — click to open full poem modal */}
      <div
        role="button" tabIndex={0}
        onClick={() => setShowModal(true)}
        onKeyDown={e => e.key === "Enter" && setShowModal(true)}
        className="cursor-pointer group overflow-hidden"
      >
        <div className="relative bg-[--bg-card] px-6 pt-6 pb-0 overflow-hidden" style={{ maxHeight: "220px" }}>
          <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-[--fg]">{cert.artworkText}</pre>
          <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-[--bg-card] to-transparent flex items-end justify-center pb-3">
            <span className="font-mono text-[10px] text-[--fg-muted] group-hover:text-[--fg] transition-colors">read in full →</span>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="p-4 space-y-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold text-base leading-tight">{cert.title}</p>
          <span className="font-mono text-xs px-1.5 py-0.5 border border-[--border] text-[--fg-muted] shrink-0">#{workId}</span>
        </div>
        {cert.publishedDate && (
          <p className="font-mono text-[10px] text-[--fg-muted]">{cert.publishedDate}</p>
        )}

        {/* Creation trio */}
        <div className="flex items-center gap-6 pt-1">
          {trio.map(m => (
            <div key={m.role} className="flex flex-col gap-0.5">
              <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">{m.role}</p>
              <p className="font-mono text-xs text-[--fg]">{m.name || (m.id != null ? `#${m.id}` : "—")}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-[--border]">
          <button
            onClick={() => setShowReport(r => !r)}
            className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            {showReport ? "↑ Hide process" : "↓ How it was made"}
          </button>
          <div className="flex items-center gap-3">
            <a href={certUrl} target="_blank" rel="noopener noreferrer"
              className="font-mono text-xs border border-[--border] px-2 py-1 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors flex items-center gap-1">
              <span>◈</span> Certificate
            </a>
            {cert.txHash && (
              <a href={`https://basescan.org/tx/${cert.txHash}`} target="_blank" rel="noopener noreferrer"
                className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors">tx ↗</a>
            )}
          </div>
        </div>
      </div>

      {/* Governance report — parsed from on-chain certificate */}
      {showReport && (
        <div className="border-t border-[--border] bg-[--bg-card] p-4 space-y-4">
          <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">Governance report</p>

          <div className="space-y-1">
            <p className="font-mono text-xs font-semibold">Assembly vote</p>
            <p className="font-mono text-xs">
              <span className="text-green-500">✓ {cert.yes} yes</span>
              {" · "}
              <span className="text-red-400">✗ {cert.no} no</span>
              {" · "}
              <span className="text-[--fg-muted]">– {cert.abs} abstain</span>
            </p>
            {cert.votes.map((v, i) => (
              <p key={i} className="font-mono text-[10px] text-[--fg-muted] leading-relaxed pl-2 border-l border-[--border]">
                {v.vote === "yes" ? "✓" : v.vote === "no" ? "✗" : "–"}{" "}
                <span className="text-[--fg]">{v.name}</span> — {v.reason}
              </p>
            ))}
          </div>

          {cert.brief && (
            <div className="space-y-1">
              <p className="font-mono text-xs font-semibold">Creative brief</p>
              <p className="font-mono text-[10px] text-[--fg-muted] leading-relaxed whitespace-pre-wrap">{cert.brief}</p>
            </div>
          )}

          {cert.stateHistory.length > 0 && (
            <div className="space-y-0.5">
              <p className="font-mono text-xs font-semibold">Process log</p>
              {cert.stateHistory.map((h, i) => (
                <p key={i} className="font-mono text-[10px] text-[--fg-muted]">
                  ▸ <span className="text-[--fg]">{h.state}</span>
                  {h.display.replace(h.state, "").replace(/^—?\s*/, " — ")}
                </p>
              ))}
            </div>
          )}

          {cert.txHash && (
            <p className="font-mono text-[10px] text-[--fg-muted] break-all">
              Base · WorkRegistry · tx:{" "}
              <a href={`https://basescan.org/tx/${cert.txHash}`} target="_blank" rel="noopener noreferrer"
                className="hover:text-[--fg] transition-colors">{cert.txHash}</a>
            </p>
          )}

          <div className="space-y-1.5 pt-2 border-t border-[--border]">
            <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">On-chain proof</p>
            <WorkChainProof onChainId={workId} />
          </div>
        </div>
      )}

      {/* Full poem modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-[--fg]/40"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative flex flex-col bg-[--bg] border border-[--border] w-full max-w-xl max-h-[85vh] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-[--border] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest shrink-0">Poem</p>
                <p className="font-bold text-sm truncate">{cert.title}</p>
              </div>
              <button onClick={() => setShowModal(false)}
                className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors ml-4 shrink-0">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-8 py-10">
              <pre className="font-mono text-sm leading-[2.2] whitespace-pre-wrap text-[--fg] tracking-wide">
                {cert.artworkText}
              </pre>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-[--border] shrink-0">
              <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">
                Poem · ANA · Base{cert.publishedDate ? ` · ${cert.publishedDate}` : ""}
              </p>
              <a href={certUrl} target="_blank" rel="noopener noreferrer"
                className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors flex items-center gap-1 border border-[--border] px-2 py-1 hover:border-[--fg]">
                ◈ Certificate immutable
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── WorkList (published on-chain) ───────────────────────────────────────────

function WorkList({ count, neonWorks, getName }: { count: number; neonWorks: ANAWork[]; getName: GetName }) {
  const neonMap = new Map(
    neonWorks
      .filter(w => w.onChainWorkId != null)
      .map(w => [w.onChainWorkId!, w])
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }, (_, i) => {
        const id       = i;
        const neonWork = neonMap.get(id);
        return neonWork
          ? <WorkCard key={id} work={neonWork} onChainId={id} getName={getName} />
          : <OnChainWorkCard key={id} workId={id} />;
      })}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function WorksClient() {
  const [allWorks,  setAllWorks]  = useState<ANAWork[]>([]);
  const [nameMap,   setNameMap]   = useState<Map<number, string>>(new Map());

  const { data: countRaw, isLoading } = useReadContract({
    address:      WR_ADDR,
    abi:          WORK_REGISTRY_ABI,
    functionName: "getWorkCount",
    query:        { enabled: deployed, refetchInterval: 15_000 },
  });

  const count = Number(countRaw ?? 0);

  useEffect(() => {
    fetch("/api/works")
      .then(r => r.json())
      .then((works: ANAWork[]) => setAllWorks(works))
      .catch(() => null);
  }, []);

  // Batch-resolve real Normie names (stored names may be stale "Normie #XXXX")
  const allTokenIds = useMemo(() => {
    const ids = new Set<number>();
    allWorks.forEach(w => {
      if (w.proposedBy)        ids.add(w.proposedBy);
      if (w.authorTokenId)     ids.add(w.authorTokenId);
      if (w.curatorTokenId)    ids.add(w.curatorTokenId);
      if (w.rapporteurTokenId) ids.add(w.rapporteurTokenId);
    });
    return [...ids];
  }, [allWorks]);

  useEffect(() => {
    const toFetch = allTokenIds.filter(id => !nameMap.has(id));
    if (!toFetch.length) return;
    fetch(`/api/normies/persona?tokenIds=${toFetch.join(",")}`)
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
  }, [allTokenIds]);

  const getName = useCallback<GetName>((tokenId, fallback) => {
    if (!tokenId) return fallback && !fallback.startsWith("Normie #") ? fallback : "—";
    const resolved = nameMap.get(tokenId);
    if (resolved) return resolved;
    if (fallback && !fallback.startsWith("Normie #")) return fallback;
    return `#${tokenId}`;
  }, [nameMap]);

  const publishedWorks = allWorks.filter(w => w.state === "PUBLISHED");
  const activeWorks    = allWorks.filter(w => ACTIVE_STATES.includes(w.state));

  if (!deployed) {
    return (
      <div className="py-24 text-center">
        <p className="font-mono text-xs text-[--fg-muted]">WorkRegistry non configuré.</p>
      </div>
    );
  }

  if (isLoading && allWorks.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 gap-4">
        <div className="w-6 h-6 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        <p className="font-mono text-xs text-[--fg-muted]">Chargement des œuvres…</p>
      </div>
    );
  }

  const isEmpty = count === 0 && activeWorks.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="border border-[--border] bg-[--bg-card] p-10 max-w-lg space-y-4">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Aucune œuvre
          </p>
          <h2 className="text-2xl font-bold">Première œuvre à venir</h2>
          <p className="text-[--fg-muted] leading-relaxed text-sm">
            Une fois l'assemblée constituante résolue, le trio Auteur / Curateur / Rapporteur
            pourra publier la première création de l'ANA on-chain.
          </p>
          <Link
            href="/publish"
            className="inline-flex items-center gap-2 font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80"
          >
            Publier une œuvre →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-16">

      {/* ── Créations en cours ── */}
      {activeWorks.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-1">
                Création en cours
              </p>
              <p className="font-mono text-xs text-[--fg-muted]">
                {activeWorks.length} œuvre{activeWorks.length > 1 ? "s" : ""} dans le pipeline
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[--fg]/60 animate-pulse" />
              <span className="font-mono text-xs text-[--fg-muted]">Live</span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeWorks.map(w => (
              <InProgressWorkCard key={w.id} work={w} getName={getName} />
            ))}
          </div>
        </section>
      )}

      {/* ── Galerie on-chain ── */}
      {count > 0 && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-1">
                Galerie
              </p>
              <p className="font-mono text-xs text-[--fg-muted]">
                {count} œuvre{count > 1 ? "s" : ""} publiée{count > 1 ? "s" : ""} on-chain
              </p>
            </div>
            <Link
              href="/publish"
              className="font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80"
            >
              + Nouvelle œuvre
            </Link>
          </div>
          <WorkList count={count} neonWorks={publishedWorks} getName={getName} />
        </section>
      )}

    </div>
  );
}
