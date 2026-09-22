/**
 * memorialPublisher.ts
 *
 * Relayer-signed calls into the shared ANAMemorials contract — replaces the old
 * per-memorial deployCollection()+initializeCollection() dance (workPublisher.ts)
 * for burn memorials specifically. Relayer-paid steps, all cheap (storage
 * writes / a plain mint, no contract deployment):
 *
 *  1. registerMemorialOnChain() — creates the series (artwork, pricing, pools).
 *     Creator payout resolution happens ON-CHAIN, inside the contract, via
 *     AssociationCore.getMemberOwner() — no need to resolve it here.
 *  2. addReservedClaimsOnChain() — reserves one free edition per honored burned
 *     Normie's last owner. Chunked by the caller (see CHUNK_SIZE) so a large
 *     batch period never risks a single oversized transaction.
 *  3. deliverRequesterEditionOnChain() — auto-delivers the requester's own
 *     reserved edition right after step 1, instead of requiring them to come
 *     back and call mintRequester() themselves. They already paid via
 *     payForRequest() at request time — this just removes the extra manual
 *     step. Always mints to the series' stored requesterAddr regardless of
 *     who calls it (see ANAMemorials.sol's mintRequester()) — best-effort,
 *     non-blocking: if it fails, the requester can still self-claim later,
 *     so a failure here should never hold up the rest of the publishing
 *     pipeline.
 *
 * mintPublic()/claimFree() are paid for and gas-metered by whoever calls
 * them directly — never routed through the relayer.
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
  creatorName:            string;
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
  if (!addr) return { error: "ANA_MEMORIALS_ADDRESS not configured" } as const;

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
        params.creatorName,
        params.priceWei,
        BigInt(params.publicSupply),
        BigInt(params.requesterSupply),
        (params.requesterAddr ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
        params.openEnded,
        BigInt(params.claimDurationSeconds),
      ],
      // Was 2M — wrong: no contract gets deployed here anymore, but
      // `artworkContent` IS still stored entirely in this call's
      // MemorialSeries struct via a genuinely expensive cold SSTORE. Fixed to
      // 10M, then to 15M when MEMORIAL_CANVAS_W/H grew 4x (encodeArtworkContent,
      // pixelImage.ts, now usually picks the RLE/SVG encoding over BMP, but
      // its own worst case — MAX_SHAPES circles at MAX_CIRCLE_RADIUS plus a
      // maxed-out MAX_DOTS_TOTAL_AREA patch, see memorialArt.ts — measured at
      // ~10M gas with an explicit Hardhat gas limit, not eth_estimateGas
      // (this project's public RPC, mainnet.base.org, fails that call outright
      // above a certain calldata/storage size with no decodable revert reason,
      // hence always passing an explicit value here). 15M keeps real margin
      // under the node's ~16.7M-gas transaction cap even at that worst case.
      gas: 15_000_000n,
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

export interface DeliverRequesterEditionResult {
  success:  boolean;
  txHash?:  string;
  tokenId?: number;
  error?:   string;
}

/**
 * Auto-delivers the requester's reserved edition — the requester already
 * paid via payForRequest() at request time, so this is purely a UX
 * convenience (no payment involved). Best-effort by design: callers should treat a failure
 * here as non-fatal, since the requester can always call mintRequester()
 * themselves later from the mint/claim panel.
 */
export async function deliverRequesterEditionOnChain(
  memorialId: number, workIdForLog?: string,
): Promise<DeliverRequesterEditionResult> {
  const clients = getClients();
  if ("error" in clients) return { success: false, error: clients.error };
  const { account, walletClient, publicClient, addr } = clients;

  try {
    const hash = await walletClient.writeContract({
      address:      addr,
      abi:          ANA_MEMORIALS_ABI,
      functionName: "mintRequester",
      args:         [BigInt(memorialId)],
      // A plain mint (increment a counter, one ERC-721 _safeMint) — no large
      // string storage involved here, unlike registerMemorial(). Generous
      // margin over what it should actually need.
      gas: 500_000n,
    });

    await logTxSubmitted({
      txHash: hash, type: "deliver-requester-edition", initiator: "relayer",
      contractName: "ANAMemorials", functionName: "mintRequester",
      fromAddress: account.address, targetAddress: addr, workId: workIdForLog,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") {
      const err = `mintRequester (auto-delivery) reverted on-chain (gasUsed: ${receipt.gasUsed}) — tx: ${hash}`;
      await logTxFailed(hash, err);
      return { success: false, error: err, txHash: hash };
    }

    let tokenId: number | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== addr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: ANA_MEMORIALS_ABI, eventName: "EditionMinted",
          data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        tokenId = Number((decoded.args as { tokenId: bigint }).tokenId);
        break;
      } catch { /* not EditionMinted */ }
    }

    await logTxConfirmed(hash, receipt.blockNumber, { tokenId });
    return { success: true, txHash: hash, tokenId };
  } catch (e) {
    return { success: false, error: `mintRequester (auto-delivery) failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
