/**
 * artworkServer.ts — shared helpers for serving a generative artwork's actual
 * rendered HTML (as opposed to its governance certificate). Used by both
 * /api/works/html/[id] (live preview in the gallery) and
 * /api/works/html/by-collection/[address] (the iframe embedded inside the
 * on-chain certificate's "Artwork" section — see workStore.ts buildWorkHtml()).
 */
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ANAEditionsAbi } from "@/lib/abis/ANAEditions";
import { validateGenerativeHtml, buildGenerativeCsp } from "@/lib/generativeArtwork";

export const artworkChainClient = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 30_000 }),
});

const BASE_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "Cache-Control":   "public, max-age=3600, stale-while-revalidate=86400",
};

export function htmlHeaders(csp: string) {
  return {
    ...BASE_HEADERS,
    "Content-Type":            "text/html; charset=utf-8",
    "Content-Security-Policy": csp,
  };
}

export const STATIC_CSP = "default-src 'none'; style-src 'unsafe-inline';";

// Certificates built before this fix baked in an ABSOLUTE iframe src using
// NEXT_PUBLIC_APP_URL, which was never configured — it fell back to
// "https://agentic-normie-association.vercel.app". Since the certificate is
// served from agentic-normie-association.xyz, that's a cross-origin iframe,
// and X-Frame-Options: SAMEORIGIN correctly blocks it ("Ce contenu est
// bloqué" in the browser) even though the target URL itself works fine when
// opened directly. That certificate HTML is immutable on-chain and can't be
// re-baked, but rewriting the domain away at serve time fixes every existing
// certificate without touching what's actually stored on WorkRegistry.
const STALE_ABSOLUTE_ORIGINS = [
  "https://agentic-normie-association.vercel.app",
  "https://agentic-normie-association.xyz",
];

/** Strips known same-app absolute origins from a certificate's embedded URLs, leaving
 *  relative paths — immune to whatever domain actually serves the page. */
export function relativizeSameOriginUrls(html: string): string {
  let out = html;
  for (const origin of STALE_ABSOLUTE_ORIGINS) {
    out = out.split(origin).join("");
  }
  return out;
}

/** Decode a data URI or raw HTML string → usable HTML or null. */
export function decodeContent(raw: string): string | null {
  if (!raw) return null;

  const b64Prefix = "data:text/html;base64,";
  const b64Idx    = raw.indexOf(b64Prefix);
  if (b64Idx !== -1) {
    try {
      const b64  = raw.slice(b64Idx + b64Prefix.length).trim();
      const html = Buffer.from(b64, "base64").toString("utf-8");
      if (html.length > 10) return html;
    } catch { /* fall through */ }
  }

  const plainPrefix = "data:text/html,";
  if (raw.startsWith(plainPrefix)) {
    try {
      return decodeURIComponent(raw.slice(plainPrefix.length));
    } catch { return raw.slice(plainPrefix.length); }
  }

  const trimmed = raw.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
    return raw;
  }

  return null;
}

// Targets specifically the "Generative / visual artwork — stored on-chain in
// ANAEditions collection 0x..." sentence buildWorkHtml() writes only for the
// html-artwork branch (both the current iframe version and the older address-only
// placeholder). Deliberately narrower than matching any basescan.org/address link in
// the document — every certificate (poems included) also has an unrelated "N ERC-721
// editions · price ETH · <a href=.../address/0x...>" line in its header, which isn't
// what we want here.
const GENERATIVE_COLLECTION_RE = /stored on-chain in ANAEditions collection[\s\S]*?(0x[a-fA-F0-9]{40})/;

export function extractGenerativeCollectionAddress(certificateHtml: string): string | null {
  return certificateHtml.match(GENERATIVE_COLLECTION_RE)?.[1] ?? null;
}

/**
 * Reads the real artwork content directly from its ANAEditions collection contract.
 * Retries on rate-limit errors — mainnet.base.org rejects a meaningful fraction of
 * calls under any real load (see project_ana_activity_feed_bugs memory for a directly
 * measured ~37% rejection rate on a request burst), and a single failed attempt here
 * used to fall straight back to showing the certificate/placeholder text instead of
 * the artwork — the gallery would then intermittently show code/text instead of a
 * live piece depending on RPC luck, not on whether the artwork actually exists.
 */
export async function fetchCollectionArtwork(collectionAddress: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const content = await artworkChainClient.readContract({
        address:      collectionAddress as `0x${string}`,
        abi:          ANAEditionsAbi,
        functionName: "artworkContent",
      }) as string;
      return decodeContent(content) ?? content;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/rate limit/i.test(msg) || attempt === 2) {
        console.error(`[artworkServer] could not read artworkContent() from ${collectionAddress}:`, e);
        return null;
      }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

/** Re-validates (defense in depth) and serves a generative artwork with a strict, hash-based CSP. */
export function serveGenerativeHtml(rawHtml: string, artForm: string | undefined, label: string): NextResponse {
  const check = validateGenerativeHtml(rawHtml, artForm);
  if (!check.valid) {
    console.error(`[artworkServer] ${label} failed re-validation at serve time: ${check.errors.join("; ")}`);
  }
  const csp = buildGenerativeCsp(check.html);
  return new NextResponse(check.html, { headers: htmlHeaders(csp) });
}

export function notFoundHtml(message: string): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html><body style="background:#050505;color:#e2e8f0;font-family:monospace;padding:2rem">
<p>${message}</p>
</body></html>`,
    { status: 404, headers: htmlHeaders(STATIC_CSP) },
  );
}
