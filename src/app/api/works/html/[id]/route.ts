/**
 * GET /api/works/html/[id]
 * Serves the renderable HTML of a published ANA work as text/html for iframe display.
 *
 * Text/poem works: serves the governance certificate (buildWorkHtml()) — the artwork
 * text is embedded directly in it.
 *
 * HTML/generative works (artForm = html-*): the certificate only references the
 * ANAEditions collection — the REAL artwork lives in that contract's artworkContent().
 * This route fetches it from there (falling back to the in-progress Neon artworkText
 * for works not yet published) and serves it with a strict, hash-based CSP — never
 * 'unsafe-inline' / 'unsafe-eval'.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { WorkRegistryAbi } from "@/lib/abis/WorkRegistry";
import { ANAEditionsAbi } from "@/lib/abis/ANAEditions";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks, buildWorkHtml, type ANAWork } from "@/lib/workStore";
import { validateGenerativeHtml, buildGenerativeCsp } from "@/lib/generativeArtwork";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 30_000 }),
});

const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

const BASE_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "Cache-Control":   "public, max-age=3600, stale-while-revalidate=86400",
};

function htmlHeaders(csp: string) {
  return {
    ...BASE_HEADERS,
    "Content-Type":            "text/html; charset=utf-8",
    "Content-Security-Policy": csp,
  };
}

// Permissive fallback only used for the tiny static "not found" page below —
// it never carries any script, so a locked-down CSP doesn't change anything.
const STATIC_CSP = "default-src 'none'; style-src 'unsafe-inline';";

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

function isHtmlWork(work: ANAWork): boolean {
  if (work.artForm?.startsWith("html-")) return true;
  const t = (work.artworkText ?? "").trimStart();
  return t.startsWith("<!DOCTYPE") || t.startsWith("<html") || t.startsWith("<!doctype");
}

/** Renders a generative artwork's actual HTML with a strict, hash-based CSP. */
function serveGenerativeHtml(rawHtml: string, artForm: string | undefined, onChainId: number): NextResponse {
  const check = validateGenerativeHtml(rawHtml, artForm);
  if (!check.valid) {
    console.error(`[works/html] artwork #${onChainId} failed re-validation at serve time: ${check.errors.join("; ")}`);
  }
  const csp = buildGenerativeCsp(check.html);
  return new NextResponse(check.html, { headers: htmlHeaders(csp) });
}

/** Reads the real artwork content from its ANAEditions collection contract. */
async function fetchCollectionArtwork(collectionAddress: string): Promise<string | null> {
  try {
    const content = await client.readContract({
      address:      collectionAddress as `0x${string}`,
      abi:          ANAEditionsAbi,
      functionName: "artworkContent",
    }) as string;
    return decodeContent(content) ?? content;
  } catch (e) {
    console.error(`[works/html] could not read artworkContent() from ${collectionAddress}:`, e);
    return null;
  }
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

  // ── 1. Neon — work metadata available locally ────────────────────────────
  try {
    const works = await listWorks();
    const work  = works.find(
      w => w.onChainWorkId === onChainId && (w.state === "PUBLISHED" || w.txHash)
    );
    if (work) {
      if (isHtmlWork(work)) {
        // The real artwork lives in the ANAEditions collection, not the certificate.
        const fromCollection = work.collectionAddress
          ? await fetchCollectionArtwork(work.collectionAddress)
          : null;
        const html = fromCollection ?? work.artworkText ?? null;
        if (html) {
          console.log(`[works/html] generative artwork hit for #${onChainId} — "${work.title}"`);
          return serveGenerativeHtml(html, work.artForm, onChainId);
        }
        console.warn(`[works/html] #${onChainId} is html-* but no artwork content found — falling back to certificate`);
      }
      console.log(`[works/html] certificate fallback for #${onChainId} — "${work.title}"`);
      const cert = await buildWorkHtml(work);
      return new NextResponse(cert, { headers: htmlHeaders("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';") });
    }
    console.warn(`[works/html] Neon miss for #${onChainId} — falling back to contract`);
  } catch (e) {
    console.error(`[works/html] Neon error for #${onChainId}:`, e);
  }

  // ── 2. Contract read (WorkRegistry) — legacy / not-yet-indexed works ──────
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
      // Legacy content predates the validator — serve with the same hash-based CSP
      // computed from whatever scripts/styles it actually contains.
      return new NextResponse(html, { headers: htmlHeaders(buildGenerativeCsp(html)) });
    }

    console.warn(`[works/html] unrecognised content format for #${onChainId}: "${raw.slice(0, 80)}"`);
    if (raw.length > 0) {
      return new NextResponse(raw, { headers: htmlHeaders(buildGenerativeCsp(raw)) });
    }
  } catch (e) {
    console.error(`[works/html] contract error for #${onChainId}:`, e);
  }

  return new NextResponse(
    `<!DOCTYPE html><html><body style="background:#050505;color:#e2e8f0;font-family:monospace;padding:2rem">
<p>Work #${onChainId} not found or not yet indexed.</p>
</body></html>`,
    { status: 404, headers: htmlHeaders(STATIC_CSP) }
  );
}
