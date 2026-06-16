/**
 * GET /api/works/html/[id]
 * Serves the on-chain HTML content of a WorkRegistry work directly.
 * Decodes the stored data:text/html;base64,... server-side — no browser atob needed.
 * Cached for 1 day (content is immutable once published on Base).
 */
export const revalidate = 86400;

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

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new NextResponse("Invalid work id", { status: 400 });
  }
  if (!WR_ADDR) {
    return new NextResponse("WorkRegistry not configured", { status: 503 });
  }

  try {
    const work = await client.readContract({
      address:      WR_ADDR,
      abi:          WorkRegistryAbi,
      functionName: "getWork",
      args:         [BigInt(id)],
    }) as { content: string };

    const raw = work.content ?? "";
    if (!raw.startsWith("data:text/html;base64,")) {
      const preview = raw.slice(0, 60);
      console.warn(`[works/html] work #${id} unexpected format: "${preview}"`);
      return new NextResponse(`Content is not a base64 HTML data URI (got: "${preview}")`, { status: 422 });
    }

    const b64  = raw.slice("data:text/html;base64,".length);
    const html = Buffer.from(b64, "base64").toString("utf-8");

    console.log(`[works/html] served work #${id} (${html.length} chars)`);
    return new NextResponse(html, {
      headers: {
        "Content-Type":           "text/html; charset=utf-8",
        "Cache-Control":          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error(`[works/html] readContract error for #${id}:`, e);
    return new NextResponse("Failed to read work from chain", { status: 502 });
  }
}
