/**
 * GET /api/works/html/[id]
 * Serves the raw HTML of a published ANA work as text/html for iframe display.
 *
 * Priority:
 *  1. Neon: regenerate from stored ANAWork metadata via buildWorkHtml()
 *  2. Contract: readContract getWork() → decode data URI or raw HTML
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
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 30_000 }),
});

const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

// Permissive headers so the iframe can render scripts/styles
const HTML_HEADERS = {
  "Content-Type":              "text/html; charset=utf-8",
  "X-Frame-Options":           "SAMEORIGIN",
  "Content-Security-Policy":   "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;",
  "Cache-Control":             "public, max-age=3600, stale-while-revalidate=86400",
};

/** Decode a data URI or raw HTML string → usable HTML or null. */
function decodeContent(raw: string): string | null {
  if (!raw) return null;

  // data:text/html;base64,<b64>
  const b64Prefix = "data:text/html;base64,";
  const b64Idx    = raw.indexOf(b64Prefix);
  if (b64Idx !== -1) {
    try {
      const b64  = raw.slice(b64Idx + b64Prefix.length).trim();
      const html = Buffer.from(b64, "base64").toString("utf-8");
      if (html.length > 10) return html;
    } catch { /* fall through */ }
  }

  // data:text/html,<url-encoded-html>
  const plainPrefix = "data:text/html,";
  if (raw.startsWith(plainPrefix)) {
    try {
      return decodeURIComponent(raw.slice(plainPrefix.length));
    } catch { return raw.slice(plainPrefix.length); }
  }

  // Raw HTML
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
    return raw;
  }

  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const onChainId = Number(params.id);
  // Allow ID 0 — WorkRegistry stores works 0-indexed (first work = ID 0)
  if (!Number.isInteger(onChainId) || onChainId < 0) {
    return new NextResponse("Invalid work id", { status: 400 });
  }

  // ── 1. Neon — regenerate from stored metadata ─────────────────────────────
  try {
    const works = await listWorks();
    const work  = works.find(
      w => w.onChainWorkId === onChainId && (w.state === "PUBLISHED" || w.txHash)
    );
    if (work) {
      console.log(`[works/html] Neon hit for #${onChainId} — "${work.title}"`);
      const html = await buildWorkHtml(work);
      return new NextResponse(html, { headers: HTML_HEADERS });
    }
    console.warn(`[works/html] Neon miss for #${onChainId} — falling back to contract`);
  } catch (e) {
    console.error(`[works/html] Neon error for #${onChainId}:`, e);
  }

  // ── 2. Contract read ───────────────────────────────────────────────────────
  if (!WR_ADDR) {
    return new NextResponse("WorkRegistry not configured", { status: 503 });
  }

  try {
    const data = await client.readContract({
      address:      WR_ADDR,
      abi:          WorkRegistryAbi,
      functionName: "getWork",
      args:         [BigInt(onChainId)],
    }) as { content: string; id: bigint; archived: boolean };

    if (data.archived) {
      return new NextResponse("Work archived", { status: 410 });
    }

    const raw  = data.content ?? "";
    const html = decodeContent(raw);

    if (html) {
      console.log(`[works/html] contract OK for #${onChainId} — ${html.length} chars`);
      return new NextResponse(html, { headers: HTML_HEADERS });
    }

    console.warn(`[works/html] unrecognised content format for #${onChainId}: "${raw.slice(0, 80)}"`);
    // Last resort: serve raw content as HTML
    if (raw.length > 0) {
      return new NextResponse(raw, { headers: HTML_HEADERS });
    }
  } catch (e) {
    console.error(`[works/html] contract error for #${onChainId}:`, e);
  }

  return new NextResponse(
    `<!DOCTYPE html><html><body style="background:#050505;color:#e2e8f0;font-family:monospace;padding:2rem">
<p>Œuvre #${onChainId} introuvable ou non encore indexée.</p>
</body></html>`,
    { status: 404, headers: HTML_HEADERS }
  );
}
