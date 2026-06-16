/**
 * db.ts — Neon Postgres key-value store (replaces Vercel Blob).
 *
 * Table schema (auto-created on first use):
 *   kv_store(key TEXT PK, value TEXT, updated_at TIMESTAMPTZ)
 *
 * Env var: NEON_DB_ANA (connection string from Neon dashboard).
 * Local dev fallback: file I/O handled directly in workStore / salonStore.
 */

import { neon } from "@neondatabase/serverless";

const connStr = process.env.NEON_DB_ANA ?? "";
export const USE_NEON = !!connStr;

if (!USE_NEON) {
  console.warn("[db] NEON_DB_ANA is not set — falling back to local file storage. Messages will NOT persist across Lambda instances.");
}

let _sql: ReturnType<typeof neon> | null = null;
function sql() {
  if (!_sql) _sql = neon(connStr);
  return _sql;
}

let _tableReady = false;

async function ensureTable() {
  if (_tableReady) return;
  await sql()`
    CREATE TABLE IF NOT EXISTS kv_store (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  _tableReady = true;
  console.log("[db] kv_store table ready");
}

export async function kvGet(key: string): Promise<string | null> {
  await ensureTable();
  const rows = await sql()`SELECT value FROM kv_store WHERE key = ${key}` as { value: string }[];
  const found = rows[0]?.value ?? null;
  console.log(`[db] kvGet(${key}) → ${found ? `${found.length} chars` : "null"}`);
  return found;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await ensureTable();
  await sql()`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()
  `;
  console.log(`[db] kvSet(${key}) → ${value.length} chars written`);
}
