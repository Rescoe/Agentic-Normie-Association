/**
 * publishLock.ts — a short-lived, per-work lock around the on-chain
 * publishing steps (deployCollection/publishWork/initializeCollection).
 *
 * Root cause this exists for (01/10/2026 incident): nothing stopped two
 * overlapping invocations of POST /api/keeper/work-lifecycle (the scheduled
 * orchestrator tick AND an impatient admin re-trigger, or two admin clicks
 * close together) from BOTH reaching stepPublishing() for the SAME work at
 * the same time. Each independently asks the relayer's wallet client for
 * "the next nonce" and submits its own transaction — observed live:
 * "replacement transaction underpriced" (two submissions landed on the same
 * nonce) immediately followed by Alchemy rejecting a later
 * initializeCollection send with a generic "Missing or invalid parameters"
 * once the nonce sequence was no longer what that specific signed
 * transaction expected. This is a real relayer-wallet concurrency bug, not
 * an Alchemy-specific quirk — the fix is to make sure only ONE invocation
 * is ever mid-publish for a given work.
 *
 * Implemented as a single atomic SQL statement (INSERT ... ON CONFLICT ...
 * DO UPDATE ... WHERE stale), not a naive read-then-write — that would
 * reopen the exact same race it's meant to close. A lock older than its TTL
 * is treated as abandoned (e.g. the Lambda that held it was killed by
 * Vercel's platform timeout) and can be reacquired, so a crash can never
 * permanently wedge a work.
 */
import { sql, USE_NEON } from "./db";

const LOCK_TTL_SECONDS = 90;

function lockKey(workId: string): string {
  return `publish-lock:${workId}`;
}

/**
 * Attempts to acquire the publish lock for `workId`. Returns true iff THIS
 * call now holds it (free, or a previous holder's lock has expired).
 * Outside Neon (local dev), there is only ever one process — no concurrency
 * to guard against, so this is a no-op success.
 */
export async function tryAcquirePublishLock(workId: string): Promise<boolean> {
  if (!USE_NEON) return true;
  try {
    const rows = await sql()`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (${lockKey(workId)}, ${String(Date.now())}, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = NOW()
        WHERE kv_store.updated_at < NOW() - make_interval(secs => ${LOCK_TTL_SECONDS})
      RETURNING key
    ` as Array<{ key: string }>;
    return rows.length > 0;
  } catch (e) {
    // A lock-acquisition failure must never itself block publishing — fail
    // open (behave as if unlocked) rather than wedge every work because the
    // lock table had one bad read.
    console.error(`[publishLock] acquire failed for ${workId} (failing open):`, e);
    return true;
  }
}

/** Always call from a `finally` — releasing a lock you don't hold is a safe no-op. */
export async function releasePublishLock(workId: string): Promise<void> {
  if (!USE_NEON) return;
  try {
    await sql()`DELETE FROM kv_store WHERE key = ${lockKey(workId)}`;
  } catch (e) {
    // Worst case the lock sits until its TTL expires on its own — not a
    // correctness problem, just a delay, so this is logged and swallowed
    // rather than thrown (stepPublishing is already returning/throwing its
    // own result by the time this runs).
    console.error(`[publishLock] release failed for ${workId} (will expire via TTL):`, e);
  }
}
