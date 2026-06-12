/**
 * GET /api/normies/persona?tokenIds=1,2,3
 *
 * Returns persona data for a list of Normie tokenIds.
 * Aggregates: metadata (name, traits), agent info (archetype, persona text), canvas (level).
 * Used by the LLM pipeline to build the system prompt for inter-Normie discussion.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildPersona } from "@/lib/normiesPersona";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tokenIds") ?? "";
  const ids = raw
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isInteger(n) && n >= 0);

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "tokenIds param required (comma-separated)" },
      { status: 400 }
    );
  }
  if (ids.length > 20) {
    return NextResponse.json({ error: "max 20 tokenIds per request" }, { status: 400 });
  }

  const personas = await Promise.all(ids.map(buildPersona));
  return NextResponse.json({ personas });
}
