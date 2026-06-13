export const dynamic = "force-dynamic";
import fs from "fs";
import path from "path";
import os from "os";
import { NextResponse } from "next/server";
import { getDebugInfo } from "@/lib/salonStore";

const candidates = [
  path.join(process.cwd(), "data", "salon.json"),
  path.join(os.tmpdir(), "ana-salon-test.json"),
  path.join(os.homedir(), "ana-salon-test.json"),
];

export async function GET() {
  // Test writability for each candidate path
  const writeTests: Record<string, string> = {};
  for (const p of candidates) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ ok: true, ts: Date.now() }), "utf-8");
      fs.unlinkSync(p);
      writeTests[p] = "✓ writable";
    } catch (e: unknown) {
      writeTests[p] = `✗ ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const info = getDebugInfo();
  return NextResponse.json({
    ...info,
    writeTests,
    cwd: process.cwd(),
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    nodeVersion: process.version,
  }, { headers: { "Cache-Control": "no-store" } });
}
