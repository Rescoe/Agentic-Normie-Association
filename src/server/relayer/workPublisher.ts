/**
 * workPublisher.ts
 *
 * Calls WorkRegistry.publish() on Base via the relayer wallet.
 *
 * Constraint: the relayer wallet must be the holderAddress of the RAPPORTEUR
 * role in AssociationCore (i.e., must hold the RAPPORTEUR NFT on mainnet).
 * If not, publish() reverts with NotRapporteur — the work stays in PUBLISHING
 * state for manual retry once the relayer is properly set up.
 *
 * Content encoding: data:text/html;base64,<b64> — no IPFS, stored directly
 * in WorkRegistry.works[n].content on Base.
 */

import { createPublicClient, createWalletClient, http, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  WORK_REGISTRY_ABI,
  ASSOCIATION_CORE_ABI,
  COLLECTION_FACTORY_ABI,
  NORMIE_COLLECTION_ABI,
  CONTRACT_ADDRESSES,
} from "@/lib/contracts";

const TARGET_CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL      = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export interface PublishResult {
  success:               boolean;
  txHash?:               string;
  onChainWorkId?:        number;
  error?:                string;
  requiresManualPublish?: boolean;
}

export interface MintResult {
  success:           boolean;
  collectionAddress?: string;
  editionTokenId?:   number;
  txHash?:           string;
  error?:            string;
  skipped?:          string;  // set when relayer != AUTHOR owner — not an error, manual path required
}

/**
 * Publishes an HTML work on-chain via WorkRegistry.publish().
 * htmlContent is encoded as base64 data URI before submission.
 */
export async function publishWork(
  htmlContent:       string,
  authorTokenId:     number,
  curatorTokenId:    number,
  rapporteurTokenId: number,
): Promise<PublishResult> {
  const key         = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const registryAddr = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

  if (!key) {
    return { success: false, error: "RELAYER_PRIVATE_KEY not configured", requiresManualPublish: true };
  }
  if (!registryAddr) {
    return { success: false, error: "NEXT_PUBLIC_WORK_REGISTRY_ADDRESS not configured", requiresManualPublish: true };
  }

  // Encode HTML as a base64 data URI for on-chain storage
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

    console.log(`[workPublisher] tx submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

    // Derive workId from WorkPublished event (topics[1] = indexed workId)
    let onChainWorkId: number | undefined;
    for (const log of receipt.logs) {
      if (log.topics.length >= 2) {
        onChainWorkId = Number(BigInt(log.topics[1] ?? "0x0"));
        break;
      }
    }

    console.log(`[workPublisher] confirmed — workId=${onChainWorkId} tx=${hash}`);
    return { success: true, txHash: hash, onChainWorkId };

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isNotRapporteur = msg.includes("NotRapporteur") || msg.includes("not rapporteur");
    console.error(`[workPublisher] failed: ${msg}`);
    return {
      success: false,
      error: msg,
      requiresManualPublish: isNotRapporteur,
    };
  }
}

/**
 * After a work is published on-chain, create a NormieCollection for the AUTHOR
 * and mint edition #0 to their address.
 *
 * Requirement: `RELAYER_PRIVATE_KEY` must be the wallet that registered the AUTHOR
 * on AssociationCore (i.e., getMemberOwner(authorTokenId) == relayer address).
 * If not, returns { success: false, skipped: "..." } — not a fatal error.
 */
export async function mintEdition(
  authorTokenId: number,
  authorName:    string,
  htmlContent:   string,
  title:         string,
): Promise<MintResult> {
  const key         = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const factoryAddr = CONTRACT_ADDRESSES.CollectionFactory as `0x${string}`;
  const coreAddr    = CONTRACT_ADDRESSES.AssociationCore   as `0x${string}`;

  if (!key) {
    return { success: false, error: "RELAYER_PRIVATE_KEY not configured" };
  }
  if (!factoryAddr) {
    return { success: false, skipped: "NEXT_PUBLIC_COLLECTION_FACTORY_ADDRESS not configured" };
  }
  if (!coreAddr) {
    return { success: false, error: "NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS not configured" };
  }

  const account      = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });

  // Guard: relayer must be the AUTHOR's registered owner in AssociationCore
  let authorOwner: string;
  try {
    authorOwner = await publicClient.readContract({
      address:      coreAddr,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberOwner",
      args:         [BigInt(authorTokenId)],
    }) as string;
  } catch (e) {
    return { success: false, error: `getMemberOwner(${authorTokenId}) failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (authorOwner.toLowerCase() !== account.address.toLowerCase()) {
    return {
      success: false,
      skipped: `AUTHOR #${authorTokenId} (${authorName}) registered from ${authorOwner} — relayer is ${account.address}. CollectionFactory requires msg.sender == getMemberOwner(). Manual creation needed.`,
    };
  }

  const walletClient = createWalletClient({ account, chain: TARGET_CHAIN, transport: http(RPC_URL) });
  const collSymbol   = authorName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "ANA";

  // Step 1 — createCollection
  let collectionAddress: string;
  try {
    const hash    = await walletClient.writeContract({
      address:      factoryAddr,
      abi:          COLLECTION_FACTORY_ABI,
      functionName: "createCollection",
      args:         [BigInt(authorTokenId), `${authorName} — ANA Works`, collSymbol],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

    // CollectionCreated event: topics[2] = indexed collection address (padded to 32 bytes)
    collectionAddress = "";
    for (const log of receipt.logs) {
      if (log.topics.length >= 3 && log.address.toLowerCase() === factoryAddr.toLowerCase()) {
        const raw = log.topics[2] ?? "0x";
        collectionAddress = `0x${raw.slice(26)}`;
        break;
      }
    }
    if (!collectionAddress || collectionAddress === "0x") {
      return { success: false, error: "CollectionCreated event not found in receipt — cannot determine collection address" };
    }
    console.log(`[workPublisher] collection deployed: ${collectionAddress} for Normie #${authorTokenId}`);
  } catch (e) {
    return { success: false, error: `createCollection failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Step 2 — mint edition #0 to the AUTHOR (= relayer wallet, since they match)
  const b64     = Buffer.from(htmlContent, "utf-8").toString("base64");
  const content = `data:text/html;base64,${b64}`;

  try {
    const hash    = await walletClient.writeContract({
      address:      collectionAddress as `0x${string}`,
      abi:          NORMIE_COLLECTION_ABI,
      functionName: "mint",
      args:         [account.address, content, title],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

    // TokenMinted event: topics[1] = indexed tokenId
    let editionTokenId = 0;
    for (const log of receipt.logs) {
      if (log.topics.length >= 2 && log.address.toLowerCase() === collectionAddress.toLowerCase()) {
        editionTokenId = Number(BigInt(log.topics[1] ?? "0x0"));
        break;
      }
    }

    console.log(`[workPublisher] minted edition #${editionTokenId} in ${collectionAddress}`);
    return { success: true, collectionAddress, editionTokenId, txHash: hash };
  } catch (e) {
    return {
      success: false,
      error:   `mint failed: ${e instanceof Error ? e.message : String(e)}`,
      collectionAddress,
    };
  }
}
