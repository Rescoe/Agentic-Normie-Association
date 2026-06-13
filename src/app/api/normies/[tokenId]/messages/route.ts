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
 * MessageWithContext:
 *   { ...message, salonName, before: SalonMessage|null, after: SalonMessage|null }
 */

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listSalons, type SalonMessage } from "@/lib/salonStore";

interface MessageWithContext {
  id:        string;
  salonId:   string;
  salonName: string;
  content:   string;
  timestamp: number;
  isLlm:     boolean;
  before:    SalonMessage | null; // message just before in the salon
  after:     SalonMessage | null; // message just after in the salon
}

export async function GET(
  req: NextRequest,
  { params }: { params: { tokenId: string } }
) {
  const tokenId = parseInt(params.tokenId, 10);
  if (isNaN(tokenId) || tokenId <= 0) {
    return NextResponse.json({ error: "Invalid tokenId" }, { status: 400 });
  }

  // Optional query params
  const limit  = Math.min(Number(req.nextUrl.searchParams.get("limit")  ?? "50"), 200);
  const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");

  const salons = await listSalons();

  const results: MessageWithContext[] = [];

  for (const salon of salons) {
    for (let i = 0; i < salon.messages.length; i++) {
      const msg = salon.messages[i];
      if (msg.tokenId !== tokenId) continue;

      results.push({
        id:        msg.id,
        salonId:   salon.id,
        salonName: salon.name,
        content:   msg.content,
        timestamp: msg.timestamp,
        isLlm:     msg.isLlm,
        before:    i > 0 ? salon.messages[i - 1] : null,
        after:     i < salon.messages.length - 1 ? salon.messages[i + 1] : null,
      });
    }
  }

  // Sort by timestamp descending (most recent first)
  results.sort((a, b) => b.timestamp - a.timestamp);

  const total  = results.length;
  const paged  = results.slice(offset, offset + limit);

  // Resolve name from first found message
  const name = salons
    .flatMap(s => s.messages)
    .find(m => m.tokenId === tokenId)?.name ?? `Normie #${tokenId}`;

  return NextResponse.json({
    tokenId,
    name,
    totalMessages: total,
    limit,
    offset,
    messages: paged,
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*", // public API
    },
  });
}
