/**
 * etherscanBackfill.ts — one-off historical import of on-chain txs into tx_log.
 *
 * tx_log only captures transactions submitted *after* it was added (19/06/2026).
 * Anything before that — including relayer calls that didn't emit one of the 14
 * event types /api/activity/events scans for (e.g. a failed initialize(), a sweep
 * transfer) — isn't in our ledger. Etherscan's V2 API now covers every chain
 * (including Base) through one API key + a chainid param, and "txlist" returns
 * every tx where the queried address is sender OR recipient — exactly what we need
 * to catch calls made *to* our contracts by any address, not just the relayer.
 */

import { createPublicClient, http, decodeFunctionData, type Abi } from "viem";
import { base } from "viem/chains";
import * as abis from "./abis";
import { CONTRACT_ADDRESSES, ANA_COLLECTION_FACTORY_ABI } from "./contracts";
import { decodeSelector } from "./functionSelectors";
import { logTxSubmitted, logTxConfirmed, logTxFailed, listIncompleteTxLog, updateTxLabel, type TxInitiator } from "./txLog";

const rpc = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });

/** Collections deployed dynamically via ANACollectionFactory have no fixed .env address —
 *  list them on-chain so their initialize()/buyAndMint() calls get backfilled too. */
async function getDeployedCollectionAddresses(): Promise<string[]> {
  const factoryAddr = CONTRACT_ADDRESSES.ANACollectionFactory;
  if (!factoryAddr) return [];
  try {
    const addrs = await rpc.readContract({
      address: factoryAddr as `0x${string}`, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "getAllCollections",
    }) as string[];
    return addrs;
  } catch {
    return [];
  }
}

/** Pulls a human-readable label + the most relevant tokenId out of a tx's full call data —
 *  the selector dictionary alone only tells us *which* function was called, not its args. */
function decodeArgsForLabel(
  contractName: string,
  input:        string,
): { label?: string; relatedTokenId?: number } {
  try {
    const abi = (abis as Record<string, Abi>)[`${contractName}Abi`];
    if (!abi) return {};
    const { functionName, args } = decodeFunctionData({ abi, data: input as `0x${string}` });
    if (!args) return {};
    switch (functionName) {
      case "createCollection": // (normieTokenId, name, symbol, minter, ...)
        return { relatedTokenId: Number(args[0]), label: String(args[1]) };
      case "initialize": // ANAEditions.initialize(artworkContent, artworkTitle, workId)
        return { label: String(args[1]) };
      case "publish": // WorkRegistry.publish(content, authorTokenId, curatorTokenId, rapporteurTokenId)
        return { relatedTokenId: Number(args[1]) };
      case "castVote": // ConstituentAssembly.castVote(voterTokenId, role, candidateTokenId)
        return { relatedTokenId: Number(args[0]) };
      case "register": { // AssociationCore.register(attestation, signature)
        const attestation = args[0] as { tokenId?: bigint };
        return attestation?.tokenId !== undefined ? { relatedTokenId: Number(attestation.tokenId) } : {};
      }
      default:
        return {};
    }
  } catch {
    return {}; // malformed/partial input data — non-fatal, just means no extra label
  }
}

const ETHERSCAN_API  = "https://api.etherscan.io/v2/api";
const BASE_CHAIN_ID  = 8453;
const RELAYER_ADDR   = (process.env.RELAYER_ADDRESS ?? "").toLowerCase();

interface EtherscanTx {
  hash:             string;
  from:             string;
  to:               string;
  blockNumber:      string;
  timeStamp:        string;
  input:            string;
  isError:          string; // "0" | "1"
  functionName?:    string;
}

const TYPE_BY_FUNCTION: Record<string, string> = {
  publish:              "publish",
  createCollection:     "deploy-collection",
  initialize:            "initialize-collection",
  register:             "register",
  castVote:              "vote",
  initiateWorkSession:   "session-init",
};

