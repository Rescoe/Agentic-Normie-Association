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

// Vercel Neon integration creates NEON_DB_ANA_POSTGRES_URL (prefix = integration name).
// Manual override: NEON_DB_ANA (bare, without suffix).
const connStr =
  process.env.NEON_DB_ANA_POSTGRES_URL ??   // Vercel Neon integration (auto-generated)
  process.env.NEON_DB_ANA_DATABASE_URL ??   // alternative Vercel name
  process.env.NEON_DB_ANA ??               // manual / legacy
  "";

export const USE_NEON = !!connStr;

// Safe to expose: the hostname identifies which Neon project/branch is
// actually wired up, with no credentials. Used to diagnose cases where the
// app reads/writes one branch while the dashboard's SQL editor is pointed
// at a different one.
export function getNeonHost(): string | null {
  if (!connStr) return null;
  try {
    return new URL(connStr).hostname;
  } catch {
    return null;
  }
}

if (!USE_NEON) {
  console.warn("[db] No Neon connection string found (NEON_DB_ANA_POSTGRES_URL / NEON_DB_ANA_DATABASE_URL / NEON_DB_ANA) — falling back to local file. Messages will NOT persist across Lambda instances.");
} else {
  const masked = connStr.replace(/:[^:@]+@/, ":***@");
  console.log(`[db] Neon connected via ${masked.slice(0, 40)}…`);
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
