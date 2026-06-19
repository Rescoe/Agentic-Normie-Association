export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";

export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const works = await listWorks({ fresh });
  return NextResponse.json(works);
}
