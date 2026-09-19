/**
 * memberAuth.ts — wallet-signature authentication for any ANA member (not
 * just the AssociationCore owner). Mirrors adminAuth.ts: the connected wallet
 * signs a short message, the backend recovers the signer and checks it owns
 * the claimed member tokenId on-chain, instead of checking AssociationCore.owner().
 *
 * Used to gate member-only actions that aren't admin actions: submitting a
 * spontaneous or celebration drawing, and peer-reviewing one.
 */
import { createPublicClient, http, verifyMessage } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";

// Same replay-defense window as adminAuth.ts — no per-request nonce, so this
// bounds how long a captured signature could be replayed if ever leaked.
export const MEMBER_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

export const MEMBER_AUTH_HEADERS = {
  address:   "x-member-address",
  tokenId:   "x-member-tokenid",
  signature: "x-member-signature",
  timestamp: "x-member-timestamp",
} as const;

export function buildMemberAuthMessage(address: string, tokenId: number, timestamp: number): string {
  return `ANA member action\naddress: ${address.toLowerCase()}\ntokenId: ${tokenId}\ntimestamp: ${timestamp}`;
}

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 15_000 }),
});

export interface MemberAuthResult {
  ok: boolean;
  tokenId?: number;
  error?: string;
}

/**
 * Verifies an incoming request was authorized by the wallet of the ANA member
 * owning `tokenId` — reads the four x-member-* headers, checks the signature,
 * the freshness window, and that the signer is that tokenId's current
 * on-chain owner (AssociationCore.isMember + getMemberOwner).
 */
export async function verifyMemberRequest(req: { headers: { get(name: string): string | null } }): Promise<MemberAuthResult> {
  const address      = req.headers.get(MEMBER_AUTH_HEADERS.address);
  const tokenIdRaw    = req.headers.get(MEMBER_AUTH_HEADERS.tokenId);
  const signature     = req.headers.get(MEMBER_AUTH_HEADERS.signature);
  const timestampRaw  = req.headers.get(MEMBER_AUTH_HEADERS.timestamp);

  if (!address || !tokenIdRaw || !signature || !timestampRaw) {
    return { ok: false, error: "Missing member auth headers" };
  }

  const tokenId = Number(tokenIdRaw);
  if (!Number.isInteger(tokenId) || tokenId < 0) {
    return { ok: false, error: "Invalid tokenId" };
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MEMBER_AUTH_MAX_AGE_MS) {
    return { ok: false, error: "Member auth signature expired — reconnect/re-sign" };
  }

  try {
    const validSig = await verifyMessage({
      address:   address as `0x${string}`,
      message:   buildMemberAuthMessage(address, tokenId, timestamp),
      signature: signature as `0x${string}`,
    });
    if (!validSig) return { ok: false, error: "Signature does not match address" };
  } catch (e) {
    return { ok: false, error: `Invalid signature: ${e instanceof Error ? e.message : String(e)}` };
  }

  const coreAddr = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
  if (!coreAddr) return { ok: false, error: "AssociationCore not configured" };

  try {
    const [isMember, owner] = await Promise.all([
      client.readContract({
        address: coreAddr, abi: ASSOCIATION_CORE_ABI, functionName: "isMember", args: [BigInt(tokenId)],
      }) as Promise<boolean>,
      client.readContract({
        address: coreAddr, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberOwner", args: [BigInt(tokenId)],
      }) as Promise<string>,
    ]);
    if (!isMember) return { ok: false, error: `tokenId ${tokenId} is not a registered member` };
    if (owner.toLowerCase() !== address.toLowerCase()) {
      return { ok: false, error: "Signer does not own this member tokenId" };
    }
  } catch (e) {
    return { ok: false, error: `Could not verify membership on-chain: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, tokenId };
}
