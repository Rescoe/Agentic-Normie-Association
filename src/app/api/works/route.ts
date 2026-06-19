export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";

export async function GET() {
  const works = await listWorks();
  return NextResponse.json(works);
}
