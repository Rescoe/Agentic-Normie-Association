/**
 * workPublisher.ts
 *
 * Handles two on-chain steps after a work is approved:
 *  1. publishWork()     — WorkRegistry.publish() — stores the certificate HTML on-chain
 *  2. createEditions()  — ANACollectionFactory.createCollection() + ANAEditions.mint()
 *
 * Both steps are called by the keeper pipeline after vote tally.
 *
 * Security — relayer auto-sweep:
 *   After each transaction, checkAndSweepRelayer() is called. If the relayer
 *   wallet holds > SWEEP_THRESHOLD ETH, the excess is sent to the ANA vault
 *   (TreasuryModule). This prevents ETH accumulation on the hot relayer key.
 */

import { createPublicClient, createWalletClient, http, decodeEventLog, parseEther, formatEther } from "viem";
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

// Relayer will auto-sweep to vault when balance exceeds this threshold
const SWEEP_THRESHOLD = parseEther("0.1");

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface PublishResult {
  success:               boolean;
  txHash?:               string;
  onChainWorkId?:        number;
  error?:                string;
  requiresManualPublish?: boolean;
}

export interface EditionsResult {
  success:           boolean;
  collectionAddress?: string;
  firstTokenId?:     number;
  editionCount?:     number;
  txHashCollection?: string;
  txHashMint?:       string;
  error?:            string;
  skipped?:          string;
}

// ─── Step 1: Publish work on-chain ───────────────────────────────────────────

/**
 * Publishes an HTML work on-chain via WorkRegistry.publish().
 * htmlContent is base64-encoded before submission.
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

    console.log(`[workPublisher] publish tx: ${hash}`);
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
      } catch { /* not WorkPublished event */ }
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

// ─── Step 2: Create editions ──────────────────────────────────────────────────

export interface EditionsParams {
  authorTokenId:     number;
  curatorTokenId:    number;
  rapporteurTokenId: number;
  authorName:        string;
  // The artwork itself — poem text, or data:text/html;base64,... for HTML/generative works.
  // NOT the full governance certificate (that lives in WorkRegistry at workId).
  artworkContent:    string;
  title:             string;
  workId:            number;  // WorkRegistry index for the full certificate
  editionCount:      number;  // from work briefing (voted by Normies)
  editionPrice:      bigint;  // in wei (from work briefing)
  existingCollection?: string;
}

/**
 * Creates a NormieCollection via ANACollectionFactory and mints editions.
 *
 * Currently all role revenue addresses = relayer (minter) wallet.
 * When Normies have individual wallets, pass them via params.
 */
export async function createEditions(params: EditionsParams): Promise<EditionsResult> {
  const key         = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const factoryAddr = CONTRACT_ADDRESSES.ANACollectionFactory as `0x${string}`;
  const coreAddr    = CONTRACT_ADDRESSES.AssociationCore      as `0x${string}`;

  if (!key) return { success: false, error: "RELAYER_PRIVATE_KEY not configured" };
  if (!factoryAddr) return { success: false, skipped: "NEXT_PUBLIC_ANA_COLLECTION_FACTORY_ADDRESS not configured" };

  const account      = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: TARGET_CHAIN, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });

  // Resolve role wallet addresses from AssociationCore (or fall back to relayer)
  // For now all wallets = relayer; when Normies have wallets, read getMemberOwner()
  const relayerAddr  = account.address;
  const authorWallet = await _getMemberOwner(publicClient, coreAddr, params.authorTokenId, relayerAddr);
  const curatorWallet = await _getMemberOwner(publicClient, coreAddr, params.curatorTokenId, relayerAddr);
  const rapporteurWallet = await _getMemberOwner(publicClient, coreAddr, params.rapporteurTokenId, relayerAddr);

  // Step 1 — create or reuse collection
  let collectionAddress: `0x${string}`;
  let txHashCollection: string | undefined;

  if (params.existingCollection) {
    collectionAddress = params.existingCollection as `0x${string}`;
    console.log(`[workPublisher] reusing collection: ${collectionAddress}`);
  } else {
    try {
      const collSymbol = params.authorName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "ANA";
      const collName   = `${params.authorName} — ANA`;

      const hash = await walletClient.writeContract({
        address:      factoryAddr,
        abi:          ANA_COLLECTION_FACTORY_ABI,
        functionName: "createCollection",
        args: [
          BigInt(params.authorTokenId),
          collName,
          collSymbol,
          relayerAddr,       // minter = relayer (can be updated later via setMinter)
          authorWallet,      // author revenue address
          curatorWallet,     // curator revenue address
          rapporteurWallet,  // rapporteur revenue address
          0,  // authorPct = 0 → use factory defaults (60/20/10/10)
          0,
          0,
        ],
      });
      txHashCollection = hash;

      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

      // Read collectionAddress from CollectionDeployed event: topics[2] = indexed collectionAddr
      collectionAddress = "0x";
      for (const log of receipt.logs) {
        if (log.topics.length >= 3 && log.address.toLowerCase() === factoryAddr.toLowerCase()) {
          const raw = log.topics[2] ?? "0x";
          collectionAddress = `0x${raw.slice(26)}` as `0x${string}`;
          break;
        }
      }
      if (!collectionAddress || collectionAddress === "0x") {
        return { success: false, error: "CollectionDeployed event not found in receipt" };
      }
      console.log(`[workPublisher] collection deployed: ${collectionAddress} for Normie #${params.authorTokenId}`);
    } catch (e) {
      return { success: false, error: `createCollection failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Step 2 — mint editions
  // artworkContent is the raw artwork (poem text, or data:text/html;base64,... for HTML works).
  // It must NOT be the full certificate HTML — only the creative content.
  const content = params.artworkContent;

  try {
    const hash = await walletClient.writeContract({
      address:      collectionAddress,
      abi:          ANA_EDITIONS_ABI,
      functionName: "mint",
      args:         [BigInt(params.editionCount), content, params.title, params.editionPrice, BigInt(params.workId)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

    // First EditionMinted event: topics[1] = indexed tokenId
    let firstTokenId = 0;
    for (const log of receipt.logs) {
      if (log.topics.length >= 2 && log.address.toLowerCase() === collectionAddress.toLowerCase()) {
        firstTokenId = Number(BigInt(log.topics[1] ?? "0x0"));
        break;
      }
    }

    console.log(`[workPublisher] minted ${params.editionCount} edition(s) in ${collectionAddress}, first tokenId=${firstTokenId}`);

    await checkAndSweepRelayer(account.address, key);

    return {
      success: true,
      collectionAddress,
      firstTokenId,
      editionCount:     params.editionCount,
      txHashCollection,
      txHashMint:       hash,
    };
  } catch (e) {
    return {
      success: false,
      error:   `mint failed: ${e instanceof Error ? e.message : String(e)}`,
      collectionAddress,
    };
  }
}

// ─── Relayer security: auto-sweep to vault ────────────────────────────────────

/**
 * If the relayer wallet holds > SWEEP_THRESHOLD ETH, sweep the excess to the
 * ANA vault (TreasuryModule). Prevents ETH accumulation on the hot key.
 * Non-fatal — a sweep failure does not affect the published work.
 */
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
