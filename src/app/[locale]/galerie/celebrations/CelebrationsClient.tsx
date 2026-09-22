"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther } from "viem";
import { base } from "viem/chains";
import { CELEBRATION_REGISTRY_ABI, ANA_MEMORIALS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
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
  VOTE_OPEN: "Vote in progress", VOTE_TALLIED: "Vote closed",
  PUBLISHING: "Publishing…", PUBLISHED: "Published", REJECTED: "Rejected",
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
 *
 * Payment happens BEFORE this call (RequestMemorialForm pays via
 * ANAMemorials.payForRequest(proposerTokenId) first) — paymentTxHash is
 * proof, verified server-side against the RequestPaid event.
 */
async function requestMemorial(
  tokenId: number, tier: 1 | 2 | 3, requesterWallet: string, paymentTxHash: string, proposerTokenId: number,
  publicSupply?: number, claimDurationSeconds?: number,
): Promise<MemorialResult> {
  try {
    const res = await fetch("/api/celebrations/request-memorial", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tokenId, tier, requesterWallet, paymentTxHash, proposerTokenId, publicSupply, claimDurationSeconds }),
    });
    const data = await res.json();
    if (res.ok) {
      const warn = data.requesterAlreadyEntitledToFreeClaim
        ? " You're also this Normie's last owner — you're already entitled to a separate free edition, no need to pay for this one on top of it."
        : "";
      return { ok: true, workId: data.workId, message: `Memorial created (${data.workId}) by ${data.proposerName} (#${data.proposerTokenId}) — vote in progress.${warn}` };
    }
    return { ok: false, workId: data.workId, message: data.error ?? "Request failed." };
  } catch {
    return { ok: false, message: "Network error." };
  }
}

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: "Just my edition",
  2: "My edition + open to the public",
  3: "My edition + open claim (time-limited)",
};

/**
 * Tier selection, quantity/duration (tiers 2 and 3), wallet, and payment for
 * a targeted memorial request. Payment happens HERE, before the request: the
 * connected wallet calls ANAMemorials.payForRequest(proposerTokenId) for the
 * chosen tier's price — this guarantees the relayer is compensated for
 * creation cost (and split 50/50 with the proposer immediately), whether a
 * public purchase follows or not. The proposer is picked by the verify-burned
 * pre-check BEFORE payment (payForRequest needs to know it to split right
 * away) and reused unchanged server-side. That transaction's hash is sent to
 * /api/celebrations/request-memorial, which verifies it (RequestPaid event)
 * before creating anything. A light pre-check (Normie really burned, not
 * already requested) runs before payment to avoid paying for nothing.
 */
