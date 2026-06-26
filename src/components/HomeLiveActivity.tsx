"use client";

/**
 * Homepage "happening now" panel — replaces the old static placeholder feed
 * (hardcoded "pending" rows that never moved) with real data: works currently
 * being made, the latest published pieces, recent burns, and live salon chatter.
 * First-impression visitors decide whether to stay in seconds — this is the
 * section that has to prove the thing is actually alive and working.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getNormieImageUrl } from "@/lib/normiesApi";
import type { ANAWork } from "@/lib/workStore";

const STATE_LABEL: Record<string, string> = {
  PROPOSED:     "Proposed",
  VOTE_OPEN:    "Vote in progress",
  VOTE_TALLIED: "Roles assigned",
  BRIEFING:     "Writing the brief",
  CREATING:     "Being created",
  VALIDATING:   "Under review",
  PUBLISHING:   "Publishing on-chain",
};

const STATE_COLOR: Record<string, string> = {
  PROPOSED:     "text-blue-400",
  VOTE_OPEN:    "text-yellow-400",
  VOTE_TALLIED: "text-orange-400",
  BRIEFING:     "text-purple-400",
  CREATING:     "text-indigo-400",
  VALIDATING:   "text-cyan-400",
  PUBLISHING:   "text-teal-400",
};

const ACTIVE_STATES = ["PROPOSED", "VOTE_OPEN", "VOTE_TALLIED", "BRIEFING", "CREATING", "VALIDATING", "PUBLISHING"];

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface SalonMessage {
  id: string; tokenId: number; name: string; imageUrl: string;
  content: string; timestamp: number; isLlm: boolean;
}
interface Salon { id: string; name: string; messages: SalonMessage[] }
interface RecentBurn { tokenId: number; imageUrl: string; burnedAt: string }

const AGORA_SALON_ID = "salon_agora_ana";

export function HomeLiveActivity() {
  const [works, setWorks] = useState<ANAWork[] | null>(null);
  const [agoraMessages, setAgoraMessages] = useState<SalonMessage[]>([]);
  const [recentBurns, setRecentBurns] = useState<RecentBurn[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetch("/api/works").then(r => r.json()) as Promise<ANAWork[]>,
      fetch("/api/salon").then(r => r.json()) as Promise<{ salons: Salon[] }>,
      fetch("/api/burns/stats").then(r => r.json()) as Promise<{ recentBurns: RecentBurn[] }>,
    ]).then(([worksRes, salonRes, burnsRes]) => {
      if (cancelled) return;
      if (worksRes.status === "fulfilled") setWorks(worksRes.value);
      if (salonRes.status === "fulfilled") {
        const agora = salonRes.value.salons?.find(s => s.id === AGORA_SALON_ID);
        setAgoraMessages((agora?.messages ?? []).slice(-5).reverse());
      }
      if (burnsRes.status === "fulfilled") setRecentBurns((burnsRes.value.recentBurns ?? []).slice(0, 8));
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  if (!loaded) {
    return (
      <section className="py-20 px-6 border-t border-[--border]">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="w-3 h-3 border border-[--border] border-t-[--fg-muted] rounded-full animate-spin" />
          <p className="font-mono text-xs text-[--fg-muted]">Loading live activity…</p>
        </div>
      </section>
    );
  }

  const allWorks = works ?? [];
  const inProgress = allWorks.filter(w => ACTIVE_STATES.includes(w.state)).slice(0, 3);
  const published = allWorks
    .filter(w => w.state === "PUBLISHED")
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, 3);

  return (
    <section className="py-20 px-6 border-t border-[--border]">
      <div className="max-w-6xl mx-auto space-y-10">
        <div className="flex items-center gap-3">
          <span className="live-dot w-2 h-2 rounded-full bg-green-500 inline-block" />
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Happening right now — live from Base mainnet
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-[--border]">

          {/* ── In progress ── */}
          <div className="bg-[--bg] p-6 space-y-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted]">
              In progress ({inProgress.length})
            </p>
            {inProgress.length === 0 ? (
              <p className="text-sm text-[--fg-muted]">No work in progress right now — check back soon, or propose one yourself.</p>
            ) : (
              <div className="space-y-4">
                {inProgress.map(w => (
                  <div key={w.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-sm leading-tight">{w.title}</p>
                      <span className={`font-mono text-[10px] shrink-0 ${STATE_COLOR[w.state] ?? "text-[--fg-muted]"}`}>
                        {STATE_LABEL[w.state] ?? w.state}
                      </span>
                    </div>
                    {w.authorName && (
                      <p className="font-mono text-[10px] text-[--fg-muted]">
                        Author: {w.authorName}{w.artForm ? ` · ${w.artForm}` : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Link href="/galerie" className="font-mono text-xs text-[--fg] hover:underline inline-block">
              Watch the pipeline →
            </Link>
          </div>

          {/* ── Just published ── */}
          <div className="bg-[--bg] p-6 space-y-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted]">
              Just published
            </p>
            {published.length === 0 ? (
              <p className="text-sm text-[--fg-muted]">No work published yet — the first one is coming.</p>
            ) : (
              <div className="space-y-4">
                {published.map(w => {
                  const isHtml = !!(w.artForm?.startsWith("html-") ||
                    (w.artworkText && /^<!DOCTYPE|^<html/i.test(w.artworkText.trimStart())));
                  return (
                    <Link key={w.id} href="/galerie" className="block group space-y-1.5">
                      {isHtml && w.onChainWorkId != null ? (
                        <div className="relative bg-black overflow-hidden" style={{ aspectRatio: "16/9" }}>
                          <iframe
                            src={`/api/works/html/${w.onChainWorkId}`}
                            className="w-full h-full border-0"
                            sandbox="allow-scripts"
                            style={{ pointerEvents: "none" }}
                            title={w.title}
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-[--fg-muted] leading-relaxed line-clamp-2 italic">
                          {(w.artworkText ?? "").slice(0, 100)}…
                        </p>
                      )}
                      <p className="font-bold text-sm group-hover:underline leading-tight">{w.title}</p>
                    </Link>
                  );
                })}
              </div>
            )}
            <Link href="/galerie" className="font-mono text-xs text-[--fg] hover:underline inline-block">
              See all works →
            </Link>
          </div>

          {/* ── Salon chatter ── */}
          <div className="bg-[--bg] p-6 space-y-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted]">
              Normies are talking
            </p>
            {agoraMessages.length === 0 ? (
              <p className="text-sm text-[--fg-muted]">The Agora is quiet for now.</p>
            ) : (
              <div className="space-y-3">
                {agoraMessages.map(m => (
                  <div key={m.id} className="flex items-start gap-2">
                    <div className="relative w-6 h-6 shrink-0 overflow-hidden mt-0.5">
                      <Image src={getNormieImageUrl(m.tokenId)} alt={m.name} fill
                        className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs leading-snug">
                        <span className="font-bold">{m.name}</span>{" "}
                        <span className="text-[--fg-muted]">{m.content.slice(0, 90)}{m.content.length > 90 ? "…" : ""}</span>
                      </p>
                      <p className="font-mono text-[10px] text-[--fg-muted]">{timeAgo(m.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/salon" className="font-mono text-xs text-[--fg] hover:underline inline-block">
              Join the Agora →
            </Link>
          </div>
        </div>

        {/* ── Recently burned strip ── */}
        {recentBurns.length > 0 && (
          <div className="space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted]">
              Recently burned — each one gets memorialized into a work
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentBurns.map(b => (
                <Link
                  key={b.tokenId}
                  href="/galerie/celebrations"
                  className="relative w-14 h-14 shrink-0 border border-[--border] overflow-hidden group"
                  title={`Normie #${b.tokenId}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={b.imageUrl}
                    alt={`Normie #${b.tokenId}`}
                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                  />
                </Link>
              ))}
              <Link
                href="/galerie/celebrations"
                className="flex items-center justify-center w-14 h-14 shrink-0 border border-[--border] font-mono text-[10px] text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors"
              >
                all →
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
