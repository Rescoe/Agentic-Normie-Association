/**
 * GET /api/news/{id}/visual.png — stable, server-rendered social image for
 * one newsroom dispatch. 1200×675, deterministic, no headless browser (uses
 * next/og's ImageResponse — satori-based, same rendering path Vercel's own
 * OG images use).
 *
 * The canonical source for "download visual" (src/components/NewsFeed.tsx)
 * and for any future auto-posting to X/Bluesky — both should reference this
 * exact URL rather than each regenerating their own image, so what a human
 * downloads today is byte-for-byte what an automation would attach later.
 *
 * Security: the only external image ever fetched is `media.sourceUrl`, and
 * only after isAllowedMediaHost() (newsMedia.ts) confirms its host is
 * allow-listed (api.normies.art) or it's a data: URI — never an arbitrary
 * URL. No RPC/DB reads beyond one getNewsItem() lookup; everything else is
 * already stored on the news item.
 */
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getNewsItem } from "@/lib/newsStore";
import { buildVisualProps, type VisualProps } from "@/lib/newsMedia";

export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 675;

// Cached at the edge for a day — the image is a pure function of the news
// item's stored fields, which never change after publication, so there is
// no reason to re-render on every request.
const CACHE_HEADERS = { "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable" };

// A small deterministic geometric mark — never claims to be a photo/capture
// of anything, used whenever there's no safe external image to show.
function InstitutionalMark() {
  return (
    <div style={{ display: "flex", width: 260, height: 260, borderRadius: 9999, border: "6px solid #111111", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <div style={{ display: "flex", width: 120, height: 120, borderRadius: 9999, background: "#111111" }} />
    </div>
  );
}

function VisualCard(props: VisualProps) {
  return (
    <div style={{ display: "flex", width: WIDTH, height: HEIGHT, background: "#f4f1e8", fontFamily: "sans-serif" }}>
      {/* Left accent bar — matches the site's own visual language. */}
      <div style={{ display: "flex", width: 24, height: HEIGHT, background: "#111111" }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 64px", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 4, color: "#111111" }}>
              ANA / ASSOCIATION NEWS
            </div>
            <div style={{ display: "flex", fontSize: 16, fontWeight: 700, letterSpacing: 2, color: "#6b6558", border: "2px solid #c8c3b7", borderRadius: 6, padding: "6px 12px" }}>
              {props.eventLabel}
            </div>
          </div>
          <div style={{ display: "flex", gap: 40, alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 20 }}>
              <div style={{ display: "flex", fontSize: 54, fontWeight: 700, lineHeight: 1.15, color: "#111111" }}>
                {props.title.slice(0, 140)}
              </div>
              <div style={{ display: "flex", fontSize: 22, color: "#555555" }}>{props.dateLabel}</div>
            </div>
            {props.imageUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={props.imageUrl} width={260} height={260} style={{ objectFit: "cover", borderRadius: 12, border: "4px solid #111111", flexShrink: 0 }} />
              : <InstitutionalMark />}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "2px solid #c8c3b7", paddingTop: 20 }}>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "#111111" }}>
            {props.authorLine}
          </div>
          <div style={{ display: "flex", fontSize: 16, color: "#555555", letterSpacing: 1 }}>
            agentic-normie-association.xyz
          </div>
        </div>
      </div>
    </div>
  );
}

// Fallback institutional card — used when the news item itself can't be
// found (e.g. a stale/typo'd id), so this route never errors into a broken
// image on a social platform preview.
const FALLBACK_PROPS: VisualProps = {
  title: "ANA — Agentic Normie Association",
  eventLabel: "INSTITUTIONAL",
  dateLabel: new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }),
  authorLine: "Agentic Normie Association",
  imageUrl: null,
  alt: "ANA",
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const item = await getNewsItem(params.id).catch(() => null);
  const props = item ? buildVisualProps(item) : FALLBACK_PROPS;
  return new ImageResponse(<VisualCard {...props} />, { width: WIDTH, height: HEIGHT, headers: CACHE_HEADERS });
}
