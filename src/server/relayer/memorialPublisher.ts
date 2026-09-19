/**
 * memorialPublisher.ts
 *
 * Relayer-signed calls into the shared ANAMemorials contract — replaces the old
 * per-memorial deployCollection()+initializeCollection() dance (workPublisher.ts)
 * for burn memorials specifically. Two relayer-paid steps only, both cheap
 * (storage writes, no contract deployment):
 *
 *  1. registerMemorialOnChain() — creates the series (artwork, pricing, pools).
 *     Creator payout resolution happens ON-CHAIN, inside the contract, via
 *     AssociationCore.getMemberOwner() — no need to resolve it here.
 *  2. addReservedClaimsOnChain() — reserves one free edition per honored burned
 *     Normie's last owner. Chunked by the caller (see CHUNK_SIZE) so a large
 *     batch period never risks a single oversized transaction.
 *
 * All actual minting (public/requester/free-claim) is paid for and gas-metered
 * by whoever calls it directly — never routed through the relayer.
 */
import { createPublicClient, createWalletClient, http, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { ANA_MEMORIALS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { logTxSubmitted, logTxConfirmed, logTxFailed } from "@/lib/txLog";

const TARGET_CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL      = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

// Keeps addReservedClaims comfortably under mainnet.base.org's confirmed
// ~16.7M-gas transaction cap even for a large batch period — see
// ANAMemorials.sol's own comment and the test suite's gas-cap sanity check
// (150 entries stays well under it; 100 leaves further margin still).
export const RESERVED_CLAIMS_CHUNK_SIZE = 100;

export interface RegisterMemorialParams {
  title:                  string;
  artworkContent:         string; // data URI (BMP)
  workId:                 number; // WorkRegistry id, 0 if not linked
  creatorProposerTokenId: number;
  priceWei:               bigint;
  publicSupply:           number;
  requesterSupply:        number;
  requesterAddr?:         string; // required if requesterSupply > 0
  openEnded:              boolean;
  claimDurationSeconds:   number;
  workIdForLog?:          string; // ANAWork id, for tx_log only
}

export interface RegisterMemorialResult {
  success:     boolean;
  txHash?:     string;
  memorialId?: number;
  error?:      string;
}

export interface AddReservedClaimsParams {
  memorialId:        number;
  burnedTokenIds:     number[];
  eligibleRecipients: string[];
  workIdForLog?:      string;
}

export interface AddReservedClaimsResult {
  success:      boolean;
  txHashes:     string[];
  error?:       string;
}

function getClients() {
  const key   = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const addr  = CONTRACT_ADDRESSES.ANAMemorials as `0x${string}`;
  if (!key)  return { error: "RELAYER_PRIVATE_KEY not configured" } as const;
  if (!addr) return { error: "NEXT_PUBLIC_ANA_MEMORIALS_ADDRESS not configured" } as const;

  const account      = privateKeyToAccount(key);
  const walletClient = createWalletClient({ account, chain: TARGET_CHAIN, transport: http(RPC_URL) });
  const publicClient = createPublicClient({ chain: TARGET_CHAIN, transport: http(RPC_URL) });
  return { account, walletClient, publicClient, addr } as const;
}

export async function registerMemorialOnChain(
  params: RegisterMemorialParams,
): Promise<RegisterMemorialResult> {
  const clients = getClients();
  if ("error" in clients) return { success: false, error: clients.error };
  const { account, walletClient, publicClient, addr } = clients;

  if (params.requesterSupply > 0 && !params.requesterAddr) {
    return { success: false, error: "requesterAddr required when requesterSupply > 0" };
  }

  try {
    const hash = await walletClient.writeContract({
      address:      addr,
      abi:          ANA_MEMORIALS_ABI,
      functionName: "registerMemorial",
      args: [
        params.title,
        params.artworkContent,
        BigInt(params.workId),
        BigInt(params.creatorProposerTokenId),
        params.priceWei,
        BigInt(params.publicSupply),
        BigInt(params.requesterSupply),
        (params.requesterAddr ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
        params.openEnded,
        BigInt(params.claimDurationSeconds),
      ],
      // Well within what a single storage-write-only call needs (no contract
      // deployment happens here anymore) — see ANAMemorials.sol for why an
      // explicit gas value is used at all: this repo's public RPC
      // (mainnet.base.org) fails eth_estimateGas outright above a certain
      // calldata/storage size, with no decodable revert reason.
      gas: 2_000_000n,
    });

    await logTxSubmitted({
      txHash: hash, type: "register-memorial", initiator: "relayer",
      contractName: "ANAMemorials", functionName: "registerMemorial",
      fromAddress: account.address, targetAddress: addr, workId: params.workIdForLog,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") {
      const err = `registerMemorial reverted on-chain (gasUsed: ${receipt.gasUsed}) — tx: ${hash}`;
      await logTxFailed(hash, err);
      return { success: false, error: err, txHash: hash };
    }

    let memorialId: number | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== addr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: ANA_MEMORIALS_ABI, eventName: "MemorialRegistered",
          data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        memorialId = Number((decoded.args as { memorialId: bigint }).memorialId);
        break;
      } catch { /* not MemorialRegistered */ }
    }

    // Same class of fallback as workPublisher.ts's publishWork(): if the event
    // doesn't decode, series.length-1 right after this confirmed tx IS this
    // memorial's id — only this relayer ever calls registerMemorial().
    if (memorialId == null) {
      try {
        const count = await publicClient.readContract({
          address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeriesCount",
        }) as bigint;
        if (count > 0n) memorialId = Number(count) - 1;
      } catch (e) {
        console.error("[memorialPublisher] getSeriesCount() fallback failed:", e);
      }
    }

    await logTxConfirmed(hash, receipt.blockNumber, { memorialId });
    return { success: true, txHash: hash, memorialId };
  } catch (e) {
    return { success: false, error: `registerMemorial failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function addReservedClaimsOnChain(
  params: AddReservedClaimsParams,
): Promise<AddReservedClaimsResult> {
  const clients = getClients();
  if ("error" in clients) return { success: false, txHashes: [], error: clients.error };
  const { walletClient, publicClient, addr } = clients;

  if (params.burnedTokenIds.length !== params.eligibleRecipients.length) {
    return { success: false, txHashes: [], error: "burnedTokenIds/eligibleRecipients length mismatch" };
  }

  const txHashes: string[] = [];
  for (let i = 0; i < params.burnedTokenIds.length; i += RESERVED_CLAIMS_CHUNK_SIZE) {
    const idsChunk        = params.burnedTokenIds.slice(i, i + RESERVED_CLAIMS_CHUNK_SIZE).map(BigInt);
    const recipientsChunk = params.eligibleRecipients.slice(i, i + RESERVED_CLAIMS_CHUNK_SIZE) as `0x${string}`[];

    try {
      const hash = await walletClient.writeContract({
        address: addr, abi: ANA_MEMORIALS_ABI, functionName: "addReservedClaims",
        args: [BigInt(params.memorialId), idsChunk, recipientsChunk],
        gas: 4_000_000n, // 100-entry chunks stay well under this (~150 entries measured under 16M in tests)
      });

      await logTxSubmitted({
        txHash: hash, type: "add-reserved-claims", initiator: "relayer",
        contractName: "ANAMemorials", functionName: "addReservedClaims",
        fromAddress: walletClient.account!.address, targetAddress: addr, workId: params.workIdForLog,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (receipt.status !== "success") {
        const err = `addReservedClaims reverted on-chain (chunk ${i}-${i + idsChunk.length}, gasUsed: ${receipt.gasUsed}) — tx: ${hash}`;
        await logTxFailed(hash, err);
        return { success: false, txHashes, error: err };
      }

      await logTxConfirmed(hash, receipt.blockNumber, { chunkStart: i, chunkSize: idsChunk.length });
      txHashes.push(hash);
    } catch (e) {
      const err = `addReservedClaims failed (chunk ${i}-${i + idsChunk.length}): ${e instanceof Error ? e.message : String(e)}`;
      return { success: false, txHashes, error: err };
    }
  }

  return { success: true, txHashes };
}
