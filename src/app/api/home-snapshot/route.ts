/**
 * GET /api/home-snapshot
 *
 * Bundles everything the homepage's "happening now" widget needs (works,
 * the Agora's last few messages, recent burns) into ONE cached response.
 *
 * Before this route existed, HomeLiveActivity.tsx called GET
 * /api/salon/[id] directly for the Agora preview -- that route is
 * force-dynamic with NO cache (deliberately, for the real salon reading
 * page: see its own comment) and getSalon() fires 5 Neon queries per call
 * (ensureAgoraNeon insert, compact select, messages, summaries, plus the
 * route's own getWorkBySalonId). Every homepage visit -- human, crawler,
 * or uptime monitor -- was hitting Neon 5+ times with zero caching, which
 * the Sept 2026 cost audit identified as the main reason Neon's compute
 * never saw 5 minutes of full inactivity (its scale-to-zero threshold).
 * This route only needs the last few messages for a teaser, not the full
 * salon detail, so it calls getMessages() directly and skips the rest.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";
import { getMessages } from "@/lib/salonStore";
import { getBurnedTokens, getBurnedTokenImageUrl } from "@/lib/normiesApi";

const AGORA_SALON_ID = "salon_agora_ana";

// 2 minutes fresh is more than enough for a homepage teaser -- nobody needs
// this down to the second, and it caps Neon/normies.art traffic from this
// widget to once per window regardless of visitor count.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" };

export async function GET() {
  const [works, agoraMessages, burns] = await Promise.allSettled([
    listWorks(),
    getMessages(AGORA_SALON_ID, undefined, 5),
    getBurnedTokens(24, 0),
  ]);

  return NextResponse.json({
    works: works.status === "fulfilled" ? works.value : [],
    agoraMessages: agoraMessages.status === "fulfilled" ? [...agoraMessages.value].reverse() : [],
    recentBurns: burns.status === "fulfilled"
      ? burns.value.map(t => ({
          tokenId: Number(t.tokenId),
          burnedAt: new Date(Number(t.timestamp) * 1000).toISOString(),
          imageUrl: getBurnedTokenImageUrl(t.tokenId),
        }))
      : [],
  }, { headers: CACHE_HEADERS });
}
