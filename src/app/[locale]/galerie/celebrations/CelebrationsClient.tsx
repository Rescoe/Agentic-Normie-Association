"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther } from "viem";
import { CELEBRATION_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { MemorialMintPanel } from "./MemorialMintPanel";
import type { MemorialPricingConfig } from "@/lib/memorialPricing";

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

interface MemorialResult {
  ok: boolean;
  message: string;
  workId?: string;
}

interface MemorialWork {
  id:              string;
  title:           string;
  state:           string;
  burnedTokenId?:  number;
  proposedBy:      number;
  proposedByName:  string;
  artworkText?:    string; // BMP data URI, present as soon as the work exists
  cartelText?:     string; // artist statement
}

const STATE_LABEL: Record<string, string> = {
  VOTE_OPEN: "Vote en cours", VOTE_TALLIED: "Vote clos",
  PUBLISHING: "Publication…", PUBLISHED: "Publié", REJECTED: "Rejeté",
};

/**
 * Lets any visitor nominate a burned Normie (from the list above, or by
 * typing a tokenId) for a memorial work — instead of waiting for the
 * check-burns cron's aggregate detection. Mainly a way to test the full
 * celebration → vote → proof-of-draw pipeline on demand, but also a real
 * path for the community to flag a burn ANA missed. The memorial itself
 * (a real creative act by the member picked to propose it, informed by the
 * burned Normie's persona — see memorialArt.ts) is created instantly; only
 * the member vote that moderates it takes any time.
 */
async function requestMemorial(tokenId: number, tier: 1 | 2 | 3, requesterWallet: string): Promise<MemorialResult> {
  try {
    const res = await fetch("/api/celebrations/request-memorial", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tokenId, tier, requesterWallet }),
    });
    const data = await res.json();
    if (res.ok) {
      const warn = data.requesterAlreadyEntitledToFreeClaim
        ? " Tu es aussi l'ancien propriétaire de ce Normie — tu as déjà droit à une édition gratuite séparée, pas besoin de payer pour celle-ci en plus."
        : "";
      return { ok: true, workId: data.workId, message: `Mémorial créé (${data.workId}) par ${data.proposerName} (#${data.proposerTokenId}) — vote en cours.${warn}` };
    }
    return { ok: false, workId: data.workId, message: data.error ?? "Échec de la demande." };
  } catch {
    return { ok: false, message: "Erreur réseau." };
  }
}

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: "Juste mon édition",
  2: "Mon édition + ouvrir au public",
  3: "Mon édition + claim ouvert (durée limitée)",
};

/**
 * Tier selection + wallet capture for a paid memorial request. No payment
 * happens here — the requester's wallet is just reserved a slot in the
 * memorial's "requester" pool (see MemorialMintPanel); they pay later by
 * calling mintRequester() themselves once the memorial is PUBLISHED. Pricing
 * is fetched from /api/admin/memorial-pricing (GET is public) so the numbers
 * shown always match what registerMemorial() will actually use.
 */
