/**
 * GET /api/works/html/[id]
 * Returns raw HTML for a published work, served as text/html.
 * Used by the iframe in WorksClient — avoids fragile client-side base64 decode.
 *
 * Priority:
 *  1. Neon: regenerate HTML from stored ANAWork metadata via buildWorkHtml()
 *  2. Contract: readContract getWork() → Buffer.from(b64, "base64").toString("utf-8")
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { WorkRegistryAbi } from "@/lib/abis/WorkRegistry";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks, buildWorkHtml } from "@/lib/workStore";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 25_000 }),
});

const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const onChainId = Number(params.id);
  if (!Number.isInteger(onChainId) || onChainId <= 0) {
    return new NextResponse("Invalid work id", { status: 400 });
  }

  // ── 1. Neon — regenerate HTML from stored work metadata ──────────────────
  try {
    const works = await listWorks();
    const work  = works.find(w => w.onChainWorkId === onChainId && w.state === "PUBLISHED");
    if (work) {
      console.log(`[works/html] Neon hit for #${onChainId} — "${work.title}"`);
      const html = buildWorkHtml(work);
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    console.warn(`[works/html] Neon miss for #${onChainId} — falling back to contract`);
  } catch (e) {
    console.error(`[works/html] Neon error for #${onChainId}:`, e);
  }

  // ── 2. Contract read — server-side Buffer decode (reliable UTF-8) ─────────
  if (!WR_ADDR) return new NextResponse("WorkRegistry not configured", { status: 503 });
  try {
    const data = await client.readContract({
      address:      WR_ADDR,
      abi:          WorkRegistryAbi,
      functionName: "getWork",
      args:         [BigInt(onChainId)],
    }) as { content: string };

    const raw = data.content ?? "";
    const idx = raw.indexOf("data:text/html;base64,");
    if (idx !== -1) {
      const b64  = raw.slice(idx + "data:text/html;base64,".length);
      const html = Buffer.from(b64, "base64").toString("utf-8");
      console.log(`[works/html] contract fallback ok for #${onChainId} — ${html.length} chars`);
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    console.warn(`[works/html] contract returned no data URI for #${onChainId}: "${raw.slice(0, 80)}"`);
  } catch (e) {
    console.error(`[works/html] contract error for #${onChainId}:`, e);
  }

  return new NextResponse("Work not found", { status: 404 });
}
