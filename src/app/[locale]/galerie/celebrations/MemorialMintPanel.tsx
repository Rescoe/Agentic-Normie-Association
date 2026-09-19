"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ANA_MEMORIALS_ABI } from "@/lib/contracts";
import type { MemorialListItem } from "@/app/api/memorials/list/route";

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
  const { writeContractAsync } = useWriteContract();
  const [contractAddress, setContractAddress] = useState<string>("");
  const [items, setItems] = useState<MemorialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return null;
  if (items.length === 0) return null;

  async function handleMint(
    memorialId: number,
    action:
      | { fn: "claimFree"; burnedTokenId: number }
      | { fn: "mintRequester"; priceWei: string }
      | { fn: "mintPublic"; priceWei: string },
  ) {
    const key = `${memorialId}-${action.fn}`;
    setPendingKey(key);
    setError(null);
    try {
      const address = contractAddress as `0x${string}`;
      if (action.fn === "claimFree") {
        await writeContractAsync({
          address, abi: ANA_MEMORIALS_ABI, functionName: "claimFree",
          args: [BigInt(memorialId), BigInt(action.burnedTokenId)],
        });
      } else if (action.fn === "mintRequester") {
        await writeContractAsync({
          address, abi: ANA_MEMORIALS_ABI, functionName: "mintRequester",
          args: [BigInt(memorialId)], value: BigInt(action.priceWei),
        });
      } else {
        await writeContractAsync({
          address, abi: ANA_MEMORIALS_ABI, functionName: "mintPublic",
          args: [BigInt(memorialId)], value: BigInt(action.priceWei),
        });
      }
      load(); // refresh pool counts / claimed flags
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") ? "Transaction annulée." : "Échec de la transaction.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="border border-[--border] bg-[--bg-card] p-6 space-y-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Éditions des mémoriaux</p>

      {!address && (
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] text-[--fg-muted]">Connecte ton wallet pour réclamer ou acheter une édition.</p>
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
                <p className="font-bold text-sm truncate" title={item.title}>{item.title}</p>
                {item.cartelText && <p className="font-mono text-[10px] text-[--fg-muted] italic">{item.cartelText}</p>}
                <p className="font-mono text-[10px] text-[--fg-muted]">
                  {item.publicSupply > 0 && !item.openEnded && `${item.publicMinted}/${item.publicSupply} éditions publiques · `}
                  {item.openEnded && `Édition ouverte jusqu'au ${new Date(item.claimDeadline * 1000).toLocaleDateString()} · `}
                  {priceEth} ETH / édition
                </p>

                <div className="flex flex-wrap gap-2">
                  {myReserved && (
                    <button
                      onClick={() => void handleMint(item.memorialId, { fn: "claimFree", burnedTokenId: myReserved.tokenId })}
                      disabled={pendingKey === `${item.memorialId}-claimFree`}
                      className="font-mono text-[10px] border border-green-400 text-green-400 px-2 py-1 hover:bg-green-400/10 disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${item.memorialId}-claimFree` ? "…" : "✓ Réclamer gratuitement (Normie #" + myReserved.tokenId + ")"}
                    </button>
                  )}
                  {isRequester && (
                    <button
                      onClick={() => void handleMint(item.memorialId, { fn: "mintRequester", priceWei: item.priceWei })}
                      disabled={pendingKey === `${item.memorialId}-mintRequester`}
                      className="font-mono text-[10px] border border-[--fg] px-2 py-1 hover:bg-[--fg] hover:text-[--bg] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${item.memorialId}-mintRequester` ? "…" : `Réclamer mon édition (${priceEth} ETH)`}
                    </button>
                  )}
                  {publicAvailable && (
                    <button
                      onClick={() => void handleMint(item.memorialId, { fn: "mintPublic", priceWei: item.priceWei })}
                      disabled={pendingKey === `${item.memorialId}-mintPublic` || !address}
                      className="font-mono text-[10px] border border-[--border] px-2 py-1 text-[--fg-muted] hover:text-[--fg] hover:border-[--fg] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {pendingKey === `${item.memorialId}-mintPublic` ? "…" : `Acheter une édition (${priceEth} ETH)`}
                    </button>
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
