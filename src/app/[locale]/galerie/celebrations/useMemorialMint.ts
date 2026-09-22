"use client";

import { useState } from "react";
import { useWriteContract } from "wagmi";
import { base } from "viem/chains";
import { ANA_MEMORIALS_ABI } from "@/lib/contracts";

export type MintAction =
  | { fn: "claimFree"; burnedTokenId: number }
  | { fn: "mintRequester" }
  | { fn: "mintPublic"; priceWei: string };

/**
 * Shared claimFree/mintRequester/mintPublic transaction logic — used by both
 * MemorialMintPanel (the multi-memorial list) and the dedicated per-memorial
 * page ([id]/page.tsx), so a fix here (chainId pinning, error copy, etc.)
 * never needs to be made twice. All three write directly from the caller's
 * own wallet (gas + price), never through the relayer — see ANAMemorials.sol.
 */
export function useMemorialMint(contractAddress: string, onSuccess?: () => void) {
  const { writeContractAsync } = useWriteContract();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mint(memorialId: number, action: MintAction) {
    const key = `${memorialId}-${action.fn}`;
    setPendingKey(key);
    setError(null);
    try {
      const address = contractAddress as `0x${string}`;
      if (action.fn === "claimFree") {
        await writeContractAsync({
          address, abi: ANA_MEMORIALS_ABI, functionName: "claimFree",
          args: [BigInt(memorialId), BigInt(action.burnedTokenId)],
          chainId: base.id,
        });
      } else if (action.fn === "mintRequester") {
        await writeContractAsync({
          address, abi: ANA_MEMORIALS_ABI, functionName: "mintRequester",
          args: [BigInt(memorialId)],
          chainId: base.id,
        });
      } else {
        await writeContractAsync({
          address, abi: ANA_MEMORIALS_ABI, functionName: "mintPublic",
          args: [BigInt(memorialId)], value: BigInt(action.priceWei),
          chainId: base.id,
        });
      }
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") ? "Transaction cancelled." : "Transaction failed.");
    } finally {
      setPendingKey(null);
    }
  }

  return { mint, pendingKey, error, setError };
}
