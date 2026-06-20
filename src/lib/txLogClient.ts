/**
 * txLogClient.ts — browser-side helpers to record wallet-submitted transactions
 * into the Neon tx_log ledger via /api/tx-log. Fire-and-forget: a failed log
 * write must never block or fail the wallet flow itself.
 */

"use client";

export function logTxClient(params: {
  txHash: string;
  type: string;
  contractName: string;
  functionName: string;
  fromAddress?: string;
  targetAddress?: string;
  workId?: string;
  relatedTokenId?: number;
  label?: string;
}): void {
  fetch("/api/tx-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initiator: "user", ...params }),
  }).catch(() => { /* best-effort */ });
}

export function confirmTxClient(txHash: string, blockNumber?: number): void {
  fetch("/api/tx-log", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash, status: "confirmed", blockNumber }),
  }).catch(() => { /* best-effort */ });
}
