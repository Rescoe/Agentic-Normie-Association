/**
 * POST /api/keeper/check-burns
 * Daily cron: compares current Normies NFT totalSupply (Ethereum mainnet)
 * with the last recorded count. If a burn is detected, creates a memorial
 * work proposal in the PROPOSED state for the ANA to process, and registers
 * a CelebrationRegistry entry per burned Normie (Base) so its last owner can
 * later claim a free edition of the work made in its honor.
 *
 * Requires:
 *   NORMIES_CONTRACT_ADDRESS    — Normies ERC721 contract on Ethereum mainnet
 *   ETH_MAINNET_RPC_URL        — Ethereum mainnet RPC (e.g. Alchemy/Infura)
 *
 * Protected by x-cron-secret.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, decodeEventLog, keccak256, toHex } from "viem";
import { mainnet, base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getLastNormieSupply, updateNormieSupply, createWork, updateWork, getActiveWorks } from "@/lib/workStore";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";
import { getBurnedTokens } from "@/lib/normiesApi";
import { registerCelebrationOnChain, CELEBRATION_TYPE } from "@/server/relayer/celebrationPublisher";

// Minimal ERC721 ABI — totalSupply + the standard Transfer event
const ERC721_SUPPLY_ABI = [
  {
    inputs:  [],
    name:    "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type:    "function",
  },
] as const;

const TRANSFER_EVENT_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from",    type: "address" },
      { indexed: true, name: "to",      type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
  },
] as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const mainnetClient = createPublicClient({
  chain:     mainnet,
  transport: http(process.env.ETH_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com"),
});

const baseClient = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
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

/** Finds the wallet that held a burned token right before the burn, from its Transfer-to-zero tx. */
async function getLastOwnerFromBurnTx(txHash: string, tokenId: string): Promise<string | null> {
  const normiesAddr = process.env.NORMIES_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!normiesAddr) return null;
  try {
    const receipt = await mainnetClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== normiesAddr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: TRANSFER_EVENT_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "Transfer") continue;
        const { from, to, tokenId: decodedTokenId } = decoded.args as { from: string; to: string; tokenId: bigint };
        if (to.toLowerCase() === ZERO_ADDR && decodedTokenId.toString() === tokenId) {
          return from;
        }
      } catch { /* not a Transfer log on this contract, skip */ }
    }
  } catch (e) {
    console.error(`[check-burns] could not read burn tx ${txHash}:`, e);
  }
  return null;
}

/**
 * Registers a CelebrationRegistry entry for each newly burned Normie so its last
 * owner can later claim a free edition. Best-effort: failures here never block
 * the memorial work itself — celebrations are a bonus, not a dependency.
 */
async function registerBurnCelebrations(burnedCount: number, workId: string): Promise<number[]> {
  if (!CONTRACT_ADDRESSES.CelebrationRegistry) {
    console.log("[check-burns] CelebrationRegistry not configured — skipping celebration registration");
    return [];
  }

  let recent;
  try {
    recent = await getBurnedTokens(burnedCount, 0); // newest first
  } catch (e) {
    console.error("[check-burns] getBurnedTokens failed — skipping celebrations:", e);
    return [];
  }

  const celebrationIds: number[] = [];
  for (const token of recent) {
    const lastOwner = await getLastOwnerFromBurnTx(token.txHash, token.tokenId);
    if (!lastOwner) {
      console.warn(`[check-burns] could not determine last owner of burned token #${token.tokenId} — skipping its celebration`);
      continue;
    }

    const sourceRef = keccak256(toHex(token.txHash));
    const result = await registerCelebrationOnChain({
      eventType:         CELEBRATION_TYPE.BURN,
      normieTokenId:     Number(token.tokenId),
      eligibleRecipient: lastOwner,
      sourceRef,
      workId,
    });

    if (result.success && result.celebrationId != null) {
      celebrationIds.push(result.celebrationId);
      console.log(`[check-burns] registered celebration #${result.celebrationId} for burned Normie #${token.tokenId} → ${lastOwner}`);
    } else if (!result.alreadyRegistered) {
      console.warn(`[check-burns] registerCelebrationOnChain failed for #${token.tokenId}: ${result.error}`);
    }
  }
  return celebrationIds;
}

export async function POST(req: NextRequest) {
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isAdminCall = req.headers.get("x-admin-call") === "1";

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or x-admin-call required" }, { status: 401 });
  }

  const currentSupply = await getNormiesSupply();
  if (currentSupply === null) {
    return NextResponse.json({
      message:       "Supply check skipped (NORMIES_CONTRACT_ADDRESS not configured)",
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
    ? `A Normie was burned. The collection goes from ${lastSupply} to ${currentSupply}.`
    : `${burned} Normies were burned. The collection goes from ${lastSupply} to ${currentSupply}.`;

  const work = await createWork({
    proposedBy:     proposer.tokenId,
    proposedByName: proposer.name,
    proposedAt:     Date.now(),
    title:          burned === 1 ? "Memory of an absence" : `Eulogy for ${burned} absences`,
    proposal:       `${burnsText} In memory of ${burned === 1 ? "this" : "these"} departed Normie${burned > 1 ? "s" : ""}, ANA proposes creating a memorial work — a poem or manifesto on finitude, burning, and the permanence of what remains on-chain.`,
    isBurnMemorial: true,
    salonId:        "salon_agora_ana",
  });

  // Best-effort — never blocks the memorial work if it fails.
  const celebrationIds = await registerBurnCelebrations(burned, work.id).catch(e => {
    console.error("[check-burns] registerBurnCelebrations error:", e);
    return [] as number[];
  });
  if (celebrationIds.length > 0) {
    await updateWork(work.id, { celebrationIds });
  }

  await updateNormieSupply(currentSupply);

  return NextResponse.json({
    supply:       currentSupply,
    burns:        burned,
    worksCreated: 1,
    workId:       work.id,
    workTitle:    work.title,
    celebrationsRegistered: celebrationIds.length,
  });
}
