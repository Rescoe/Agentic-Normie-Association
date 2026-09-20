/**
 * GET /api/celebrations/verify-burned?tokenId=N&requesterWallet=0x...
 * Lightweight pre-check the frontend calls BEFORE prompting a wallet payment
 * (ANAMemorials.payForRequest()) for a targeted memorial request —
 * request-memorial itself can't safely reject on burn-status or duplicate-
 * work AFTER payment, since by the time it runs the user has already sent an
 * irreversible on-chain transaction from their own client-side flow. This
 * lets the UI catch the obvious failures (not burned, already has a
 * memorial) first, AND:
 *
 *  - when requesterWallet is provided, tells the user upfront whether this
 *    will mint one edition (they ARE the burned Normie's last owner — their
 *    own paid edition already covers it, no separate free claim is
 *    registered, see request-memorial/route.ts) or two (someone else's last
 *    owner separately keeps their own free claim).
 *  - picks the proposer (the ANA member whose persona will create the
 *    piece) NOW, before payment — payForRequest() needs it up front to split
 *    the payment 50/50 with the right creator immediately, instead of
 *    waiting for the memorial to actually be created. request-memorial.ts
 *    reuses this EXACT proposerTokenId (verified against the payment's
 *    on-chain RequestPaid event) rather than picking a different one.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base, mainnet } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks } from "@/lib/workStore";
import { buildPersona } from "@/lib/normiesPersona";
import { findLastOwnerOfBurnedToken } from "@/server/relayer/celebrationPublisher";

const mainnetClient = createPublicClient({
  chain:     mainnet,
  transport: http(process.env.ETH_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com", { timeout: 15_000 }),
});

const baseClient = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 15_000 }),
});

async function pickProposer(): Promise<{ tokenId: number; name: string } | null> {
  try {
    const raw = await baseClient.readContract({
      address: CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:     ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    }) as bigint[];
    const memberIds = raw.map(Number);
    if (memberIds.length === 0) return null;
    const tokenId = memberIds[Math.floor(Math.random() * memberIds.length)];
    const persona = await buildPersona(tokenId);
    return { tokenId, name: persona.name };
  } catch {
    return null;
  }
}

const ERC721_OWNER_ABI = [
  {
    inputs:  [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name:    "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type:    "function",
  },
] as const;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tokenId");
  const tokenId = raw != null ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(tokenId) || tokenId < 0) {
    return NextResponse.json({ error: "tokenId (integer) requis" }, { status: 400 });
  }
  const requesterWallet = req.nextUrl.searchParams.get("requesterWallet");

  const addr = process.env.NORMIES_CONTRACT_ADDRESS as `0x${string}` | undefined;
  let burned = false;
  if (!addr) {
    return NextResponse.json({ burned: false, error: "NORMIES_CONTRACT_ADDRESS non configuré" });
  }
  try {
    await mainnetClient.readContract({
      address: addr, abi: ERC721_OWNER_ABI, functionName: "ownerOf", args: [BigInt(tokenId)],
    });
    burned = false; // call succeeded → still has an owner → not burned
  } catch {
    burned = true; // reverts → burned (same semantics as request-memorial's verifyBurned)
  }

  const existing = (await listWorks()).find(
    w => (w.burnedTokenId === tokenId || w.burnedTokenIds?.includes(tokenId)) && w.state !== "REJECTED",
  );

  let lastOwner: string | null = null;
  let requesterIsLastOwner = false;
  let proposer: { tokenId: number; name: string } | null = null;
  if (burned && !existing) {
    [lastOwner, proposer] = await Promise.all([
      findLastOwnerOfBurnedToken(tokenId),
      pickProposer(),
    ]);
    if (lastOwner && requesterWallet) {
      requesterIsLastOwner = lastOwner.toLowerCase() === requesterWallet.toLowerCase();
    }
  }

  return NextResponse.json({
    burned,
    alreadyRequested: !!existing,
    existingWorkId:   existing?.id,
    existingState:    existing?.state,
    lastOwner,
    // true  → requester's own paid edition covers it, exactly 1 edition will exist for this event
    // false → the last owner (a different wallet) separately keeps a free claim, 2 editions will exist
    requesterIsLastOwner,
    // The proposer to pass to payForRequest() and, unchanged, to
    // request-memorial — null only if no ANA member could be resolved
    // (empty roster / API hiccup), in which case the frontend should not
    // proceed to payment yet.
    proposerTokenId: proposer?.tokenId ?? null,
    proposerName:    proposer?.name ?? null,
  });
}
