/**
 * normiesOwnership.ts
 *
 * Verifies ERC-721 ownership on Ethereum mainnet.
 * Two strategies, tried in order:
 *   1. Normies API (fast, cached) — preferred
 *   2. Direct RPC ownerOf call (fallback if API unavailable)
 *
 * Never throws: returns null if ownership cannot be verified.
 */

import { createPublicClient, http, getAddress } from "viem";
import { mainnet } from "viem/chains";

// ─── Config ──────────────────────────────────────────────────────────────────

const NORMIES_API_BASE =
  process.env.NORMIES_API_BASE_URL ?? "https://api.normies.art";

const NORMIES_CONTRACT_ADDRESS =
  (process.env.NORMIES_CONTRACT_ADDRESS as `0x${string}` | undefined) ?? null;

const ETH_RPC_URL =
  process.env.ETH_MAINNET_RPC_URL ?? "https://eth.llamarpc.com";

// Minimal ERC-721 ABI — only ownerOf needed
const ERC721_OWNER_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ─── Strategy 1: Normies API ─────────────────────────────────────────────────

async function getOwnerFromApi(tokenId: number): Promise<string | null> {
  try {
    const res = await fetch(`${NORMIES_API_BASE}/token/${tokenId}`, {
      next: { revalidate: 30 }, // 30s cache — fresh enough for registration
    });
    if (!res.ok) return null;

    const data = await res.json();
    // Normies API returns owner at data.owner or data.ownerAddress
    const owner: string | undefined = data?.owner ?? data?.ownerAddress;
    if (!owner) return null;

    return getAddress(owner); // checksum
  } catch {
    return null;
  }
}

// ─── Strategy 2: Direct RPC ───────────────────────────────────────────────────

async function getOwnerFromRpc(tokenId: number): Promise<string | null> {
  if (!NORMIES_CONTRACT_ADDRESS) return null;

  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(ETH_RPC_URL),
    });

    const owner = await client.readContract({
      address: NORMIES_CONTRACT_ADDRESS,
      abi: ERC721_OWNER_ABI,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });

    return getAddress(owner as string);
  } catch {
    return null;
  }
}

// ─── Public Interface ─────────────────────────────────────────────────────────

/**
 * Returns the checksummed owner address of a Normie token on Ethereum mainnet.
 * Returns null if the token doesn't exist or ownership cannot be verified.
 */
export async function getNormieOwnerOnMainnet(
  tokenId: number
): Promise<string | null> {
  // Try Normies API first (faster, uses their cache)
  const apiOwner = await getOwnerFromApi(tokenId);
  if (apiOwner) return apiOwner;

  // Fallback to direct RPC
  return getOwnerFromRpc(tokenId);
}