function RequestMemorialForm({ onSubmit, submitting, prefillTokenId }: {
  onSubmit: (tokenId: number, tier: 1 | 2 | 3, wallet: string, paymentTxHash: string, proposerTokenId: number, publicSupply?: number, claimDurationSeconds?: number) => void;
  submitting: boolean;
  prefillTokenId?: number | null;
}) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [tokenId, setTokenId] = useState("");
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [pricing, setPricing] = useState<MemorialPricingConfig | null>(null);
  const [memorialsAddr, setMemorialsAddr] = useState("");
  const [quantity, setQuantity] = useState(10);
  const [durationDays, setDurationDays] = useState(30);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [preCheck, setPreCheck] = useState<{
    burned: boolean; alreadyRequested: boolean; existingState?: string;
    lastOwner: string | null; requesterIsLastOwner: boolean;
    proposerTokenId: number | null; proposerName: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/admin/memorial-pricing").then(r => r.json()).then((cfg: MemorialPricingConfig) => {
      setPricing(cfg);
      setQuantity(cfg.tier2.publicSupply);
      setDurationDays(Math.round((cfg.tier3.claimDurationSeconds ?? 2_592_000) / 86_400));
    }).catch(() => null);
    fetch("/api/memorials/list").then(r => r.json()).then(d => setMemorialsAddr(d.contractAddress ?? "")).catch(() => null);
  }, []);

  useEffect(() => {
    if (prefillTokenId != null) setTokenId(String(prefillTokenId));
  }, [prefillTokenId]);

  // Informational pre-check, shown BEFORE payment — burn status, whether a
  // memorial already exists, and (crucially) whether this wallet is the
  // burned Normie's last owner: if so, exactly 1 edition will ever exist for
  // this event (their own paid edition covers it); otherwise 2 (their paid
  // edition + the last owner's separate free claim). Debounced so typing a
  // tokenId doesn't fire a request per keystroke.
  useEffect(() => {
    const id = parseInt(tokenId, 10);
    if (!Number.isInteger(id) || id < 0) { setPreCheck(null); return; }
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ tokenId: String(id), ...(address ? { requesterWallet: address } : {}) });
      fetch(`/api/celebrations/verify-burned?${qs}`).then(r => r.json()).then(setPreCheck).catch(() => setPreCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [tokenId, address]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(tokenId, 10);
    if (!Number.isInteger(id) || id < 0 || !address || !pricing || !memorialsAddr) return;

    setPayError(null);
    setPaying(true);
    try {
      const check = await fetch(`/api/celebrations/verify-burned?tokenId=${id}&requesterWallet=${address}`).then(r => r.json());
      if (!check.burned) { setPayError("This Normie hasn't been burned."); return; }
      if (check.alreadyRequested) { setPayError(`A memorial already exists for this Normie (${check.existingState}).`); return; }
      if (check.proposerTokenId == null) { setPayError("Couldn't select an ANA proposer — try again."); return; }

      const tierConfig = { 1: pricing.tier1, 2: pricing.tier2, 3: pricing.tier3 }[tier];
      const txHash = await writeContractAsync({
        address:      memorialsAddr as `0x${string}`,
        abi:          ANA_MEMORIALS_ABI,
        functionName: "payForRequest",
        args:         [BigInt(check.proposerTokenId)],
        value:        BigInt(tierConfig.priceWei),
        chainId:      base.id,
      });

      onSubmit(
        id, tier, address, txHash, check.proposerTokenId,
        tier === 2 ? quantity : undefined,
        tier === 3 ? durationDays * 86_400 : undefined,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPayError(msg.includes("User rejected") ? "Payment cancelled." : "Payment failed.");
    } finally {
      setPaying(false);
    }
  }

  const tierConfig = pricing ? { 1: pricing.tier1, 2: pricing.tier2, 3: pricing.tier3 }[tier] : null;
  const busy = submitting || paying;

  return (
    <form onSubmit={e => void submit(e)} className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="number"
          min={0}
          value={tokenId}
          onChange={e => setTokenId(e.target.value)}
          placeholder="Token number"
          className="font-mono text-xs bg-[--bg] border border-[--border] px-2 py-1.5 w-32 text-[--fg]"
        />
        {!address ? (
          <ConnectButton />
        ) : (
          <button
            type="submit"
            disabled={busy || !tokenId || (preCheck != null && (!preCheck.burned || preCheck.alreadyRequested))}
            className="font-mono text-[10px] border border-[--fg] px-2 py-1.5 text-[--fg] hover:bg-[--fg] hover:text-[--bg] transition-colors disabled:opacity-50 disabled:cursor-wait shrink-0"
          >
            {paying ? "Paying…" : submitting ? "…" : "Pay & request a memorial"}
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
              {cfg && <span className="block text-[--fg-muted]">{formatEther(BigInt(cfg.priceWei))} ETH{cfg.publicSupply > 0 ? ` · ${cfg.publicSupply} public` : cfg.openEnded ? " · open" : ""}</span>}
            </button>
          );
        })}
      </div>
      {tier === 2 && (
        <label className="flex items-center gap-2 font-mono text-[10px] text-[--fg-muted]">
          Public editions opened (minimum 10):
          <input
            type="number" min={10} max={500} value={quantity}
            onChange={e => setQuantity(Math.max(10, Math.min(500, parseInt(e.target.value, 10) || 10)))}
            className="font-mono text-xs bg-[--bg] border border-[--border] px-2 py-1 w-20 text-[--fg]"
          />
        </label>
      )}
      {tier === 3 && (
        <label className="flex items-center gap-2 font-mono text-[10px] text-[--fg-muted]">
          Open claim duration (days):
          <input
            type="number" min={1} max={90} value={durationDays}
            onChange={e => setDurationDays(Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)))}
            className="font-mono text-xs bg-[--bg] border border-[--border] px-2 py-1 w-20 text-[--fg]"
          />
        </label>
      )}
      {preCheck && preCheck.burned && !preCheck.alreadyRequested && (
        <p className="font-mono text-[10px] text-amber-400">
          {preCheck.lastOwner == null
            ? "Couldn't find this Normie's last owner — the free claim can't be configured for this event."
            : preCheck.requesterIsLastOwner
            ? "You're this Normie's last owner: only one edition will be created, yours — no separate free claim."
            : "You're not this Normie's last owner: 2 editions will be created — yours (paid) and a free one reserved for the last owner."}
          {preCheck.proposerName && ` Proposer: ${preCheck.proposerName} (#${preCheck.proposerTokenId}) — half your payment goes to them.`}
        </p>
      )}
      {preCheck && !preCheck.burned && (
        <p className="font-mono text-[10px] text-red-400">This Normie hasn&apos;t been burned.</p>
      )}
      {preCheck?.alreadyRequested && (
        <p className="font-mono text-[10px] text-red-400">A memorial already exists for this Normie ({preCheck.existingState}).</p>
      )}
      {tierConfig && (
        <p className="font-mono text-[10px] text-[--fg-muted]">
          Payment ({formatEther(BigInt(tierConfig.priceWei))} ETH) happens right away — it covers your reserved edition,
          which you can claim for free once the memorial is published, from &quot;Memorial editions&quot; below.
        </p>
      )}
      {payError && <p className="font-mono text-[10px] text-red-400">{payError}</p>}
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

  async function handleRequestMemorial(
    tokenId: number, tier: 1 | 2 | 3, wallet: string, paymentTxHash: string, proposerTokenId: number,
    publicSupply?: number, claimDurationSeconds?: number,
  ) {
    setRequestingTokenId(tokenId);
    const result = await requestMemorial(tokenId, tier, wallet, paymentTxHash, proposerTokenId, publicSupply, claimDurationSeconds);
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

      {/* ── Request a memorial — triggers the pipeline without waiting for the cron ── */}
      <div id="request-memorial-form" className="border border-[--border] bg-[--bg-card] p-6 space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Request a memorial</p>
        <p className="font-mono text-[11px] text-[--fg-muted]">
          Hover a Normie below and click "◈ Memorial", or type a token number directly.
          An ANA member is picked to create the memorial — their piece is generated instantly, then submitted to the other members' vote as moderation.
          Choose a tier below: payment happens right away, before the memorial even exists — it covers your reserved edition, which
          you can then claim for free once the memorial is published.
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
                      title={`Already ${STATE_LABEL[existing.state] ?? existing.state}`}
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
                      title={`Request a memorial for #${b.tokenId} — choose a tier above`}
                    >
                      ◈ Memorial
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
