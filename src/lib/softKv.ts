/**
 * softKv.ts — kv_store access for BEST-EFFORT data (diagnostics, lessons, probe verdicts).
 *
 * Same table as db.ts's kvGet/kvSet (no schema, no migration), with two differences that matter for
 * data nobody's pipeline may depend on:
 *   - without a Neon connection (local dev, vitest) it falls back to an in-memory Map instead of throwing;
 *   - it never throws — a failed read is "no data", a failed write is logged and dropped.
 * Do NOT use it for state a pipeline needs to be correct (work rows, locks, queues): use db.ts for those.
 */
import { USE_NEON, kvGet, kvSet } from "./db";

const memory = new Map<string, string>();

export async function softKvGet(key: string): Promise<string | null> {
  if (!USE_NEON) return memory.get(key) ?? null;
  try {
    return await kvGet(key);
  } catch (e) {
    console.error(`[softKv] read ${key} failed (non-fatal):`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function softKvSet(key: string, value: string): Promise<void> {
  if (!USE_NEON) { memory.set(key, value); return; }
  try {
    await kvSet(key, value);
  } catch (e) {
    console.error(`[softKv] write ${key} failed (non-fatal):`, e instanceof Error ? e.message : e);
  }
}

export async function softKvGetJson<T>(key: string): Promise<T | null> {
  const raw = await softKvGet(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function softKvSetJson(key: string, value: unknown): Promise<void> {
  await softKvSet(key, JSON.stringify(value));
}

/** Test helper — clears the in-memory fallback. */
export function resetSoftKvMemory(): void {
  memory.clear();
}
