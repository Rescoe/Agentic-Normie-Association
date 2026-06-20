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

import { CONTRACT_ADDRESSES } from "./contracts";
import { decodeSelector } from "./functionSelectors";
import { logTxSubmitted, logTxConfirmed, logTxFailed, type TxInitiator } from "./txLog";

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

  const addresses = [
    RELAYER_ADDR,
    ...Object.values(CONTRACT_ADDRESSES).filter(Boolean).map(a => a.toLowerCase()),
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

    await logTxSubmitted({
      txHash:        tx.hash,
      type,
      initiator,
      contractName:  decoded.contractName,
      functionName:  decoded.functionName,
      fromAddress:   tx.from,
      targetAddress: tx.to,
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
