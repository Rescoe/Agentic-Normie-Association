/**
 * adminAuth.ts — wallet-signature authentication for admin-triggered backend
 * routes (work-lifecycle, trigger-generative-work, check-burns, etc.).
 *
 * Previously these routes accepted a literal, non-secret header
 * (`x-admin-call: "1"`) from anyone — the admin page rendered every button to
 * any visitor, and even if it hadn't, the header itself proved nothing about
 * who sent it. This replaces that with: the connected wallet signs a short
 * message, the backend recovers the signer and checks it against
 * AssociationCore.owner() on-chain before allowing the action.
 *
 * Used by both the client (src/app/[locale]/admin/page.tsx, to build the
 * headers) and every gated API route (to verify them).
 */
import { createPublicClient, http, verifyMessage } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";

// Signatures older than this are rejected — bounds how long a captured
// signature could be replayed if ever leaked (there's no per-request nonce,
// so this window is the whole defense against replay).
export const ADMIN_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

export const ADMIN_AUTH_HEADERS = {
  address:   "x-admin-address",
  signature: "x-admin-signature",
  timestamp: "x-admin-timestamp",
} as const;

export function buildAdminAuthMessage(address: string, timestamp: number): string {
  return `ANA admin action\naddress: ${address.toLowerCase()}\ntimestamp: ${timestamp}`;
}

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 15_000 }),
});

export interface AdminAuthResult {
  ok: boolean;
  error?: string;
}

/**
 * Verifies an incoming request was authorized by the AssociationCore owner's
 * wallet — not just a static header anyone could send. Reads the three
 * x-admin-* headers, checks the signature, the freshness window, and that the
 * signer is the current on-chain owner.
 */
export async function verifyAdminRequest(req: { headers: { get(name: string): string | null } }): Promise<AdminAuthResult> {
  const address     = req.headers.get(ADMIN_AUTH_HEADERS.address);
  const signature   = req.headers.get(ADMIN_AUTH_HEADERS.signature);
  const timestampRaw = req.headers.get(ADMIN_AUTH_HEADERS.timestamp);

  if (!address || !signature || !timestampRaw) {
    return { ok: false, error: "Missing admin auth headers" };
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > ADMIN_AUTH_MAX_AGE_MS) {
    return { ok: false, error: "Admin auth signature expired — reconnect/re-sign" };
  }

  try {
    const validSig = await verifyMessage({
      address:   address as `0x${string}`,
      message:   buildAdminAuthMessage(address, timestamp),
      signature: signature as `0x${string}`,
    });
    if (!validSig) return { ok: false, error: "Signature does not match address" };
  } catch (e) {
    return { ok: false, error: `Invalid signature: ${e instanceof Error ? e.message : String(e)}` };
  }

  const coreAddr = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
  if (!coreAddr) return { ok: false, error: "AssociationCore not configured" };

  try {
    const owner = await client.readContract({
      address: coreAddr, abi: ASSOCIATION_CORE_ABI, functionName: "owner",
    }) as string;
    if (owner.toLowerCase() !== address.toLowerCase()) {
      return { ok: false, error: "Signer is not the AssociationCore owner" };
    }
  } catch (e) {
    return { ok: false, error: `Could not verify owner on-chain: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true };
}
