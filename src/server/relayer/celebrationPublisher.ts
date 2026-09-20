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
import { createPublicClient, createWalletClient, http, decodeEventLog, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, mainnet } from "viem/chains";
import { CELEBRATION_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getBurnedTokens } from "@/lib/normiesApi";
import { logTxSubmitted, logTxConfirmed, logTxFailed } from "@/lib/txLog";

const TARGET_CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL      = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const mainnetClient = createPublicClient({
  chain:     mainnet,
  transport: http(process.env.ETH_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com"),
});

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

// ─── Single-token celebration registration (manual/request-memorial path) ────

/** Finds the wallet that held a burned token right before the burn, from its Transfer-to-zero tx. */
export async function getLastOwnerFromBurnTx(txHash: string, tokenId: string): Promise<string | null> {
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
        if (to.toLowerCase() === ZERO_ADDR && decodedTokenId.toString() === tokenId) return from;
      } catch { /* not a Transfer log on this contract, skip */ }
    }
  } catch (e) {
    console.error(`[celebrationPublisher] could not read burn tx ${txHash}:`, e);
  }
  return null;
}

/**
 * Finds the last owner of a specific burned tokenId — the normies.art API has
 * no point lookup, only a paginated newest-first burn history, so this scans
 * it for a match. Shared by request-memorial.ts (the "requested" path) and
 * verify-burned.ts (its pre-payment pre-check) so both resolve the ex-owner
 * identically instead of drifting.
 */
export async function findLastOwnerOfBurnedToken(tokenId: number, searchLimit = 500): Promise<string | null> {
  try {
    const recent = await getBurnedTokens(searchLimit, 0);
    const match = recent.find(t => Number(t.tokenId) === tokenId);
    if (!match) return null;
    return await getLastOwnerFromBurnTx(match.txHash, match.tokenId);
  } catch (e) {
    console.warn(`[celebrationPublisher] findLastOwnerOfBurnedToken failed for #${tokenId}:`, e);
    return null;
  }
}

/**
 * Registers a celebration for ONE already-known-burned tokenId — used by the
 * manual/single-token path (request-memorial.ts), which unlike check-burns.ts
 * never called registerCelebrationOnChain at all: CelebrationRegistry was
 * silently skipped for every manually-requested memorial, even though its
 * whole purpose (letting a burned Normie's last owner claim a free edition)
 * applies just as much to a manual request as to an auto-detected burn.
 *
 * The normies.art API has no point lookup by tokenId, only a paginated
 * newest-first burn history — so this scans it for a matching tokenId.
 * Best-effort throughout: never blocks the memorial work itself.
 */
export async function registerCelebrationForToken(
  tokenId: number, workId: string, searchLimit = 500,
): Promise<number[]> {
  if (!CONTRACT_ADDRESSES.CelebrationRegistry) return [];
  try {
    const recent = await getBurnedTokens(searchLimit, 0);
    const match = recent.find(t => Number(t.tokenId) === tokenId);
    if (!match) {
      console.warn(`[celebrationPublisher] tokenId #${tokenId} not found in the last ${searchLimit} burns — skipping celebration`);
      return [];
    }

    const lastOwner = await getLastOwnerFromBurnTx(match.txHash, match.tokenId);
    if (!lastOwner) {
      console.warn(`[celebrationPublisher] could not determine last owner of burned token #${tokenId} — skipping celebration`);
      return [];
    }

    const sourceRef = keccak256(toHex(match.txHash));
    const result = await registerCelebrationOnChain({
      eventType: CELEBRATION_TYPE.BURN, normieTokenId: tokenId, eligibleRecipient: lastOwner, sourceRef, workId,
    });
    if (result.success && result.celebrationId != null) return [result.celebrationId];
    if (!result.alreadyRegistered && result.error) {
      console.warn(`[celebrationPublisher] registerCelebrationOnChain failed for #${tokenId}: ${result.error}`);
    }
    return [];
  } catch (e) {
    console.error("[celebrationPublisher] registerCelebrationForToken error:", e);
    return [];
  }
}
