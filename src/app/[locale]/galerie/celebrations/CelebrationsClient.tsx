"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

interface RecentBurn {
  tokenId:     number;
  txHash:      string;
  blockNumber: string;
  burnedAt:    string;
  imageUrl:    string;
}

interface BurnStats {
  totalBurned: number;
  totalSupply: number;
  recentBurns: RecentBurn[];
  error?:      string;
}

export function CelebrationsClient() {
  const t = useTranslations("celebrations");
  const [stats, setStats]   = useState<BurnStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/burns/stats")
      .then(res => res.json())
      .then(data => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStats({ totalBurned: 0, totalSupply: 10000, recentBurns: [], error: "fetch_failed" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <p className="font-mono text-xs text-[--fg-muted]">{t("loading")}</p>;
  }

  if (!stats || stats.error) {
    return <p className="font-mono text-xs text-[--fg-muted]">{t("loadError")}</p>;
  }

  const remaining = stats.totalSupply - stats.totalBurned;

  return (
    <div className="space-y-16">

      {/* ── Live counter — read straight from api.normies.art, no copy kept ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[--border]">
        <div className="bg-[--bg-card] p-6 space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("counter.burned")}</p>
          <p className="text-4xl font-bold tabular-nums">{stats.totalBurned.toLocaleString("en-US")}</p>
        </div>
        <div className="bg-[--bg-card] p-6 space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("counter.remaining")}</p>
          <p className="text-4xl font-bold tabular-nums">{remaining.toLocaleString("en-US")}</p>
        </div>
        <div className="bg-[--bg-card] p-6 space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("counter.total")}</p>
          <p className="text-4xl font-bold tabular-nums">{stats.totalSupply.toLocaleString("en-US")}</p>
        </div>
      </div>

      {/* ── Recent burns grid ── */}
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-6">{t("recent.label")}</p>
        {stats.recentBurns.length === 0 ? (
          <p className="font-mono text-xs text-[--fg-muted]">{t("recent.empty")}</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-px bg-[--border]">
            {stats.recentBurns.map(b => (
              <a
                key={b.tokenId}
                href={`https://etherscan.io/tx/${b.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[--bg-card] aspect-square relative group"
                title={`#${b.tokenId} — ${new Date(b.burnedAt).toLocaleDateString()}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.imageUrl}
                  alt={`Normie #${b.tokenId}`}
                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all"
                />
                <span className="absolute bottom-1 left-1 font-mono text-[10px] bg-[--bg] px-1 text-[--fg-muted]">
                  #{b.tokenId}
                </span>
              </a>
            ))}
          </div>
        )}
        <p className="font-mono text-[11px] text-[--fg-muted] mt-4">{t("recent.footnote")}</p>
      </div>

    </div>
  );
}
