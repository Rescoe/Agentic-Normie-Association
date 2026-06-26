/**
 * celebrationPublisher.ts
 *
 * Relayer-signed calls into CelebrationRegistry — registers a Normies life-event
 * ANA is honoring, then links it to the work published for it once that work's
 * onChainWorkId/collectionAddress are known. The honored wallet can then call
 * CelebrationRegistry.claim() itself (sponsored — it pays nothing but gas).
 *
 * Mirrors workPublisher.ts's relayer wallet setup; kept separate since
 * CelebrationRegistry is independent of WorkRegistry/ANAEditions/the factory.
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { CELEBRATION_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { logTxSubmitted, logTxConfirmed, logTxFailed } from "@/lib/txLog";

const TARGET_CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL      = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

// Mirrors CelebrationRegistry.CelebrationType — keep in sync with the contract.
export const CELEBRATION_TYPE = {
  BURN:              0,
  CANVAS_TRANSFORM:  1,
  ZOMBIE_CONVERSION: 2,
  LEGENDARY_CANVAS:  3,
  AGENT_AWAKENING:   4,
} as const;

export interface RegisterCelebrationParams {
  eventType:         number;
  normieTokenId:     number;
  eligibleRecipient: string;
  sourceRef:         Hex; // keccak256 of an api.normies.art reference (e.g. the burn tx hash)
  workId?:           string; // ANAWork id, for tx_log only
}

export interface RegisterCelebrationResult {
  success:        boolean;
  celebrationId?: number;
  txHash?:        string;
  error?:         string;
  alreadyRegistered?: boolean;
}

export interface LinkCelebrationParams {
  celebrationId:  number;
  onChainWorkId:  number;
  editionsAddr:   string;
  workId?:        string; // ANAWork id, for tx_log only
}

export interface LinkCelebrationResult {
  success: boolean;
  txHash?: string;
  error?:  string;
}

function getClients() {
  const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const registryAddr = CONTRACT_ADDRESSES.CelebrationRegistry as `0x${string}`;
  if (!key) return { error: "RELAYER_PRIVATE_KEY not configured" } as const;
  if (!registryAddr) return { error: "NEXT_PUBLIC_CELEBRATION_REGISTRY_ADDRESS not configured" } as const;

  const account      = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: TARGET_CHAIN, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });
  return { account, walletClient, publicClient, registryAddr } as const;
}

/**
 * Registers that ANA is honoring a specific on-chain Normies event. Call this
 * BEFORE the memorial work is proposed/created, so the celebrationId can be
 * stashed on the work (ANAWork.celebrationIds) for linkCelebrationWork() later.
 */
export async function registerCelebrationOnChain(
  params: RegisterCelebrationParams,
): Promise<RegisterCelebrationResult> {
  const clients = getClients();
  if ("error" in clients) return { success: false, error: clients.error };
  const { account, walletClient, publicClient, registryAddr } = clients;

  // Skip cleanly if this exact (eventType, normieTokenId) was already registered —
  // the contract enforces this anyway, but checking first avoids a wasted revert.
  try {
    const already = await publicClient.readContract({
      address: registryAddr, abi: CELEBRATION_REGISTRY_ABI,
      functionName: "isEventRegistered", args: [params.eventType, BigInt(params.normieTokenId)],
    }) as boolean;
    if (already) return { success: false, alreadyRegistered: true, error: "Event already registered" };
  } catch (e) {
    console.warn(`[celebrationPublisher] isEventRegistered check failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const hash = await walletClient.writeContract({
      address: registryAddr, abi: CELEBRATION_REGISTRY_ABI,
      functionName: "registerCelebration",
      args: [params.eventType, BigInt(params.normieTokenId), params.eligibleRecipient as `0x${string}`, params.sourceRef],
    });

    await logTxSubmitted({
      txHash: hash, type: "register-celebration", initiator: "relayer",
      contractName: "CelebrationRegistry", functionName: "registerCelebration",
      fromAddress: account.address, targetAddress: registryAddr, workId: params.workId,
      relatedTokenId: params.normieTokenId,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

    // CelebrationRegistered(uint256 indexed celebrationId, ...) — topics[1] is the first indexed arg.
    let celebrationId: number | undefined;
    const match = receipt.logs.find(l => l.address.toLowerCase() === registryAddr.toLowerCase());
    if (match && match.topics[1]) {
      celebrationId = Number(BigInt(match.topics[1]));
    }

    if (celebrationId == null) {
      await logTxFailed(hash, "CelebrationRegistered event not found");
      return { success: false, txHash: hash, error: "CelebrationRegistered event not found" };
    }

    console.log(`[celebrationPublisher] celebration registered: id=${celebrationId} normie=#${params.normieTokenId} recipient=${params.eligibleRecipient}`);
    await logTxConfirmed(hash, receipt.blockNumber, { celebrationId });

    return { success: true, celebrationId, txHash: hash };
  } catch (e) {
    return { success: false, error: `registerCelebration failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Links a registered celebration to the work published for it, once
 * WorkRegistry.publish() + ANACollectionFactory.createCollection() have both
 * run. Activates the sponsored claim() for the honored wallet.
 */
export async function linkCelebrationWork(
  params: LinkCelebrationParams,
): Promise<LinkCelebrationResult> {
  const clients = getClients();
  if ("error" in clients) return { success: false, error: clients.error };
  const { account, walletClient, publicClient, registryAddr } = clients;

  try {
    const hash = await walletClient.writeContract({
      address: registryAddr, abi: CELEBRATION_REGISTRY_ABI,
      functionName: "linkWork",
      args: [BigInt(params.celebrationId), BigInt(params.onChainWorkId), params.editionsAddr as `0x${string}`],
    });

    await logTxSubmitted({
      txHash: hash, type: "link-celebration", initiator: "relayer",
      contractName: "CelebrationRegistry", functionName: "linkWork",
      fromAddress: account.address, targetAddress: registryAddr, workId: params.workId,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    console.log(`[celebrationPublisher] linked celebration #${params.celebrationId} → work #${params.onChainWorkId} (${params.editionsAddr})`);
    await logTxConfirmed(hash, receipt.blockNumber, {});

    return { success: true, txHash: hash };
  } catch (e) {
    return { success: false, error: `linkWork failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
