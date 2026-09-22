"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useMemorialMint } from "../useMemorialMint";
import { ScreenPreviewGrid } from "../ScreenPreviewGrid";

interface WorkDetail {
  id: string;
  title: string;
  state: string;
  proposedByName: string;
  proposedBy: number;
  cartelText?: string;
  artworkText?: string;
  isBurnMemorial?: boolean;
  burnedTokenId?: number;
  burnedTokenIds?: number[];
  memorialKind?: "batch" | "requested" | "milestone";
  memorialMilestoneNumber?: number;
  memorialTotalBurnedAtMilestone?: number;
  onChainMemorialId?: number;
}

interface MemorialDetail {
  contractAddress: string;
  memorialId: number;
  kind: string;
  honoredBurnCount: number;
  workId: number;
  creatorName: string;
  creatorProposerTokenId: number;
  creatorAddr: string;
  creatorUsesVault: boolean;
  priceWei: string;
  publicSupply: number;
  publicMinted: number;
  requesterSupply: number;
  requesterMinted: number;
  requesterAddr: string;
  openEnded: boolean;
  claimDeadline: number;
  mintedInSeries: number;
  burnedTokenIds: Array<{ tokenId: number; reservedRecipient: string; reservedClaimed: boolean }>;
}

const STATE_LABEL: Record<string, string> = {
  VOTE_OPEN: "Vote in progress", VOTE_TALLIED: "Vote closed",
  PUBLISHING: "Publishing…", PUBLISHED: "Published", REJECTED: "Rejected",
};

function TraitBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[--bg] p-3">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[--fg-muted]">{label}</p>
      <p className="font-mono text-xs mt-0.5 break-words">{value}</p>
    </div>
  );
}

export function MemorialDetailClient({ id }: { id: string }) {
  const { address } = useAccount();
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [detail, setDetail] = useState<MemorialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const wr = await fetch(`/api/works/${id}`);
      if (!wr.ok) { setNotFound(true); return; }
      const { work: w } = await wr.json() as { work: WorkDetail };
      setWork(w);
      if (w.onChainMemorialId != null) {
        const mr = await fetch(`/api/memorials/${w.onChainMemorialId}`);
        if (mr.ok) setDetail(await mr.json());
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const { mint, pendingKey, error } = useMemorialMint(detail?.contractAddress ?? "", () => void load());

  if (loading) return <p className="font-mono text-xs text-[--fg-muted]">Loading…</p>;
  if (notFound || !work) return <p className="font-mono text-xs text-[--fg-muted]">This memorial doesn&apos;t exist.</p>;

  const now = Math.floor(Date.now() / 1000);
  const publicAvailable = !!detail && (detail.openEnded ? now < detail.claimDeadline : detail.publicMinted < detail.publicSupply);
  const myReserved = detail && address
    ? detail.burnedTokenIds.find(b => !b.reservedClaimed && b.reservedRecipient.toLowerCase() === address.toLowerCase())
    : undefined;
  const isRequester = !!detail && !!address && detail.requesterAddr.toLowerCase() === address.toLowerCase()
    && detail.requesterMinted < detail.requesterSupply;
  const priceEth = detail ? formatEther(BigInt(detail.priceWei || "0")) : "0";
  const honoredTokenIds = work.burnedTokenIds ?? (work.burnedTokenId != null ? [work.burnedTokenId] : []);
  const noEditionAvailable = !!detail && !myReserved && !isRequester && !publicAvailable;

  return (
    <div className="space-y-8">
      <Link href="/galerie/celebrations" className="font-mono text-[10px] text-[--fg-muted] hover:text-[--fg]">
        ← Back to Burns
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {work.artworkText && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={work.artworkText}
            alt={work.title}
            className="w-full border border-[--border]"
            style={{ imageRendering: "pixelated" }}
          />
        )}

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold">{work.title}</h1>
            <p className="font-mono text-xs text-[--fg-muted] mt-1">
              by {work.proposedByName} (Normie #{work.proposedBy})
            </p>
          </div>

          {work.cartelText && (
            <p className="text-sm text-[--fg-muted] italic leading-relaxed">&quot;{work.cartelText}&quot;</p>
          )}

          <div className="grid grid-cols-2 gap-px bg-[--border] border border-[--border]">
            <TraitBox label="State" value={STATE_LABEL[work.state] ?? work.state} />
            {detail && <TraitBox label="Kind" value={detail.kind} />}
            {detail && <TraitBox label="Normies honored" value={String(detail.honoredBurnCount)} />}
            {work.memorialMilestoneNumber != null && <TraitBox label="Milestone" value={`#${work.memorialMilestoneNumber}`} />}
            {work.onChainMemorialId != null && <TraitBox label="On-chain memorial ID" value={String(work.onChainMemorialId)} />}
            {honoredTokenIds.length > 0 && (
              <TraitBox label="Burned Normie(s)" value={honoredTokenIds.slice(0, 10).map(t => `#${t}`).join(", ") + (honoredTokenIds.length > 10 ? `, +${honoredTokenIds.length - 10} more` : "")} />
            )}
          </div>

          {detail ? (
            <div className="border border-[--border] bg-[--bg-card] p-4 space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted]">Editions</p>
              <p className="font-mono text-[11px] text-[--fg-muted]">
                {detail.publicSupply > 0 && !detail.openEnded && `${detail.publicMinted}/${detail.publicSupply} public editions · `}
                {detail.openEnded && `Open edition until ${new Date(detail.claimDeadline * 1000).toLocaleDateString()} · `}
                {priceEth} ETH / edition · {detail.mintedInSeries} minted so far
              </p>

              {!address ? (
                <ConnectButton />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {myReserved && (
                    <button
                      onClick={() => void mint(detail.memorialId, { fn: "claimFree", burnedTokenId: myReserved.tokenId })}
                      disabled={pendingKey === `${detail.memorialId}-claimFree`}
                      className="font-mono text-[10px] border border-green-400 text-green-400 px-3 py-1.5 hover:bg-green-400/10 disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${detail.memorialId}-claimFree` ? "…" : `✓ Claim for free (Normie #${myReserved.tokenId})`}
                    </button>
                  )}
                  {isRequester && (
                    <button
                      onClick={() => void mint(detail.memorialId, { fn: "mintRequester" })}
                      disabled={pendingKey === `${detail.memorialId}-mintRequester`}
                      className="font-mono text-[10px] border border-[--fg] px-3 py-1.5 hover:bg-[--fg] hover:text-[--bg] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${detail.memorialId}-mintRequester` ? "…" : "Claim my edition (already paid)"}
                    </button>
                  )}
                  {publicAvailable && (
                    <button
                      onClick={() => void mint(detail.memorialId, { fn: "mintPublic", priceWei: detail.priceWei })}
                      disabled={pendingKey === `${detail.memorialId}-mintPublic`}
                      className="font-mono text-[10px] border border-[--border] px-3 py-1.5 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${detail.memorialId}-mintPublic` ? "…" : `Buy an edition (${priceEth} ETH)`}
                    </button>
                  )}
                  {noEditionAvailable && (
                    <p className="font-mono text-[10px] text-[--fg-muted]">No edition currently available for your wallet.</p>
                  )}
                </div>
              )}
              {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}
            </div>
          ) : (
            <div className="border border-[--border] bg-[--bg-card] p-4">
              <p className="font-mono text-[11px] text-[--fg-muted]">
                {STATE_LABEL[work.state] ?? work.state} — minting opens once this memorial is published on-chain.
              </p>
            </div>
          )}
        </div>
      </div>

      <ScreenPreviewGrid artworkText={work.artworkText} title={work.title} />
    </div>
  );
}
