"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface RecentBurn {
  tokenId: number;
  burnedAt: string;
  imageUrl: string;
}

interface BurnStats {
  totalBurned: number;
  recentBurns: RecentBurn[];
  error?: string;
}

/**
 * Connects the memorial gallery back to the events it responds to. The data
 * comes from the existing edge-cached burn endpoint (api.normies.art), so this
 * preview does not add a Neon read to the public page.
 */
export function RecentBurnsPreview() {
  const [stats, setStats] = useState<BurnStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/burns/stats")
      .then(res => {
        if (!res.ok) throw new Error(`Burn stats request failed: ${res.status}`);
        return res.json() as Promise<BurnStats>;
      })
      .then(data => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  const recent = stats?.recentBurns?.slice(0, 12) ?? [];

  return (
    <section className="border border-[--border] bg-[--bg-card] p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Live burn record
          </p>
          <h2 className="text-2xl font-bold">The latest burned Normies</h2>
          <p className="text-sm text-[--fg-muted] leading-relaxed max-w-2xl">
            Burns are events; memorials are the works ANA creates in response. Open the tracker to inspect every recent burn, verify its transaction, or request a memorial.
          </p>
        </div>
        <Link href="/burns" className="font-mono text-xs border border-[--fg] px-4 py-2 hover:bg-[--fg] hover:text-[--bg] transition-colors shrink-0 w-fit">
          View all burns →
        </Link>
      </div>

      {!stats && !failed && (
        <p className="font-mono text-xs text-[--fg-muted]">Loading the latest burns…</p>
      )}

      {failed && (
        <p className="font-mono text-xs text-[--fg-muted]">
          The live preview is temporarily unavailable. The complete burn tracker remains accessible above.
        </p>
      )}

      {stats && recent.length === 0 && (
        <p className="font-mono text-xs text-[--fg-muted]">No burns have been recorded yet.</p>
      )}

      {recent.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-px bg-[--border]">
          {recent.map(burn => (
            <Link
              key={burn.tokenId}
              href={`/burns?tokenId=${burn.tokenId}`}
              className="relative aspect-square bg-[--bg] overflow-hidden group"
              title={`Normie #${burn.tokenId} · burned ${new Date(burn.burnedAt).toLocaleDateString("en-US")}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={burn.imageUrl}
                alt={`Burned Normie #${burn.tokenId}`}
                className="w-full h-full object-cover grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all"
              />
              <span className="absolute bottom-1 left-1 font-mono text-[9px] bg-[--bg]/90 px-1 text-[--fg]">
                #{burn.tokenId}
              </span>
            </Link>
          ))}
        </div>
      )}

      {stats && (
        <p className="font-mono text-[10px] text-[--fg-muted]">
          {stats.totalBurned.toLocaleString("en-US")} burned in total · live data from api.normies.art
        </p>
      )}
    </section>
  );
}
