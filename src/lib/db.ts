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

let _sql: ReturnType<typeof neon> | null = null;
function sql() {
  if (!_sql) _sql = neon(connStr);
  return _sql;
}

// Per-lambda cache: table is created at most once per process lifetime.
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
}

export async function kvGet(key: string): Promise<string | null> {
  await ensureTable();
  const rows = await sql()`SELECT value FROM kv_store WHERE key = ${key}` as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await ensureTable();
  await sql()`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()
  `;
}
