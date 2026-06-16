/**
 * GET /api/works/content/[id]
 * Returns the HTML content of an on-chain work by its WorkRegistry id.
 *
 * Strategy (in order):
 *  1. workStore has txHash → decode WorkPublished log from receipt (fastest, exact)
 *  2. getLogs scan for WorkPublished(workId=id) over last ~500k blocks (fallback)
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, decodeEventLog } from "viem";
import { base } from "viem/chains";
import { WorkRegistryAbi } from "@/lib/abis/WorkRegistry";
import { listWorks } from "@/lib/workStore";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 20_000 }),
});

const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

const WORK_PUBLISHED_EVENT = {
  type:    "event" as const,
  name:    "WorkPublished",
  inputs:  [
    { indexed: true,  name: "workId",           type: "uint256" },
    { indexed: false, name: "content",           type: "string"  },
    { indexed: true,  name: "authorTokenId",     type: "uint256" },
    { indexed: true,  name: "rapporteurTokenId", type: "uint256" },
    { indexed: false, name: "timestamp",         type: "uint256" },
  ],
} as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const onChainId = Number(params.id);
  if (!Number.isInteger(onChainId) || onChainId <= 0) {
    return NextResponse.json({ error: "Invalid work id" }, { status: 400 });
  }

  if (!WR_ADDR) {
    return NextResponse.json({ error: "WorkRegistry not configured" }, { status: 503 });
  }

  // ── 1. txHash from workStore → decode receipt log ─────────────────────────
  let txHash: `0x${string}` | undefined;
  try {
    const works = await listWorks();
    const match = works.find(w => w.onChainWorkId === onChainId && w.txHash);
    if (match?.txHash) txHash = match.txHash as `0x${string}`;
  } catch { /* workStore unavailable */ }

  if (txHash) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi:       WorkRegistryAbi,
            eventName: "WorkPublished",
            data:      log.data,
            topics:    log.topics as [`0x${string}`, ...`0x${string}`[]],
          });
          const content = (decoded.args as Record<string, unknown>).content as string | undefined;
          if (content) {
            return NextResponse.json({ content, source: "receipt" });
          }
        } catch { /* not the WorkPublished log */ }
      }
    } catch (e) {
      console.error(`[works/content] receipt error for txHash ${txHash}:`, e);
    }
  }

  // ── 2. getLogs fallback ───────────────────────────────────────────────────
  try {
    const latest   = await client.getBlockNumber();
    const fromBlock = latest > 500_000n ? latest - 500_000n : 0n;

    // getLogs in 2k-block chunks to respect Base RPC limits
    const CHUNK = 2_000n;
    let cursor = fromBlock;
    while (cursor <= latest) {
      const end = cursor + CHUNK - 1n > latest ? latest : cursor + CHUNK - 1n;
      try {
        const logs = await client.getLogs({
          address:   WR_ADDR,
          event:     WORK_PUBLISHED_EVENT,
          args:      { workId: BigInt(onChainId) },
          fromBlock: cursor,
          toBlock:   end,
        });
        if (logs.length > 0) {
          const content = (logs[0].args as Record<string, unknown>).content as string | undefined;
          if (content) {
            return NextResponse.json({ content, source: "logs" });
          }
        }
      } catch { /* skip chunk */ }
      cursor = end + 1n;
    }
  } catch (e) {
    console.error(`[works/content] getLogs error for workId ${onChainId}:`, e);
  }

  return NextResponse.json({ error: "Content not found on-chain", source: "none" }, { status: 404 });
}
