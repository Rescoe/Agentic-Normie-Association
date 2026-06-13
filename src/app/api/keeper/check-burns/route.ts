/**
 * POST /api/keeper/check-burns
 * Daily cron: compares current Normies NFT totalSupply (Ethereum mainnet)
 * with the last recorded count. If a burn is detected, creates a memorial
 * work proposal in the PROPOSED state for the ANA to process.
 *
 * Requires:
 *   NORMIES_NFT_MAINNET_ADDRESS — Normies ERC721 contract on Ethereum mainnet
 *   ETH_MAINNET_RPC_URL        — Ethereum mainnet RPC (e.g. Alchemy/Infura)
 *
 * Protected by x-cron-secret.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { mainnet, base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getLastNormieSupply, updateNormieSupply, createWork, getActiveWorks, ACTIVE_STATES } from "@/lib/workStore";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";

// Minimal ERC721 ABI — only totalSupply
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

const baseClient = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getNormiesSupply(): Promise<number | null> {
  const addr = (process.env.NORMIES_CONTRACT_ADDRESS ?? process.env.NORMIES_NFT_MAINNET_ADDRESS) as `0x${string}` | undefined;
  if (!addr) {
    console.warn("[check-burns] NORMIES_NFT_MAINNET_ADDRESS not set — skipping supply check");
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

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await baseClient.readContract({
      address:      CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const isCron     = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  if (!isCron) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret required" }, { status: 401 });
  }

  const currentSupply = await getNormiesSupply();
  if (currentSupply === null) {
    return NextResponse.json({
      message:       "Supply check skipped (NORMIES_NFT_MAINNET_ADDRESS not configured)",
      burns:         0,
      worksCreated:  0,
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
    return NextResponse.json({ supply: currentSupply, burns: 0, worksCreated: 0 });
  }

  console.log(`[check-burns] ${burned} burn(s) detected!`);

  // Don't create memorial if a work is already in active state
  const activeWorks = await getActiveWorks();
  if (activeWorks.length > 0) {
    console.log(`[check-burns] ${activeWorks.length} works already active — skipping memorial`);
    await updateNormieSupply(currentSupply);
    return NextResponse.json({
      supply:      currentSupply,
      burns:       burned,
      worksCreated: 0,
      skipped:     "work already in progress",
    });
  }

  // Find the proposer: pick a random ANA member
  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    await updateNormieSupply(currentSupply);
    return NextResponse.json({ supply: currentSupply, burns: burned, worksCreated: 0, error: "No ANA members" });
  }

  const proposerId = memberIds[Math.floor(Math.random() * memberIds.length)];
  let proposer: NormiePersona;
  try { proposer = await buildPersona(proposerId); }
  catch {
    await updateNormieSupply(currentSupply);
    return NextResponse.json({ error: "Could not build proposer persona" }, { status: 503 });
  }

  const burnsText = burned === 1
    ? `Un Normie a été brûlé. La collection passe de ${lastSupply} à ${currentSupply}.`
    : `${burned} Normies ont été brûlés. La collection passe de ${lastSupply} à ${currentSupply}.`;

  const work = await createWork({
    proposedBy:     proposer.tokenId,
    proposedByName: proposer.name,
    proposedAt:     Date.now(),
    title:          burned === 1 ? "Mémoire d'un absent" : `Éloge des ${burned} absents`,
    proposal:       `${burnsText} En mémoire de ${burned === 1 ? "ce" : "ces"} Normie${burned > 1 ? "s" : ""} disparu${burned > 1 ? "s" : ""}, l'ANA propose de créer une œuvre mémoriale — poème ou manifeste sur la finitude, la brûlure et la permanence de ce qui reste on-chain.`,
    isBurnMemorial: true,
    salonId:        "salon_agora_ana",
  });

  await updateNormieSupply(currentSupply);

  return NextResponse.json({
    supply:      currentSupply,
    burns:       burned,
    worksCreated: 1,
    workId:      work.id,
    workTitle:   work.title,
  });
}
