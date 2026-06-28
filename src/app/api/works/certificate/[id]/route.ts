/**
 * GET /api/works/certificate/[id]
 * Serves the governance certificate — proposal, vote, creative brief, credits,
 * process log — for ANY published work, text or generative.
 *
 * For generative (html-*) works, the certificate's "Artwork" section embeds a
 * live <iframe src="/api/works/html/by-collection/[address]"> of the actual
 * rendered piece (see workStore.ts buildWorkHtml()), instead of leaving it as
 * a text placeholder. For text/poem works, the artwork text is embedded
 * directly in the certificate, same as before.
 *
 * This is distinct from /api/works/html/[id], which serves the live artwork
 * preview alone (used by the gallery grid/modal) — the certificate is the full
 * immutable document, the other endpoint is just the rendered piece.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { WorkRegistryAbi } from "@/lib/abis/WorkRegistry";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks, buildWorkHtml } from "@/lib/workStore";
import { artworkChainClient, htmlHeaders, decodeContent, notFoundHtml } from "@/lib/artworkServer";

const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

const CERT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https://api.normies.art; connect-src 'none'; frame-src 'self';";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const onChainId = Number(params.id);
  if (!Number.isInteger(onChainId) || onChainId < 0) {
    return new NextResponse("Invalid work id", { status: 400 });
  }

  // ── 1. Neon — regenerate the certificate from stored metadata ────────────
  try {
    const works = await listWorks();
    const work  = works.find(
      w => w.onChainWorkId === onChainId && (w.state === "PUBLISHED" || w.txHash)
    );
    if (work) {
      console.log(`[works/certificate] Neon hit for #${onChainId} — "${work.title}"`);
      const cert = await buildWorkHtml(work);
      return new NextResponse(cert, { headers: htmlHeaders(CERT_CSP) });
    }
    console.warn(`[works/certificate] Neon miss for #${onChainId} — falling back to contract`);
  } catch (e) {
    console.error(`[works/certificate] Neon error for #${onChainId}:`, e);
  }

  // ── 2. Contract read (WorkRegistry) — legacy / not-yet-indexed works ──────
  // WorkRegistry always stores the certificate itself (never the raw artwork),
  // so this is already the right content for old works with no Neon record.
  if (!WR_ADDR) {
    return new NextResponse("WorkRegistry not configured", { status: 503 });
  }

  try {
    const data = await artworkChainClient.readContract({
      address:      WR_ADDR,
      abi:          WorkRegistryAbi,
      functionName: "getWork",
      args:         [BigInt(onChainId)],
    }) as { content: string; id: bigint; archived: boolean };

    if (data.archived) {
      return new NextResponse("Work archived", { status: 410 });
    }

    const raw  = data.content ?? "";
    const html = decodeContent(raw) ?? raw;
    if (html) {
      console.log(`[works/certificate] contract OK for #${onChainId} — ${html.length} chars`);
      return new NextResponse(html, { headers: htmlHeaders(CERT_CSP) });
    }
  } catch (e) {
    console.error(`[works/certificate] contract error for #${onChainId}:`, e);
  }

  return notFoundHtml(`Certificate #${onChainId} not found or not yet indexed.`);
}
