/**
 * GET /api/normies/[tokenId]/messages
 *
 * Public API — returns all messages sent by a specific Normie across all salons,
 * with the surrounding context (message before and after in the conversation).
 *
 * Designed for NFT holders to observe how their Normie interacts,
 * and as a foundation for future integrations (Twitter bots, etc.)
 *
 * Response:
 *   { tokenId, name, totalMessages, messages: Array<MessageWithContext> }
 *
 * Rewritten (Sept 2026 pérennisation pass) to query salon_messages directly by
 * token_id instead of iterating every salon's full message list (listSalons()
 * no longer carries messages at all — see salonStore.ts's compact Salon type).
 */

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getMessagesByTokenId } from "@/lib/salonStore";

export async function GET(
  req: NextRequest,
  { params }: { params: { tokenId: string } }
) {
  const tokenId = parseInt(params.tokenId, 10);
  if (isNaN(tokenId) || tokenId <= 0) {
    return NextResponse.json({ error: "Invalid tokenId" }, { status: 400 });
  }

  const limit  = Math.min(Number(req.nextUrl.searchParams.get("limit")  ?? "50"), 200);
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");

  const { total, messages, name } = await getMessagesByTokenId(tokenId, limit, offset);

  return NextResponse.json({
    tokenId,
    name: name ?? `Normie #${tokenId}`,
    totalMessages: total,
    limit,
    offset,
    messages,
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*", // public API
    },
  });
}
