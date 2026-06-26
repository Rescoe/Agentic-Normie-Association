/**
 * GET /api/works/html/by-collection/[address]
 *
 * Renders the actual generative artwork stored in a given ANAEditions collection
 * contract, by address — no workId/onChainId lookup needed. This is what the
 * governance certificate (see workStore.ts buildWorkHtml()) embeds in an <iframe>
 * for its "Artwork" section, so the immutable on-chain certificate document shows
 * the real rendered piece instead of a text placeholder, just like poem works
 * embed their text directly.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { fetchCollectionArtwork, serveGenerativeHtml, notFoundHtml } from "@/lib/artworkServer";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const address = params.address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return new NextResponse("Invalid collection address", { status: 400 });
  }

  const html = await fetchCollectionArtwork(address);
  if (!html) {
    return notFoundHtml(`Artwork not found for collection ${address}.`);
  }

  return serveGenerativeHtml(html, undefined, `collection ${address}`);
}
