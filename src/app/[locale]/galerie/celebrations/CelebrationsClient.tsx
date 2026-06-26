"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { CELEBRATION_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";

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

interface ClaimableCelebration {
  celebrationId: number;
  eventType:     number;
  normieTokenId: number;
  editionsAddr:  string;
  workTitle:     string;
  claimableNow:  boolean;
}

const EVENT_TYPE_LABEL: Record<number, string> = {
  0: "Burn", 1: "Canvas transform", 2: "Zombie conversion", 3: "Legendary Canvas", 4: "Agent awakening",
};

/** Lets the connected wallet sponsor-claim a free edition for an event ANA honored it with. */
function ClaimableCelebrations() {
  const t = useTranslations("celebrations");
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [items,   setItems]   = useState<ClaimableCelebration[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [claimedIds, setClaimedIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setItems([]); return; }
    setLoading(true);
    fetch(`/api/celebrations/claimable?address=${address}`)
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d.claimable) ? d.claimable : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [address]);

  if (!address || loading || items.length === 0) return null;

  const registryAddr = CONTRACT_ADDRESSES.CelebrationRegistry as `0x${string}`;

  async function handleClaim(celebrationId: number) {
    setClaimingId(celebrationId);
    setError(null);
    try {
      await writeContractAsync({
        address:      registryAddr,
        abi:          CELEBRATION_REGISTRY_ABI,
        functionName: "claim",
        args:         [BigInt(celebrationId)],
      });
      setClaimedIds(ids => [...ids, celebrationId]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") ? t("claim.cancelled") : t("claim.failed"));
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="border border-[--border] bg-[--bg-card] p-6 space-y-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("claim.heading")}</p>
      <div className="space-y-2">
        {items.map(c => {
          const claimed = claimedIds.includes(c.celebrationId);
          return (
            <div key={c.celebrationId} className="flex items-center justify-between gap-3 border-b border-[--border] pb-2 last:border-0 last:pb-0">
              <div>
                <p className="font-bold text-sm">{c.workTitle}</p>
                <p className="font-mono text-[10px] text-[--fg-muted]">
                  {EVENT_TYPE_LABEL[c.eventType] ?? "Event"} — Normie #{c.normieTokenId}
                </p>
              </div>
              {claimed ? (
                <p className="font-mono text-[10px] text-green-400 border border-green-400/30 px-2 py-1 shrink-0">
                  ✓ {t("claim.acquired")}
                </p>
              ) : !c.claimableNow ? (
                <p className="font-mono text-[10px] text-[--fg-muted] border border-[--border] px-2 py-1 shrink-0">
                  {t("claim.notReady")}
                </p>
              ) : (
                <button
                  onClick={() => void handleClaim(c.celebrationId)}
                  disabled={claimingId === c.celebrationId}
                  className="font-mono text-[10px] border border-[--fg] px-2 py-1 text-[--fg] hover:bg-[--fg] hover:text-[--bg] transition-colors disabled:opacity-50 disabled:cursor-wait shrink-0"
                >
                  {claimingId === c.celebrationId ? t("claim.confirming") : t("claim.cta")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}
    </div>
  );
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

      {/* ── Sponsored claims for the connected wallet, if any ── */}
      <ClaimableCelebrations />

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
