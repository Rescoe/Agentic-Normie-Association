export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getWork } from "@/lib/workStore";

/**
 * GET /api/works/[id] — read-only work detail, for the draw/peer-review
 * pages to know what state a celebration is in (nothing here is sensitive:
 * proposals, states and member names are already public via the gallery).
 * Omits drawPixels (only needed by the proof-of-draw bridge, large payload).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const work = await getWork(params.id);
  if (!work) return NextResponse.json({ error: "Work not found" }, { status: 404 });

  const { drawPixels: _drawPixels, ...safe } = work;
  return NextResponse.json({ work: safe });
}
