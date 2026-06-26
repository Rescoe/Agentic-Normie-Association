/**
 * GET /api/works/html/[id]
 * Serves the renderable HTML of a published ANA work as text/html for iframe display —
 * this is the LIVE ARTWORK PREVIEW used by the gallery grid/modal, not the governance
 * certificate (see /api/works/certificate/[id] for that).
 *
 * Text/poem works: there's no separate "artwork" to render, so this falls back to the
 * certificate (which embeds the poem text directly).
 *
 * HTML/generative works (artForm = html-*): reads the REAL artwork from its ANAEditions
 * collection (artworkContent()) and serves it with a strict, hash-based CSP — never
 * 'unsafe-inline' / 'unsafe-eval'.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { WorkRegistryAbi } from "@/lib/abis/WorkRegistry";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks, buildWorkHtml, type ANAWork } from "@/lib/workStore";
import {
  artworkChainClient, htmlHeaders, decodeContent, fetchCollectionArtwork,
  serveGenerativeHtml, notFoundHtml,
} from "@/lib/artworkServer";
import { buildGenerativeCsp } from "@/lib/generativeArtwork";

const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

function isHtmlWork(work: ANAWork): boolean {
  if (work.artForm?.startsWith("html-")) return true;
  const t = (work.artworkText ?? "").trimStart();
  return t.startsWith("<!DOCTYPE") || t.startsWith("<html") || t.startsWith("<!doctype");
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
        const fromCollection = work.collectionAddress
          ? await fetchCollectionArtwork(work.collectionAddress)
          : null;
        const html = fromCollection ?? work.artworkText ?? null;
        if (html) {
          console.log(`[works/html] generative artwork hit for #${onChainId} — "${work.title}"`);
          return serveGenerativeHtml(html, work.artForm, `work #${onChainId}`);
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

  return notFoundHtml(`Work #${onChainId} not found or not yet indexed.`);
}