function RequestMemorialForm({ onSubmit, submitting, prefillTokenId }: {
  onSubmit: (tokenId: number, tier: 1 | 2 | 3, wallet: string) => void;
  submitting: boolean;
  prefillTokenId?: number | null;
}) {
  const { address } = useAccount();
  const [tokenId, setTokenId] = useState("");
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [pricing, setPricing] = useState<MemorialPricingConfig | null>(null);

  useEffect(() => {
    fetch("/api/admin/memorial-pricing").then(r => r.json()).then(setPricing).catch(() => null);
  }, []);

  useEffect(() => {
    if (prefillTokenId != null) setTokenId(String(prefillTokenId));
  }, [prefillTokenId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(tokenId, 10);
    if (Number.isInteger(id) && id >= 0 && address) onSubmit(id, tier, address);
  }

  const tierConfig = pricing ? { 1: pricing.tier1, 2: pricing.tier2, 3: pricing.tier3 }[tier] : null;

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          min={0}
          value={tokenId}
          onChange={e => setTokenId(e.target.value)}
          placeholder="Numéro de token"
          className="font-mono text-xs bg-[--bg] border border-[--border] px-2 py-1.5 w-32 text-[--fg]"
        />
        {!address ? (
          <ConnectButton />
        ) : (
          <button
            type="submit"
            disabled={submitting || !tokenId}
            className="font-mono text-[10px] border border-[--fg] px-2 py-1.5 text-[--fg] hover:bg-[--fg] hover:text-[--bg] transition-colors disabled:opacity-50 disabled:cursor-wait shrink-0"
          >
            {submitting ? "…" : "Demander un mémorial"}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {([1, 2, 3] as const).map(t => {
          const cfg = pricing ? { 1: pricing.tier1, 2: pricing.tier2, 3: pricing.tier3 }[t] : null;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={`font-mono text-[10px] border px-2 py-1 text-left ${tier === t ? "border-[--fg] text-[--fg]" : "border-[--border] text-[--fg-muted]"}`}
            >
              {TIER_LABEL[t]}
              {cfg && <span className="block text-[--fg-muted]">{formatEther(BigInt(cfg.priceWei))} ETH{cfg.publicSupply > 0 ? ` · ${cfg.publicSupply} publiques` : cfg.openEnded ? " · ouvert" : ""}</span>}
            </button>
          );
        })}
      </div>
      {tierConfig && (
        <p className="font-mono text-[10px] text-[--fg-muted]">
          Ton édition n&apos;est pas payée maintenant — une fois le mémorial publié, tu la réclames toi-même (et tu payes alors) depuis la section &quot;Éditions des mémoriaux&quot; plus bas.
        </p>
      )}
    </form>
  );
}

export function CelebrationsClient() {
  const t = useTranslations("celebrations");
  const [stats, setStats]   = useState<BurnStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [memorials, setMemorials] = useState<MemorialWork[]>([]);
  const [memorialResult, setMemorialResult] = useState<MemorialResult | null>(null);
  const [requestingTokenId, setRequestingTokenId] = useState<number | null>(null);
  const [prefillTokenId, setPrefillTokenId] = useState<number | null>(null);

  const loadMemorials = useCallback(() => {
    fetch("/api/celebrations/list")
      .then(res => res.json())
      .then(data => setMemorials(Array.isArray(data.works) ? data.works : []))
      .catch(() => setMemorials([]));
  }, []);

  async function handleRequestMemorial(tokenId: number, tier: 1 | 2 | 3, wallet: string) {
    setRequestingTokenId(tokenId);
    const result = await requestMemorial(tokenId, tier, wallet);
    setMemorialResult(result);
    setRequestingTokenId(null);
    if (result.ok) loadMemorials();
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/burns/stats")
      .then(res => res.json())
      .then(data => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStats({ totalBurned: 0, totalSupply: 10000, recentBurns: [], error: "fetch_failed" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    loadMemorials();
    return () => { cancelled = true; };
  }, [loadMemorials]);

  const memorialByTokenId = new Map(memorials.filter(m => m.burnedTokenId != null).map(m => [m.burnedTokenId!, m]));

  if (loading) {
    return <p className="font-mono text-xs text-[--fg-muted]">{t("loading")}</p>;
  }

  if (!stats || stats.error) {
    return <p className="font-mono text-xs text-[--fg-muted]">{t("loadError")}</p>;
  }

  const remaining = stats.totalSupply - stats.totalBurned;

  return (
    <div className="space-y-16">

      {/* ── Sponsored claims for the connected wallet, if any (legacy, per-work collections) ── */}
      <ClaimableCelebrations />

      {/* ── Mint/claim panel for the shared ANAMemorials collection ── */}
      <MemorialMintPanel />

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

      {/* ── Demander un mémorial : déclenche la pipeline sans attendre le cron ── */}
      <div id="request-memorial-form" className="border border-[--border] bg-[--bg-card] p-6 space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Demander un mémorial</p>
        <p className="font-mono text-[11px] text-[--fg-muted]">
          Survole un Normie ci-dessous et clique « ◈ Mémorial », ou entre directement un numéro de token.
          Un membre ANA est sélectionné au hasard pour créer le mémorial — sa pièce est générée instantanément, puis soumise au vote des autres membres comme modération.
          Choisis un palier : ton wallet est connecté, mais rien n&apos;est débité maintenant — tu payes plus tard en réclamant ton édition une fois le mémorial publié.
        </p>
        <RequestMemorialForm onSubmit={handleRequestMemorial} submitting={requestingTokenId != null} prefillTokenId={prefillTokenId} />
        {memorialResult && (
          <p className={`font-mono text-[11px] ${memorialResult.ok ? "text-green-400" : "text-red-400"}`}>
            {memorialResult.message}
          </p>
        )}

        {memorials.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2 border-t border-[--border]">
            {memorials.map(m => (
              <div key={m.id} className="border border-[--border] bg-[--bg] p-2 space-y-1">
                {m.artworkText && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={m.artworkText} alt={m.title} className="w-full" style={{ imageRendering: "pixelated" }} />
                )}
                <p className="font-mono text-[10px] text-[--fg-muted] truncate" title={m.title}>
                  {m.burnedTokenId != null ? `#${m.burnedTokenId} — ` : ""}{m.title}
                </p>
                <p className={`font-mono text-[10px] ${m.state === "PUBLISHED" ? "text-green-400" : m.state === "REJECTED" ? "text-red-400" : "text-[--fg-muted]"}`}>
                  {STATE_LABEL[m.state] ?? m.state}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Recent burns grid ── */}
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-6">{t("recent.label")}</p>
        {stats.recentBurns.length === 0 ? (
          <p className="font-mono text-xs text-[--fg-muted]">{t("recent.empty")}</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-px bg-[--border]">
            {stats.recentBurns.map(b => {
              const existing = memorialByTokenId.get(b.tokenId);
              return (
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
                  {existing ? (
                    <span
                      className="absolute top-1 right-1 font-mono text-[9px] bg-[--bg] border border-[--border] px-1 py-0.5 text-green-400"
                      title={`Mémorial déjà ${STATE_LABEL[existing.state] ?? existing.state}`}
                    >
                      ✓ {STATE_LABEL[existing.state] ?? existing.state}
                    </span>
                  ) : (
                    <button
                      onClick={e => {
                        e.preventDefault(); e.stopPropagation();
                        setPrefillTokenId(b.tokenId);
                        document.getElementById("request-memorial-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className="absolute top-1 right-1 font-mono text-[9px] bg-[--bg] border border-[--border] px-1 py-0.5 text-[--fg-muted] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[--fg]"
                      title={`Demander un mémorial pour #${b.tokenId} — choisis un palier ci-dessus`}
                    >
                      ◈ Mémorial
                    </button>
                  )}
                </a>
              );
            })}
          </div>
        )}
        <p className="font-mono text-[11px] text-[--fg-muted] mt-4">{t("recent.footnote")}</p>
      </div>

    </div>
  );
}
