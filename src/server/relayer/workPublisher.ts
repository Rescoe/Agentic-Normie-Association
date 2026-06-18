/**
 * workPublisher.ts
 *
 * Three on-chain steps in the publishing pipeline:
 *
 *  1. deployCollection()     — ANACollectionFactory.createCollection()
 *                              Deploys ANAEditions with supply/price/revenue config.
 *                              Called BEFORE WorkRegistry.publish() so the collection
 *                              address can be embedded in the immutable certificate.
 *
 *  2. publishWork()          — WorkRegistry.publish()
 *                              Stores the governance certificate on-chain (HTML includes
 *                              collection address). Returns the immutable workId.
 *
 *  3. initializeCollection() — ANAEditions.initialize()
 *                              Links artwork content + workId to the collection.
 *                              Activates buyAndMint() for buyers.
 *
 * Security — relayer auto-sweep:
 *   After each tx, checkAndSweepRelayer() is called. If the relayer wallet holds
 *   > SWEEP_THRESHOLD ETH, the excess is sent to the ANA vault (TreasuryModule).
 */

import {
  createPublicClient, createWalletClient, http,
  decodeEventLog, parseEther, formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  WORK_REGISTRY_ABI,
  ASSOCIATION_CORE_ABI,
  ANA_EDITIONS_ABI,
  ANA_COLLECTION_FACTORY_ABI,
  CONTRACT_ADDRESSES,
} from "@/lib/contracts";

const TARGET_CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL      = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const SWEEP_THRESHOLD = parseEther("0.1");

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface PublishResult {
  success:                boolean;
  txHash?:                string;
  onChainWorkId?:         number;
  error?:                 string;
  requiresManualPublish?: boolean;
}

export interface DeployCollectionParams {
  authorTokenId:     number;
  curatorTokenId:    number;
  rapporteurTokenId: number;
  authorName:        string;
  editionCount:      number;  // from collective vote
  editionPrice:      bigint;  // in wei, from collective vote
  existingCollection?: string; // if already deployed, skip
}

export interface DeployCollectionResult {
  success:           boolean;
  collectionAddress?: string;
  txHash?:           string;
  error?:            string;
  skipped?:          string;
}

export interface InitCollectionParams {
  collectionAddress: string;
  artworkContent:    string;  // poem text, or data:text/html;base64,... for HTML/generative
  artworkTitle:      string;
  workId:            number;  // WorkRegistry index
}

export interface InitCollectionResult {
  success:  boolean;
  txHash?:  string;
  error?:   string;
}

// ─── Step 1: Deploy collection ────────────────────────────────────────────────

/**
 * Deploys an ANAEditions collection via ANACollectionFactory.
 * Called BEFORE publishWork() so the collection address can be embedded
 * in the immutable WorkRegistry certificate.
 *
 * If params.existingCollection is set (work already has a collection), returns
 * immediately — no re-deployment.
 */
