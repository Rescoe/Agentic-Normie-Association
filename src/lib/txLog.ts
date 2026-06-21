/**
 * txLog.ts — direct on-chain transaction ledger in Neon Postgres.
 *
 * Replaces the need to re-scan the blockchain for activity: every tx ANA submits
 * (relayer, user wallet, owner) is recorded here the moment it's sent, then
 * updated once the receipt comes back. One row per tx, indexed table — not a
 * JSON blob — since this is the part of the data model expected to grow.
 */

import { sql, USE_NEON } from "./db";

export type TxInitiator = "user" | "normie" | "owner" | "relayer";
export type TxStatus     = "pending" | "confirmed" | "failed";

export interface TxLogEntry {
  txHash:         string;
  type:           string;   // "register" | "vote" | "publish" | "deploy-collection" | "initialize-collection" | "session-init" | ...
  initiator:      TxInitiator;
  contractName:   string;
  functionName:   string;
  fromAddress?:   string;   // who submitted the tx (relayer wallet, or the user's wallet)
  targetAddress?: string;   // the contract address actually called — lets anyone verify on BaseScan
  workId?:        string;   // internal ANAWork id, when this tx belongs to a work's pipeline
  relatedTokenId?: number;  // the Normie tokenId this tx is "about" (author, voter, registrant…)
  label?:         string;   // short human label, e.g. a collection name
  resultData?:    Record<string, unknown>;
}

let _tableReady = false;

async function ensureTable() {
  if (_tableReady || !USE_NEON) return;
  await sql()`
    CREATE TABLE IF NOT EXISTS tx_log (
      tx_hash       TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      initiator     TEXT NOT NULL,
      contract_name TEXT NOT NULL,
      function_name TEXT NOT NULL,
      from_address  TEXT,
      work_id       TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      block_number  BIGINT,
      error         TEXT,
      result_data   JSONB,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at  TIMESTAMPTZ
    )
  `;
  // Added after the table already existed in prod — ALTER ... ADD COLUMN IF NOT EXISTS
  // backfills it on existing deployments without a separate migration step.
  await sql()`ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS target_address TEXT`;
  await sql()`ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS related_token_id INTEGER`;
  await sql()`ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS label TEXT`;
  await sql()`CREATE INDEX IF NOT EXISTS tx_log_created_at_idx ON tx_log (created_at DESC)`;
  await sql()`CREATE INDEX IF NOT EXISTS tx_log_work_id_idx ON tx_log (work_id)`;
  _tableReady = true;
}

/** Call right after a tx hash comes back from the wallet/relayer, before waiting for the receipt. */
export async function logTxSubmitted(entry: TxLogEntry): Promise<void> {
  if (!USE_NEON) return;
  try {
    await ensureTable();
    await sql()`
      INSERT INTO tx_log (tx_hash, type, initiator, contract_name, function_name, from_address, target_address, work_id, related_token_id, label, status)
      VALUES (${entry.txHash}, ${entry.type}, ${entry.initiator}, ${entry.contractName}, ${entry.functionName},
              ${entry.fromAddress ?? null}, ${entry.targetAddress ?? null}, ${entry.workId ?? null},
              ${entry.relatedTokenId ?? null}, ${entry.label ?? null}, 'pending')
      ON CONFLICT (tx_hash) DO NOTHING
    `;
  } catch (e) {
    console.warn(`[txLog] logTxSubmitted failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Call once the receipt is confirmed on-chain. */
export async function logTxConfirmed(
  txHash: string,
  blockNumber?: number | bigint,
  resultData?: Record<string, unknown>,
): Promise<void> {
  if (!USE_NEON) return;
  try {
    await ensureTable();
    await sql()`
      UPDATE tx_log
      SET status = 'confirmed', block_number = ${blockNumber ? Number(blockNumber) : null},
          result_data = ${resultData ? JSON.stringify(resultData) : null}, confirmed_at = NOW()
      WHERE tx_hash = ${txHash}
    `;
  } catch (e) {
    console.warn(`[txLog] logTxConfirmed failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Call if the tx reverted or the relayer call threw before a receipt. */
export async function logTxFailed(txHash: string, error: string): Promise<void> {
  if (!USE_NEON) return;
  try {
    await ensureTable();
    await sql()`
      UPDATE tx_log SET status = 'failed', error = ${error.slice(0, 500)}, confirmed_at = NOW()
      WHERE tx_hash = ${txHash}
    `;
  } catch (e) {
    console.warn(`[txLog] logTxFailed failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Backfills label/related_token_id on a row already in tx_log (e.g. one inserted
 *  before commit acf9c48 added those fields, or by the Etherscan backfill before it
 *  could decode full call args). Never overwrites a value that's already set. */
export async function updateTxLabel(
  txHash: string,
  label?: string,
  relatedTokenId?: number,
): Promise<void> {
  if (!USE_NEON || (label === undefined && relatedTokenId === undefined)) return;
  try {
    await ensureTable();
    await sql()`
      UPDATE tx_log
      SET label = COALESCE(label, ${label ?? null}),
          related_token_id = COALESCE(related_token_id, ${relatedTokenId ?? null})
      WHERE tx_hash = ${txHash}
    `;
  } catch (e) {
    console.warn(`[txLog] updateTxLabel failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Rows missing a label or related_token_id — candidates for the re-decode backfill. */
export async function listIncompleteTxLog(limit = 500): Promise<TxLogRow[]> {
  if (!USE_NEON) return [];
  await ensureTable();
  const rows = await sql()`
    SELECT * FROM tx_log WHERE label IS NULL OR related_token_id IS NULL
    ORDER BY created_at DESC LIMIT ${limit}
  ` as TxLogRow[];
  return rows;
}

export interface TxLogRow {
  tx_hash: string;
  type: string;
  initiator: TxInitiator;
  contract_name: string;
  function_name: string;
  from_address: string | null;
  target_address: string | null;
  work_id: string | null;
  related_token_id: number | null;
  label: string | null;
  status: TxStatus;
  block_number: number | null;
  error: string | null;
  result_data: Record<string, unknown> | null;
  created_at: string;
  confirmed_at: string | null;
}

export async function listTxLog(limit = 100): Promise<TxLogRow[]> {
  if (!USE_NEON) return [];
  await ensureTable();
  const rows = await sql()`
    SELECT * FROM tx_log ORDER BY created_at DESC LIMIT ${limit}
  ` as TxLogRow[];
  return rows;
}
