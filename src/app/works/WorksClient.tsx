"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useReadContract } from "wagmi";
import Image from "next/image";
import Link from "next/link";
import { WORK_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";
import type { ANAWork, WorkState } from "@/lib/workStore";

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

type WorkTab = "none" | "oeuvre" | "certificat";

function WorkCard({ work, onChainId, getName }: { work: ANAWork; onChainId: number; getName: GetName }) {
  const [tab, setTab] = useState<WorkTab>("none");
  const [poemState, setPoemState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [poemText, setPoemText]   = useState<string | null>(null);
  const date = work.publishedAt ? new Date(work.publishedAt) : null;
  const trio = [
    { label: "Auteur",      tid: work.authorTokenId,      name: getName(work.authorTokenId,     work.authorName) },
    { label: "Curateur",    tid: work.curatorTokenId,     name: getName(work.curatorTokenId,    work.curatorName) },
    { label: "Rapporteur",  tid: work.rapporteurTokenId,  name: getName(work.rapporteurTokenId, work.rapporteurName) },
  ];

  const certUrl = `/api/works/html/${onChainId}`;

  // Fetch + parse the HTML certificate on-chain to extract the poem text
  useEffect(() => {
    if (tab !== "oeuvre" || poemState !== "idle") return;
    setPoemState("loading");
    fetch(certUrl)
      .then(r => r.text())
      .then(html => {
        const parser   = new DOMParser();
        const doc      = parser.parseFromString(html, "text/html");
        const sections = Array.from(doc.querySelectorAll("section"));
        for (const section of sections) {
          const lbl = section.querySelector(".lbl");
          if (lbl?.textContent?.startsWith("Œuvre")) {
            const block = section.querySelector(".block");
            const text  = block?.textContent?.trim() ?? null;
            setPoemText(text);
            setPoemState("done");
            return;
          }
        }
        setPoemState("done"); // section absent = œuvre interactive (JS)
      })
      .catch(() => setPoemState("error"));
  }, [tab, poemState, certUrl]);

  return (
    <div className="border border-[--border] bg-[--bg] flex flex-col">
      {/* Preview zone */}
      {tab === "none" ? (
        /* Thumbnail — click to open */
        <button
          onClick={() => setTab("oeuvre")}
          className="relative aspect-video bg-[--bg-card] overflow-hidden group flex items-center justify-center cursor-pointer w-full"
        >
          <div className="flex gap-3 items-center">
            {trio.map(({ label, tid }) =>
              tid != null ? (
                <div key={label} className="relative w-12 h-12 overflow-hidden">
                  <Image src={getNormieImageUrl(tid)} alt={`#${tid}`} fill
                    className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
                </div>
              ) : null
            )}
          </div>
          <div className="absolute inset-0 bg-[--fg]/0 group-hover:bg-[--fg]/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="font-mono text-xs bg-[--bg] border border-[--border] px-3 py-1.5">
              Voir l'œuvre ▶
            </span>
          </div>
        </button>
      ) : (
        /* Viewer avec onglets */
        <div className="flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center border-b border-[--border] bg-[--bg-card]">
            <button
              onClick={() => setTab("oeuvre")}
              className={`font-mono text-xs px-4 py-2 border-r border-[--border] transition-colors ${
                tab === "oeuvre" ? "bg-[--bg] text-[--fg]" : "text-[--fg-muted] hover:text-[--fg]"
              }`}
            >
              Œuvre
            </button>
            <button
              onClick={() => setTab("certificat")}
              className={`font-mono text-xs px-4 py-2 border-r border-[--border] transition-colors ${
                tab === "certificat" ? "bg-[--bg] text-[--fg]" : "text-[--fg-muted] hover:text-[--fg]"
              }`}
            >
              Certificat
            </button>
            <div className="flex-1" />
            {tab === "certificat" && (
              <a
                href={certUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] px-3 py-2 border-l border-[--border] transition-colors"
                title="Ouvrir en pleine page"
              >
                ⤢ pleine page
              </a>
            )}
            <button
              onClick={() => setTab("none")}
              className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] px-3 py-2 border-l border-[--border] transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Onglet Œuvre — texte extrait du certificat on-chain */}
          {tab === "oeuvre" && (
            <div className="bg-[--bg] px-5 py-6 min-h-[120px] max-h-[420px] overflow-y-auto flex items-start">
              {poemState === "loading" && (
                <p className="font-mono text-xs text-[--fg-muted] italic animate-pulse">
                  Lecture on-chain…
                </p>
              )}
              {poemState === "done" && poemText && (
                <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-[--fg] w-full">
                  {poemText}
                </pre>
              )}
              {poemState === "done" && !poemText && (
                <p className="font-mono text-xs text-[--fg-muted] italic">
                  Œuvre interactive — ouvrez le certificat pour exécuter l'œuvre.
                </p>
              )}
              {poemState === "error" && (
                <p className="font-mono text-xs text-[--fg-muted] italic">
                  Erreur de lecture — ouvrez le certificat pour voir l'œuvre.
                </p>
              )}
            </div>
          )}

          {/* Onglet Certificat — exécutable HTML complet */}
          {tab === "certificat" && (
            <div className="relative aspect-video bg-black overflow-hidden">
              <iframe
                src={certUrl}
                className="w-full h-full border-0"
                sandbox="allow-scripts"
                title={work.title}
              />
            </div>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="p-4 space-y-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-sm">{work.title}</p>
            <p className="font-mono text-xs text-[--fg-muted]">
              {date?.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) ?? "—"}
            </p>
          </div>
          <span className="font-mono text-xs px-1.5 py-0.5 border border-[--border] text-[--fg-muted] shrink-0">
            #{onChainId}
          </span>
        </div>

        {work.artworkText && (
          <p className="text-xs text-[--fg-muted] leading-relaxed line-clamp-3 italic border-l-2 border-[--border] pl-2">
            {work.artworkText.slice(0, 200)}{work.artworkText.length > 200 ? "…" : ""}
          </p>
        )}

        {/* Trio */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {trio.map(({ label, tid, name }) => (
            <div key={label} className="space-y-1">
              {tid != null ? (
                <div className="relative w-8 h-8 mx-auto overflow-hidden">
                  <Image
                    src={getNormieImageUrl(tid)}
                    alt={`#${tid}`}
                    fill
                    className="object-contain"
                    style={{ imageRendering: "pixelated" }}
                    unoptimized
                  />
                </div>
              ) : (
                <div className="w-8 h-8 mx-auto bg-[--border]" />
              )}
              <p className="font-mono text-[10px] text-[--fg-muted]">{label}</p>
              <p className="font-mono text-[10px]">{name}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-[--border]">
          <p className="font-mono text-xs text-[--fg-muted]">✓ on-chain · exécutable</p>
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
  );
}

// ─── OnChainWorkCard — fallback when work is not in Neon ─────────────────────

function OnChainWorkCard({ workId }: { workId: number }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useReadContract({
    address:      WR_ADDR,
    abi:          WORK_REGISTRY_ABI,
    functionName: "getWork",
    args:         [BigInt(workId)],
    query:        { enabled: deployed },
  });

  if (isLoading) {
    return (
      <div className="border border-[--border] bg-[--bg-card] aspect-video flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="border border-[--border] bg-[--bg-card] aspect-video flex items-center justify-center">
        <p className="font-mono text-xs text-[--fg-muted]">Œuvre #{workId} introuvable</p>
      </div>
    );
  }

  const w = data as unknown as {
    authorTokenId: bigint; curatorTokenId: bigint; rapporteurTokenId: bigint; publishedAt: bigint;
  };
  const date = new Date(Number(w.publishedAt) * 1000);
  const trio = [
    { label: "Auteur",     tid: w.authorTokenId },
    { label: "Curateur",   tid: w.curatorTokenId },
    { label: "Rapporteur", tid: w.rapporteurTokenId },
  ];

  return (
    <div className="border border-[--border] bg-[--bg] flex flex-col">
      {open ? (
        <div className="relative aspect-video bg-black overflow-hidden">
          <iframe
            src={`/api/works/html/${workId}`}
            className="w-full h-full border-0"
            sandbox="allow-scripts"
            title={`Œuvre #${workId}`}
          />
          <button
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 bg-black/70 text-white font-mono text-xs px-2 py-1 hover:bg-black"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="relative aspect-video bg-[--bg-card] overflow-hidden group flex items-center justify-center cursor-pointer w-full"
        >
          <div className="flex gap-3 items-center">
            {trio.map(({ label, tid }) => (
              <div key={label} className="relative w-12 h-12 overflow-hidden">
                <Image
                  src={getNormieImageUrl(Number(tid))}
                  alt={`#${tid}`}
                  fill
                  className="object-contain"
                  style={{ imageRendering: "pixelated" }}
                  unoptimized
                />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-[--fg]/0 group-hover:bg-[--fg]/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="font-mono text-xs bg-[--bg] border border-[--border] px-3 py-1.5">
              Exécuter ▶
            </span>
          </div>
        </button>
      )}

      <div className="p-4 space-y-3 flex-1">
        <div>
          <p className="font-bold text-sm">Œuvre #{workId}</p>
          <p className="font-mono text-xs text-[--fg-muted]">
            {date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {trio.map(({ label, tid }) => (
            <div key={label} className="space-y-1">
              <div className="relative w-8 h-8 mx-auto overflow-hidden">
                <Image
                  src={getNormieImageUrl(Number(tid))}
                  alt={`#${tid}`}
                  fill
                  className="object-contain"
                  style={{ imageRendering: "pixelated" }}
                  unoptimized
                />
              </div>
              <p className="font-mono text-[10px] text-[--fg-muted]">{label}</p>
              <p className="font-mono text-[10px]">#{String(tid)}</p>
            </div>
          ))}
        </div>

        <div className="pt-1 border-t border-[--border]">
          <p className="font-mono text-xs text-[--fg-muted]">✓ on-chain · exécutable</p>
        </div>
      </div>
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