export async function deployCollection(
  params: DeployCollectionParams,
): Promise<DeployCollectionResult> {
  if (params.existingCollection) {
    return { success: true, collectionAddress: params.existingCollection, skipped: "existing" };
  }

  const key         = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const factoryAddr = CONTRACT_ADDRESSES.ANACollectionFactory as `0x${string}`;
  const coreAddr    = CONTRACT_ADDRESSES.AssociationCore      as `0x${string}`;

  if (!key) return { success: false, error: "RELAYER_PRIVATE_KEY not configured" };
  if (!factoryAddr) return { success: false, skipped: "NEXT_PUBLIC_ANA_COLLECTION_FACTORY_ADDRESS not configured" };

  const account      = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: TARGET_CHAIN, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });

  const relayerAddr       = account.address;
  const authorWallet      = await _getMemberOwner(publicClient, coreAddr, params.authorTokenId,     relayerAddr);
  const curatorWallet     = await _getMemberOwner(publicClient, coreAddr, params.curatorTokenId,    relayerAddr);
  const rapporteurWallet  = await _getMemberOwner(publicClient, coreAddr, params.rapporteurTokenId, relayerAddr);

  const collSymbol = params.authorName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "ANA";
  const collName   = `${params.authorName} — ANA`;

  try {
    const hash = await walletClient.writeContract({
      address:      factoryAddr,
      abi:          ANA_COLLECTION_FACTORY_ABI,
      functionName: "createCollection",
      args: [
        BigInt(params.authorTokenId),
        collName,
        collSymbol,
        relayerAddr,       // minter = relayer
        authorWallet,
        curatorWallet,
        rapporteurWallet,
        0,  // authorPct = 0 → use factory defaults (60/20/10/10)
        0,
        0,
        BigInt(params.editionCount),
        params.editionPrice,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

    // Parse CollectionDeployed event: topics[2] = indexed collectionAddr
    let collectionAddress: `0x${string}` | undefined;
    for (const log of receipt.logs) {
      if (log.topics.length >= 3 && log.address.toLowerCase() === factoryAddr.toLowerCase()) {
        const raw = log.topics[2] ?? "0x";
        collectionAddress = `0x${raw.slice(26)}` as `0x${string}`;
        break;
      }
    }

    if (!collectionAddress) {
      return { success: false, error: "CollectionDeployed event not found" };
    }

    console.log(`[workPublisher] collection deployed: ${collectionAddress} (${params.editionCount} editions @ ${formatEther(params.editionPrice)} ETH)`);

    await checkAndSweepRelayer(account.address, key);

    return { success: true, collectionAddress, txHash: hash };
  } catch (e) {
    return { success: false, error: `createCollection failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ─── Step 2: Publish work on WorkRegistry ─────────────────────────────────────

/**
 * Publishes the governance certificate HTML on-chain via WorkRegistry.publish().
 * htmlContent must already include the collection address (from deployCollection).
 */
export async function publishWork(
  htmlContent:       string,
  authorTokenId:     number,
  curatorTokenId:    number,
  rapporteurTokenId: number,
): Promise<PublishResult> {
  const key          = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const registryAddr = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

  if (!key) return { success: false, error: "RELAYER_PRIVATE_KEY not configured", requiresManualPublish: true };
  if (!registryAddr) return { success: false, error: "NEXT_PUBLIC_WORK_REGISTRY_ADDRESS not configured", requiresManualPublish: true };

  const b64     = Buffer.from(htmlContent, "utf-8").toString("base64");
  const content = `data:text/html;base64,${b64}`;

  const account      = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: TARGET_CHAIN, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });

  try {
    const hash = await walletClient.writeContract({
      address:      registryAddr,
      abi:          WORK_REGISTRY_ABI,
      functionName: "publish",
      args:         [content, BigInt(authorTokenId), BigInt(curatorTokenId), BigInt(rapporteurTokenId)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

    let onChainWorkId: number | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryAddr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi:       WORK_REGISTRY_ABI,
          eventName: "WorkPublished",
          data:      log.data   as `0x${string}`,
          topics:    log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        onChainWorkId = Number((decoded.args as { workId: bigint }).workId);
        break;
      } catch { /* not WorkPublished */ }
    }

    console.log(`[workPublisher] published — workId=${onChainWorkId} tx=${hash}`);
    await checkAndSweepRelayer(account.address, key);
    return { success: true, txHash: hash, onChainWorkId };

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isNotRapporteur = msg.includes("NotRapporteur") || msg.includes("not rapporteur");
    console.error(`[workPublisher] publish failed: ${msg}`);
    return { success: false, error: msg, requiresManualPublish: isNotRapporteur };
  }
}

// ─── Step 3: Initialize collection with artwork ───────────────────────────────

/**
 * Links the artwork content and WorkRegistry workId to the collection.
 * This activates buyAndMint() for buyers.
 *
 * artworkContent = poem text or data:text/html;base64,... — NOT the full certificate.
 * The full certificate lives in WorkRegistry at workId.
 */
export async function initializeCollection(
  params: InitCollectionParams,
): Promise<InitCollectionResult> {
  const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return { success: false, error: "RELAYER_PRIVATE_KEY not configured" };

  const account      = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: TARGET_CHAIN, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });

  try {
    const hash = await walletClient.writeContract({
      address:      params.collectionAddress as `0x${string}`,
      abi:          ANA_EDITIONS_ABI,
      functionName: "initialize",
      args:         [params.artworkContent, params.artworkTitle, BigInt(params.workId)],
      // Storing artwork content (poem ~1KB, HTML ~10KB) requires many SSTORE ops.
      // Viem auto-estimate underestimates for large string storage. Set explicit limit.
      gas:          5_000_000n,
    });

    await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    console.log(`[workPublisher] collection initialized — workId=${params.workId} collection=${params.collectionAddress}`);

    await checkAndSweepRelayer(account.address, key);
    return { success: true, txHash: hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // AlreadyInitialized is not a fatal error — collection was already set up
    if (msg.includes("AlreadyInitialized")) {
      console.info(`[workPublisher] collection already initialized (${params.collectionAddress})`);
      return { success: true };
    }
    console.error(`[workPublisher] initialize failed: ${msg}`);
    return { success: false, error: msg };
  }
}

// ─── Relayer security: auto-sweep to vault ────────────────────────────────────

async function checkAndSweepRelayer(
  relayerAddr: `0x${string}`,
  key:         `0x${string}`,
): Promise<void> {
  const vaultAddr = CONTRACT_ADDRESSES.TreasuryModule as `0x${string}`;
  if (!vaultAddr) return;

  const pc = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });

  try {
    const balance = await pc.getBalance({ address: relayerAddr });
    if (balance <= SWEEP_THRESHOLD) return;

    const gasBuffer   = SWEEP_THRESHOLD / 2n;
    const sweepAmount = balance - SWEEP_THRESHOLD - gasBuffer;
    if (sweepAmount <= 0n) return;

    console.log(`[workPublisher] sweeping ${formatEther(sweepAmount)} ETH → vault ${vaultAddr}`);
    const sweepAccount = privateKeyToAccount(key);
    const wc = createWalletClient({ account: sweepAccount, chain: TARGET_CHAIN, transport: http(RPC_URL) });
    await wc.sendTransaction({ to: vaultAddr, value: sweepAmount });
  } catch (e) {
    console.warn(`[workPublisher] auto-sweep failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _getMemberOwner(
  publicClient: any,
  coreAddr:     `0x${string}`,
  tokenId:      number,
  fallback:     `0x${string}`,
): Promise<`0x${string}`> {
  if (!coreAddr) return fallback;
  try {
    const owner = await publicClient.readContract({
      address:      coreAddr,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberOwner",
      args:         [BigInt(tokenId)],
    }) as `0x${string}`;
    return owner && owner !== "0x0000000000000000000000000000000000000000" ? owner : fallback;
  } catch {
    return fallback;
  }
}