async function fetchTxList(address: string, startBlock: number, apiKey: string): Promise<EtherscanTx[]> {
  const all: EtherscanTx[] = [];
  let page = 1;
  const offset = 1000;
  // Etherscan paginates; loop until a page comes back short (= last page).
  for (;;) {
    const url = `${ETHERSCAN_API}?chainid=${BASE_CHAIN_ID}&module=account&action=txlist`
      + `&address=${address}&startblock=${startBlock}&endblock=99999999`
      + `&page=${page}&offset=${offset}&sort=asc&apikey=${apiKey}`;
    const res  = await fetch(url, { cache: "no-store" });
    const data = await res.json() as { status: string; message: string; result: EtherscanTx[] | string };
    if (data.status !== "1" || !Array.isArray(data.result)) break;
    all.push(...data.result);
    if (data.result.length < offset) break;
    page++;
    await new Promise(r => setTimeout(r, 250)); // stay under Etherscan's free-tier rate limit
  }
  return all;
}

/** Resolves a unix timestamp to the nearest Base block number via Etherscan V2. */
export async function blockNumberAtTimestamp(timestampSec: number, apiKey: string): Promise<number> {
  const url = `${ETHERSCAN_API}?chainid=${BASE_CHAIN_ID}&module=block&action=getblocknobytime`
    + `&timestamp=${timestampSec}&closest=before&apikey=${apiKey}`;
  const res  = await fetch(url, { cache: "no-store" });
  const data = await res.json() as { status: string; result: string };
  if (data.status !== "1") throw new Error(`getblocknobytime failed: ${data.result}`);
  return Number(data.result);
}

export interface BackfillResult {
  scanned:  number;
  inserted: number;
  skipped:  number;
  addresses: string[];
}

/** sinceBlock: pass a Base block number; defaults to scanning from block 0 of the queried address's history. */
export async function backfillTxLog(sinceBlock = 0): Promise<BackfillResult> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) throw new Error("BASESCAN_API_KEY not configured");

  const collectionAddrs = await getDeployedCollectionAddresses();

  const addresses = [
    RELAYER_ADDR,
    ...Object.values(CONTRACT_ADDRESSES).filter(Boolean).map(a => a.toLowerCase()),
    ...collectionAddrs.map(a => a.toLowerCase()),
  ].filter(Boolean);

  const byHash = new Map<string, EtherscanTx>();
  for (const addr of addresses) {
    const txs = await fetchTxList(addr, sinceBlock, apiKey);
    for (const tx of txs) byHash.set(tx.hash.toLowerCase(), tx);
  }

  let inserted = 0;
  let skipped  = 0;

  for (const tx of byHash.values()) {
    const selector = tx.input?.slice(0, 10)?.toLowerCase();
    const decoded  = selector && selector.length === 10 ? decodeSelector(selector) : null;

    if (!decoded) { skipped++; continue; } // not a call to a function we recognize — nothing useful to record

    const type      = TYPE_BY_FUNCTION[decoded.functionName] ?? decoded.functionName;
    const initiator: TxInitiator = tx.from.toLowerCase() === RELAYER_ADDR ? "relayer" : "user";
    const { label, relatedTokenId } = decodeArgsForLabel(decoded.contractName, tx.input);

    await logTxSubmitted({
      txHash:        tx.hash,
      type,
      initiator,
      contractName:  decoded.contractName,
      functionName:  decoded.functionName,
      fromAddress:   tx.from,
      targetAddress: tx.to,
      label,
      relatedTokenId,
    });

    if (tx.isError === "1") {
      await logTxFailed(tx.hash, "Reverted on-chain (backfilled — no revert reason captured)");
    } else {
      await logTxConfirmed(tx.hash, Number(tx.blockNumber));
    }
    inserted++;
  }

  return { scanned: byHash.size, inserted, skipped, addresses };
}

export interface RelabelResult {
  checked: number;
  updated: number;
}

/** Re-decodes call args for rows already in tx_log that predate the label/relatedTokenId
 *  fields (or that the selector-only backfill couldn't fill in). Refetches the original
 *  tx from the chain (tx_log doesn't store raw calldata) to decode it. */
export async function relabelIncompleteTxLog(): Promise<RelabelResult> {
  const rows = await listIncompleteTxLog();
  let updated = 0;

  for (const row of rows) {
    try {
      const tx = await rpc.getTransaction({ hash: row.tx_hash as `0x${string}` });
      if (!tx?.input) continue;
      const { label, relatedTokenId } = decodeArgsForLabel(row.contract_name, tx.input);
      if (label === undefined && relatedTokenId === undefined) continue;
      await updateTxLabel(row.tx_hash, label, relatedTokenId);
      updated++;
    } catch {
      // tx not found / RPC hiccup — leave the row as-is, next run can retry
    }
  }

  return { checked: rows.length, updated };
}
