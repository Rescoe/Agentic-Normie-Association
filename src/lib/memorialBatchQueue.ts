/**
 * memorialBatchQueue.ts — accumulates detected burns between batch-memorial
 * flushes. check-burns.ts's 15-min detection tick appends to this queue
 * (resolving each burn's last owner immediately, while the specific burn tx is
 * still easy to look up) instead of creating an ANAWork per burn. The weekly/
 * monthly batch-memorial cron drains it into ONE collective memorial.
 *
 * Small and infrequently written (at most once per 15-min tick when a burn is
 * detected, and once per flush) — no caching layer needed, unlike workStore.ts.
 */
import { kvGet, kvSet } from "@/lib/db";

const NEON_KEY = "memorial-batch-queue";

export interface QueuedBurn {
  tokenId:    number;
  lastOwner:  string; // resolved via getLastOwnerFromBurnTx at detection time
  detectedAt: number;
}

interface QueueStore {
  pending: QueuedBurn[];
}

async function readQueue(): Promise<QueueStore> {
  try {
    const raw = await kvGet(NEON_KEY);
    if (!raw) return { pending: [] };
    const parsed = JSON.parse(raw) as QueueStore;
    if (!Array.isArray(parsed.pending)) return { pending: [] };
    return parsed;
  } catch (e) {
    console.error("[memorialBatchQueue] read failed:", e);
    return { pending: [] };
  }
}

/** Appends newly-detected burns, skipping any tokenId already queued (idempotent). */
export async function enqueueBurns(burns: QueuedBurn[]): Promise<void> {
  if (burns.length === 0) return;
  const store = await readQueue();
  const known = new Set(store.pending.map(b => b.tokenId));
  for (const b of burns) {
    if (!known.has(b.tokenId)) { store.pending.push(b); known.add(b.tokenId); }
  }
  await kvSet(NEON_KEY, JSON.stringify(store));
}

export async function peekQueue(): Promise<QueuedBurn[]> {
  return (await readQueue()).pending;
}

/** Clears the queue — call ONLY after the batch memorial was successfully created. */
export async function clearQueue(): Promise<void> {
  await kvSet(NEON_KEY, JSON.stringify({ pending: [] }));
}
