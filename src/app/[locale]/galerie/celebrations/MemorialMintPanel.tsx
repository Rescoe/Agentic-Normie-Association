"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { MemorialListItem } from "@/app/api/memorials/list/route";
import { useMemorialMint } from "./useMemorialMint";

/**
 * Lets the connected wallet mint/claim editions from the shared ANAMemorials
 * collection — replaces the old one-ANAEditions-per-memorial pattern. Three
 * independent actions per memorial, all paid for (gas + price) by the caller
 * directly, never by the relayer:
 *
 *  - claimFree()    — the burned Normie's last owner, always available,
 *                      never blocked by the two pools below selling out.
 *  - mintRequester() — whoever paid to request this specific memorial.
 *  - mintPublic()    — anyone, while the public pool (fixed count or
 *                      time-boxed) still has room.
 *
 * The contract address comes from GET /api/memorials/list, not from an env
 * var imported client-side — ANA_MEMORIALS_ADDRESS isn't NEXT_PUBLIC_-
 * prefixed, so it's only readable server-side.
 */
export function MemorialMintPanel() {
  const { address } = useAccount();
  const [contractAddress, setContractAddress] = useState<string>("");
  const [items, setItems] = useState<MemorialListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/memorials/list")
      .then(r => r.json())
      .then(d => {
        setContractAddress(d.contractAddress ?? "");
        setItems(Array.isArray(d.items) ? d.items : []);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const { mint, pendingKey, error } = useMemorialMint(contractAddress, load);

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <div className="border border-[--border] bg-[--bg-card] p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Memorial editions</p>
        {contractAddress && (
          <a
            href={`https://opensea.io/assets/base/${contractAddress}`}
            target="_blank" rel="noopener noreferrer"
            className="font-mono text-[10px] border border-[--border] px-2 py-1 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors shrink-0"
          >
            View on OpenSea ↗
          </a>
        )}
      </div>

      {!address && (
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] text-[--fg-muted]">Connect your wallet to claim or buy an edition.</p>
          <ConnectButton />
        </div>
      )}

      <div className="space-y-4">
        {items.map(item => {
          const now = Math.floor(Date.now() / 1000);
          const publicAvailable = item.openEnded
            ? now < item.claimDeadline
            : item.publicMinted < item.publicSupply;
          const myReserved = address
            ? item.burnedTokenIds.find(b => !b.reservedClaimed && b.reservedRecipient.toLowerCase() === address.toLowerCase())
            : undefined;
          const isRequester = !!address && item.requesterAddr.toLowerCase() === address.toLowerCase()
            && item.requesterMinted < item.requesterSupply;
          const priceEth = formatEther(BigInt(item.priceWei || "0"));

          return (
            <div key={item.memorialId} className="border border-[--border] bg-[--bg] p-3 flex flex-col sm:flex-row gap-3">
              {item.artworkText && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.artworkText} alt={item.title} className="w-full sm:w-32 shrink-0" style={{ imageRendering: "pixelated" }} />
              )}
              <div className="space-y-2 flex-1 min-w-0">
                {item.workAnaId ? (
                  <Link href={`/galerie/celebrations/${item.workAnaId}`} className="font-bold text-sm truncate block hover:underline" title={item.title}>
                    {item.title}
                  </Link>
                ) : (
                  <p className="font-bold text-sm truncate" title={item.title}>{item.title}</p>
                )}
                {item.cartelText && <p className="font-mono text-[10px] text-[--fg-muted] italic">{item.cartelText}</p>}
                <p className="font-mono text-[10px] text-[--fg-muted]">
                  {item.publicSupply > 0 && !item.openEnded && `${item.publicMinted}/${item.publicSupply} public editions · `}
                  {item.openEnded && `Open edition until ${new Date(item.claimDeadline * 1000).toLocaleDateString()} · `}
                  {priceEth} ETH / edition
                </p>

                <div className="flex flex-wrap gap-2">
                  {myReserved && (
                    <button
                      onClick={() => void mint(item.memorialId, { fn: "claimFree", burnedTokenId: myReserved.tokenId })}
                      disabled={pendingKey === `${item.memorialId}-claimFree`}
                      className="font-mono text-[10px] border border-green-400 text-green-400 px-2 py-1 hover:bg-green-400/10 disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${item.memorialId}-claimFree` ? "…" : "✓ Claim for free (Normie #" + myReserved.tokenId + ")"}
                    </button>
                  )}
                  {isRequester && (
                    <button
                      onClick={() => void mint(item.memorialId, { fn: "mintRequester" })}
                      disabled={pendingKey === `${item.memorialId}-mintRequester`}
                      className="font-mono text-[10px] border border-[--fg] px-2 py-1 hover:bg-[--fg] hover:text-[--bg] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${item.memorialId}-mintRequester` ? "…" : "Claim my edition (already paid)"}
                    </button>
                  )}
                  {publicAvailable && (
                    <button
                      onClick={() => void mint(item.memorialId, { fn: "mintPublic", priceWei: item.priceWei })}
                      disabled={pendingKey === `${item.memorialId}-mintPublic` || !address}
                      className="font-mono text-[10px] border border-[--border] px-2 py-1 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${item.memorialId}-mintPublic` ? "…" : `Buy an edition (${priceEth} ETH)`}
                    </button>
                  )}
                  {item.workAnaId && (
                    <Link
                      href={`/galerie/celebrations/${item.workAnaId}`}
                      className="font-mono text-[10px] border border-[--border] px-2 py-1 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors"
                    >
                      View details →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
