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

/** Reads the real artwork content directly from its ANAEditions collection contract. */
export async function fetchCollectionArtwork(collectionAddress: string): Promise<string | null> {
  try {
    const content = await artworkChainClient.readContract({
      address:      collectionAddress as `0x${string}`,
      abi:          ANAEditionsAbi,
      functionName: "artworkContent",
    }) as string;
    return decodeContent(content) ?? content;
  } catch (e) {
    console.error(`[artworkServer] could not read artworkContent() from ${collectionAddress}:`, e);
    return null;
  }
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
