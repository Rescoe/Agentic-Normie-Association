/**
 * /api/tx-log — lets the browser record user-initiated wallet transactions
 * (register, castVote, initiateWorkSession) into the same tx_log ledger the
 * relayer writes to server-side. The wallet/tx itself happens client-side via
 * wagmi; this endpoint is just the Neon write the client can't do directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { logTxSubmitted, logTxConfirmed, logTxFailed, listTxLog, type TxInitiator } from "@/lib/txLog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const rows = await listTxLog(Math.min(limit, 500));
  return NextResponse.json({ entries: rows });
}

interface SubmitBody {
  txHash:         string;
  type:           string;
  initiator?:     TxInitiator;
  contractName:   string;
  functionName:   string;
  fromAddress?:   string;
  targetAddress?: string;
  workId?:        string;
  relatedTokenId?: number;
  label?:         string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as SubmitBody;
  if (!body.txHash || !body.type || !body.contractName || !body.functionName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  await logTxSubmitted({
    txHash:         body.txHash,
    type:           body.type,
    initiator:      body.initiator ?? "user",
    contractName:   body.contractName,
    functionName:   body.functionName,
    fromAddress:    body.fromAddress,
    targetAddress:  body.targetAddress,
    workId:         body.workId,
    relatedTokenId: body.relatedTokenId,
    label:          body.label,
  });
  return NextResponse.json({ ok: true });
}

interface ConfirmBody {
  txHash:       string;
  status:       "confirmed" | "failed";
  blockNumber?: number;
  error?:       string;
  resultData?:  Record<string, unknown>;
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as ConfirmBody;
  if (!body.txHash || !body.status) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (body.status === "confirmed") {
    await logTxConfirmed(body.txHash, body.blockNumber, body.resultData);
  } else {
    await logTxFailed(body.txHash, body.error ?? "unknown error");
  }
  return NextResponse.json({ ok: true });
}
