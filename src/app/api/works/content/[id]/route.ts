/**
 * GET /api/works/content/[id]
 * Returns the HTML content of an on-chain work by its WorkRegistry id.
 *
 * Strategy (in order):
 *  1. readContract getWork()  — server-side, pas de limite RPC browser
 *  2. getLogs WorkPublished   — fallback si readContract échoue ou retourne vide
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { WorkRegistryAbi } from "@/lib/abis/WorkRegistry";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 25_000 }),
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

function findDataUri(raw: string): string | null {
  const idx = raw.indexOf("data:text/html");
  return idx !== -1 ? raw.slice(idx) : null;
}

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

  // ── 1. readContract server-side (primary) ────────────────────────────────
  try {
    const work = await client.readContract({
      address:      WR_ADDR,
      abi:          WorkRegistryAbi,
      functionName: "getWork",
      args:         [BigInt(onChainId)],
    }) as { id: bigint; content: string; authorTokenId: bigint; curatorTokenId: bigint; rapporteurTokenId: bigint; publishedAt: bigint; archived: boolean };

    const content = findDataUri(work.content ?? "");
    if (content) {
      console.log(`[works/content] readContract ok — work #${onChainId}, ${content.length} chars`);
      return NextResponse.json({ content, source: "contract" });
    }
    console.warn(`[works/content] readContract returned unparseable content for #${onChainId}: "${String(work.content).slice(0, 80)}"`);
  } catch (e) {
    console.error(`[works/content] readContract error for #${onChainId}:`, e);
  }

  // ── 2. getLogs WorkPublished (fallback) ──────────────────────────────────
  try {
    const latest    = await client.getBlockNumber();
    const fromBlock = latest > 2_000_000n ? latest - 2_000_000n : 0n;
    const CHUNK     = 2_000n;
    let cursor      = fromBlock;

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
          const raw     = (logs[0].args as Record<string, unknown>).content as string | undefined;
          const content = raw ? findDataUri(raw) : null;
          if (content) {
            console.log(`[works/content] getLogs ok — work #${onChainId} found at block ~${cursor}`);
            return NextResponse.json({ content, source: "logs" });
          }
        }
      } catch { /* skip chunk */ }
      cursor = end + 1n;
    }
    console.warn(`[works/content] getLogs: no WorkPublished found for #${onChainId} in last 2M blocks`);
  } catch (e) {
    console.error(`[works/content] getLogs error for #${onChainId}:`, e);
  }

  return NextResponse.json({ error: "Content not found on-chain", source: "none" }, { status: 404 });
}
