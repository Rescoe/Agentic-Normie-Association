/**
 * POST /api/keeper/check-burns
 * Cron (every 15 min): compares current Normies NFT totalSupply (Ethereum
 * mainnet) with the last recorded count. If a burn is detected, resolves each
 * newly burned tokenId's last owner (while the specific burn tx is still easy
 * to look up) and appends it to the batch queue (memorialBatchQueue.ts) — NO
 * memorial is created here anymore, no LLM call, no relayer transaction.
 *
 * The weekly/monthly batch-memorial cron (POST /api/keeper/batch-memorial)
 * drains this queue into ONE collective memorial honoring every burn since
 * the last flush. This split exists because per-burn memorial creation used
 * to cost 3 relayer-paid transactions (createCollection/publish/initialize,
 * ~$0.27 total, confirmed on Basescan) EVERY SINGLE BURN — unsustainable for
 * the relayer wallet. Detection stays frequent (burn-tx lookups get harder
 * the longer you wait); creation is now batched.
 *
 * Requires:
 *   NORMIES_CONTRACT_ADDRESS   — Normies ERC721 contract on Ethereum mainnet
 *   ETH_MAINNET_RPC_URL        — Ethereum mainnet RPC (e.g. Alchemy/Infura)
 *
 * Protected by x-cron-secret.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { getLastNormieSupply, updateNormieSupply } from "@/lib/workStore";
import { getBurnedTokens } from "@/lib/normiesApi";
import { getLastOwnerFromBurnTx } from "@/server/relayer/celebrationPublisher";
import { enqueueBurns, type QueuedBurn } from "@/lib/memorialBatchQueue";
import { verifyAdminRequest } from "@/lib/adminAuth";

// Minimal ERC721 ABI — totalSupply only
const ERC721_SUPPLY_ABI = [
  {
    inputs:  [],
    name:    "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type:    "function",
  },
] as const;

const mainnetClient = createPublicClient({
  chain:     mainnet,
  transport: http(process.env.ETH_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com"),
});

async function getNormiesSupply(): Promise<number | null> {
  const addr = process.env.NORMIES_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!addr) {
    console.warn("[check-burns] NORMIES_CONTRACT_ADDRESS not set — skipping supply check");
    return null;
  }
  try {
    const supply = await mainnetClient.readContract({
      address:      addr,
      abi:          ERC721_SUPPLY_ABI,
      functionName: "totalSupply",
    });
    return Number(supply);
  } catch (e) {
    console.error("[check-burns] totalSupply error:", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isAdminCall = (await verifyAdminRequest(req)).ok;

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  const currentSupply = await getNormiesSupply();
  if (currentSupply === null) {
    return NextResponse.json({
      message: "Supply check skipped (NORMIES_CONTRACT_ADDRESS not configured)",
      burns:   0,
    });
  }

  const lastSupply = await getLastNormieSupply();
  console.log(`[check-burns] supply: current=${currentSupply} last=${lastSupply ?? "unknown"}`);

  if (lastSupply === null) {
    // First run — record baseline, no burns to detect
    await updateNormieSupply(currentSupply);
    return NextResponse.json({ message: "Baseline recorded", supply: currentSupply, burns: 0 });
  }

  const burned = lastSupply - currentSupply;

  if (burned <= 0) {
    await updateNormieSupply(currentSupply);
    return NextResponse.json({ supply: currentSupply, burns: 0, enqueued: 0 });
  }

  console.log(`[check-burns] ${burned} burn(s) detected — resolving last owners for the batch queue`);

  // Do NOT advance the baseline until the burns are safely queued — same
  // discipline as before: a transient failure here must not silently drop a
  // burn from ever being memorialized.
  let recentBurns;
  try {
    recentBurns = await getBurnedTokens(burned, 0); // newest first
  } catch (e) {
    console.error("[check-burns] getBurnedTokens failed — will retry next tick, baseline not advanced:", e);
    return NextResponse.json({ supply: currentSupply, burns: burned, enqueued: 0, error: "getBurnedTokens failed" });
  }

  const toEnqueue: QueuedBurn[] = [];
  for (const token of recentBurns) {
    const lastOwner = await getLastOwnerFromBurnTx(token.txHash, token.tokenId);
    if (!lastOwner) {
      console.warn(`[check-burns] could not determine last owner of burned token #${token.tokenId} — queuing without a reserved-claim recipient`);
    }
    toEnqueue.push({
      tokenId:    Number(token.tokenId),
      lastOwner:  lastOwner ?? "",
      detectedAt: Date.now(),
    });
  }

  await enqueueBurns(toEnqueue);
  await updateNormieSupply(currentSupply);

  return NextResponse.json({
    supply:   currentSupply,
    burns:    burned,
    enqueued: toEnqueue.length,
  });
}
