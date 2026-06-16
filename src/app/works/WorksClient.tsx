"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import Image from "next/image";
import Link from "next/link";
import { WORK_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";

// ─── Constants ────────────────────────────────────────────────────────────────

const WR_ADDR   = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;
const CORE_ADDR = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
const deployed  = !!CONTRACT_ADDRESSES.WorkRegistry;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Work {
  id:               bigint;
  content:          string;
  authorTokenId:    bigint;
  curatorTokenId:   bigint;
  rapporteurTokenId:bigint;
  publishedAt:      bigint;
  archived:         boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveWorkSource(raw: string): { type: "onchain"; srcDoc: string } | { type: "unknown" } {
  // Search for the data URI even if garbage bytes precede it (on-chain encoding artefact)
  const idx = raw.indexOf("data:text/html");
  if (idx !== -1) {
    try {
      const cleaned = raw.slice(idx);
      const b64 = cleaned.replace(/^data:text\/html;base64,/, "");
      const html = decodeURIComponent(escape(atob(b64)));
      return { type: "onchain", srcDoc: html };
    } catch {
      return { type: "unknown" };
    }
  }
  return { type: "unknown" };
}

// ─── WorkCard ─────────────────────────────────────────────────────────────────

function WorkCard({ work }: { work: Work }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const source = resolveWorkSource(work.content);
  const date = new Date(Number(work.publishedAt) * 1000);

  return (
    <div className={`border flex flex-col ${work.archived ? "opacity-50 border-[--border]" : "border-[--border]"} bg-[--bg]`}>
      {/* Preview window */}
      {previewOpen && source.type === "onchain" ? (
        <div className="relative aspect-video bg-black overflow-hidden">
          <iframe
            srcDoc={source.srcDoc}
            className="w-full h-full border-0"
            sandbox="allow-scripts"
            title={`Œuvre #${work.id}`}
          />
          <button
            onClick={() => setPreviewOpen(false)}
            className="absolute top-2 right-2 bg-black/70 text-white font-mono text-xs px-2 py-1 hover:bg-black"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => source.type === "onchain" && setPreviewOpen(true)}
          className={`relative aspect-video bg-[--bg-card] overflow-hidden group flex items-center justify-center ${source.type === "onchain" ? "cursor-pointer" : "cursor-default"}`}
        >
          <div className="flex gap-3 items-center">
            {[work.authorTokenId, work.curatorTokenId, work.rapporteurTokenId].map((tid, i) => (
              <div key={i} className="relative w-12 h-12 overflow-hidden">
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
          {source.type === "onchain" ? (
            <div className="absolute inset-0 bg-[--fg]/0 group-hover:bg-[--fg]/5 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="font-mono text-xs bg-[--bg] border border-[--border] px-3 py-1.5">
                Exécuter ▶
              </span>
            </div>
          ) : (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center">
              <span className="font-mono text-[10px] bg-[--bg]/80 text-[--fg-muted] border border-[--border] px-2 py-0.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse inline-block" />
                Récupération depuis la blockchain…
              </span>
            </div>
          )}
        </button>
      )}

      {/* Info */}
      <div className="p-4 space-y-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-sm">Œuvre #{String(work.id)}</p>
            <p className="font-mono text-xs text-[--fg-muted]">
              {date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          {work.archived && (
            <span className="font-mono text-xs px-1.5 py-0.5 border border-[--border] text-[--fg-muted]">
              archivée
            </span>
          )}
        </div>

        {/* Trio */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Auteur",    tid: work.authorTokenId },
            { label: "Curateur", tid: work.curatorTokenId },
            { label: "Rapporteur", tid: work.rapporteurTokenId },
          ].map(({ label, tid }) => (
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
              <p className="font-mono text-xs text-[--fg-muted]">{label}</p>
              <p className="font-mono text-xs">#{String(tid)}</p>
            </div>
          ))}
        </div>

        {/* Source */}
        <div className="flex items-center justify-between pt-1 border-t border-[--border]">
          <p className="font-mono text-xs text-[--fg-muted]">
            {source.type === "onchain" ? "✓ on-chain · exécutable" : "⏳ décodage…"}
          </p>
          <span className="font-mono text-xs text-[--fg-muted]">
            #{String(work.id)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── WorkList ─────────────────────────────────────────────────────────────────

function WorkList({ count }: { count: number }) {
  // Read all works (count is small for now)
  const contracts = Array.from({ length: count }, (_, i) => ({
    address:      WR_ADDR,
    abi:          WORK_REGISTRY_ABI,
    functionName: "getWork" as const,
    args:         [BigInt(i + 1)] as [bigint],
  }));

  const { data } = useReadContract({
    address:      WR_ADDR,
    abi:          WORK_REGISTRY_ABI,
    functionName: "getWorkCount",
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  // For multiple reads, we'll just display work by work
  // In a real app this would use useReadContracts
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }, (_, i) => (
        <WorkCardLoader key={i + 1} workId={i + 1} />
      ))}
    </div>
  );
}

function WorkCardLoader({ workId }: { workId: number }) {
  const [apiContent, setApiContent] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  const { data, isLoading } = useReadContract({
    address:      WR_ADDR,
    abi:          WORK_REGISTRY_ABI,
    functionName: "getWork",
    args:         [BigInt(workId)],
    query: { enabled: deployed },
  });

  const work = data ? (data as unknown as Work) : null;

  // When contract content doesn't parse client-side, fetch via server-side API
  useEffect(() => {
    if (!work) return;
    const source = resolveWorkSource(work.content);
    if (source.type !== "unknown") return; // already parsed OK
    if (apiContent !== null || apiLoading) return;
    console.log(`[WorkCard #${workId}] client content unparseable ("${work.content.slice(0,40)}") — calling API`);
    setApiLoading(true);
    fetch(`/api/works/content/${workId}`)
      .then(r => r.json())
      .then((d: { content?: string; error?: string; source?: string }) => {
        console.log(`[WorkCard #${workId}] API response: source=${d.source} contentLength=${d.content?.length}`);
        if (d.content) setApiContent(d.content);
      })
      .catch(e => console.error(`[WorkCard #${workId}] API error:`, e))
      .finally(() => setApiLoading(false));
  }, [work, workId, apiContent, apiLoading]);

  if (isLoading) {
    return (
      <div className="border border-[--border] bg-[--bg-card] aspect-video flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
      </div>
    );
  }
  if (!work) return null;

  // Merge API content if available
  const merged = apiContent ? { ...work, content: apiContent } : work;
  return <WorkCard work={merged} />;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function WorksClient() {
  const { data: countRaw, isLoading } = useReadContract({
    address:      WR_ADDR,
    abi:          WORK_REGISTRY_ABI,
    functionName: "getWorkCount",
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  const count = Number(countRaw ?? 0);

  if (!deployed) {
    return (
      <div className="py-24 text-center">
        <p className="font-mono text-xs text-[--fg-muted]">WorkRegistry non configuré.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-4">
        <div className="w-6 h-6 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        <p className="font-mono text-xs text-[--fg-muted]">Chargement des œuvres…</p>
      </div>
    );
  }

  if (count === 0) {
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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-[--fg-muted]">
          {count} œuvre{count > 1 ? "s" : ""} publiée{count > 1 ? "s" : ""}
        </p>
        <Link
          href="/publish"
          className="font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80"
        >
          + Nouvelle œuvre
        </Link>
      </div>
      <WorkList count={count} />
    </div>
  );
}
