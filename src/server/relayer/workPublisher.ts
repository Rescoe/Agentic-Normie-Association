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

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { WORK_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";

const TARGET_CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL      = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export interface PublishResult {
  success:               boolean;
  txHash?:               string;
  onChainWorkId?:        number;
  error?:                string;
  requiresManualPublish?: boolean;
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
