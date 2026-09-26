/**
 * One-shot deploy-time migration runner — `npm run db:migrate`.
 *
 * Deliberately NOT run from application code (see migrations.ts's header
 * comment): the Sept 2026 cost audits flagged runtime DDL (db.ts's
 * ensureTable(), txLog.ts's CREATE TABLE/ALTER TABLE/CREATE INDEX on every
 * cold Lambda instance) as real, measurable Neon overhead. This script is
 * meant to be run by hand (or from a deploy step) against whichever
 * NEON_DB_ANA* connection string is in the environment, once per new
 * migration — never automatically on every deploy of unrelated code.
 *
 * Usage:
 *   NEON_DB_ANA="postgres://..." npx ts-node --transpile-only scripts/db-migrate.ts
 * or, with .env.local already populated:
 *   npm run db:migrate
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { runMigrations } = await import("../src/lib/migrations");
  const { USE_NEON, getNeonHost } = await import("../src/lib/db");

  if (!USE_NEON) {
    console.error("[db-migrate] No Neon connection string found (NEON_DB_ANA / NEON_DB_ANA_POSTGRES_URL / ...). Aborting.");
    process.exit(1);
  }
  console.log(`[db-migrate] Target host: ${getNeonHost()}`);

  const { applied, skipped } = await runMigrations();
  console.log(`[db-migrate] Applied ${applied.length} migration(s): ${applied.join(", ") || "(none)"}`);
  console.log(`[db-migrate] Skipped ${skipped.length} already-applied migration(s): ${skipped.join(", ") || "(none)"}`);
}

main().catch(e => {
  console.error("[db-migrate] FAILED:", e);
  process.exit(1);
});
