/**
 * GET /api/celebrations/verify-burned?tokenId=N&requesterWallet=0x...
 * Lightweight pre-check the frontend calls BEFORE prompting a wallet payment
 * (ANAMemorials.tip()) for a targeted memorial request — request-memorial
 * itself can't safely reject on burn-status or duplicate-work AFTER payment,
 * since by the time it runs the user has already sent an irreversible
 * on-chain transaction from their own client-side flow. This lets the UI
 * catch the obvious failures (not burned, already has a memorial) first, AND
 * — when requesterWallet is provided — tells the user upfront whether this
 * will mint one edition (they ARE the burned Normie's last owner — their own
 * paid edition already covers it, no separate free claim is registered, see
 * request-memorial/route.ts) or two (someone else's last owner separately
 * keeps their own free claim).
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { listWorks } from "@/lib/workStore";
import { findLastOwnerOfBurnedToken } from "@/server/relayer/celebrationPublisher";

const mainnetClient = createPublicClient({
  chain:     mainnet,
  transport: http(process.env.ETH_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com", { timeout: 15_000 }),
});

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
  if (burned && !existing) {
    lastOwner = await findLastOwnerOfBurnedToken(tokenId);
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
  });
}
