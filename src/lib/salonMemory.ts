/**
 * salonMemory.ts — the structured registries synthesis.ts writes into:
 * decisions, open questions, commitments, and a compact per-Normie memory.
 * Small, targeted reads from here (not full history) are what
 * salon-exchange's context builder injects into a conversation turn — see
 * buildTargetedContext() in salon-exchange/route.ts.
 */
import { query, USE_NEON } from "./db";

export interface Decision { id: string; salonId: string; content: string; status: "active" | "superseded"; origin: string | null; createdAt: number }
export interface OpenQuestion { id: string; salonId: string; content: string; status: "open" | "resolved"; createdAt: number; resolvedAt: number | null }
export interface Commitment { id: string; salonId: string; tokenId: number; content: string; status: "open" | "done"; createdAt: number; dueAt: number | null }

const local = {
  decisions: [] as Decision[],
  questions: [] as OpenQuestion[],
  commitments: [] as Commitment[],
  memory: new Map<number, { compact: Record<string, unknown>; updatedAt: number }>(),
};

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Decisions ────────────────────────────────────────────────────────────

export async function createDecision(salonId: string, content: string, origin: string | null = "synthesis"): Promise<Decision> {
  const d: Decision = { id: genId("dec"), salonId, content: content.slice(0, 400), status: "active", origin, createdAt: Date.now() };
  if (USE_NEON) {
    await query(`INSERT INTO decisions (id, salon_id, content, status, origin, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [d.id, d.salonId, d.content, d.status, d.origin, d.createdAt]);
  } else local.decisions.push(d);
  return d;
}

export async function listDecisions(salonId: string, limit = 5): Promise<Decision[]> {
  if (USE_NEON) {
    const rows = await query<{ id: string; salon_id: string; content: string; status: string; origin: string | null; created_at: string }>(
      `SELECT * FROM decisions WHERE salon_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT $2`, [salonId, limit],
    );
    return rows.map(r => ({ id: r.id, salonId: r.salon_id, content: r.content, status: r.status as "active", origin: r.origin, createdAt: Number(r.created_at) }));
  }
  return local.decisions.filter(d => d.salonId === salonId && d.status === "active").slice(-limit);
}

// ─── Open questions ──────────────────────────────────────────────────────

export async function createOpenQuestion(salonId: string, content: string): Promise<OpenQuestion> {
  const q: OpenQuestion = { id: genId("q"), salonId, content: content.slice(0, 400), status: "open", createdAt: Date.now(), resolvedAt: null };
  if (USE_NEON) {
    await query(`INSERT INTO open_questions (id, salon_id, content, status, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [q.id, q.salonId, q.content, q.status, q.createdAt]);
  } else local.questions.push(q);
  return q;
}

export async function listOpenQuestions(salonId: string, limit = 5): Promise<OpenQuestion[]> {
  if (USE_NEON) {
    const rows = await query<{ id: string; salon_id: string; content: string; status: string; created_at: string; resolved_at: string | null }>(
      `SELECT * FROM open_questions WHERE salon_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT $2`, [salonId, limit],
    );
    return rows.map(r => ({ id: r.id, salonId: r.salon_id, content: r.content, status: r.status as "open", createdAt: Number(r.created_at), resolvedAt: r.resolved_at != null ? Number(r.resolved_at) : null }));
  }
  return local.questions.filter(q => q.salonId === salonId && q.status === "open").slice(-limit);
}

export async function resolveOpenQuestion(id: string): Promise<void> {
  if (USE_NEON) {
    await query(`UPDATE open_questions SET status = 'resolved', resolved_at = $2 WHERE id = $1`, [id, Date.now()]);
  } else {
    const q = local.questions.find(x => x.id === id);
    if (q) { q.status = "resolved"; q.resolvedAt = Date.now(); }
  }
}

// ─── Commitments ─────────────────────────────────────────────────────────

export async function createCommitment(salonId: string, tokenId: number, content: string): Promise<Commitment> {
  const c: Commitment = { id: genId("cm"), salonId, tokenId, content: content.slice(0, 300), status: "open", createdAt: Date.now(), dueAt: null };
  if (USE_NEON) {
    await query(`INSERT INTO commitments (id, salon_id, token_id, content, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.id, c.salonId, c.tokenId, c.content, c.status, c.createdAt]);
  } else local.commitments.push(c);
  return c;
}

export async function listOpenCommitments(salonId: string, limit = 5): Promise<Commitment[]> {
  if (USE_NEON) {
    const rows = await query<{ id: string; salon_id: string; token_id: number; content: string; status: string; created_at: string; due_at: string | null }>(
      `SELECT * FROM commitments WHERE salon_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT $2`, [salonId, limit],
    );
    return rows.map(r => ({ id: r.id, salonId: r.salon_id, tokenId: Number(r.token_id), content: r.content, status: r.status as "open", createdAt: Number(r.created_at), dueAt: r.due_at != null ? Number(r.due_at) : null }));
  }
  return local.commitments.filter(c => c.salonId === salonId && c.status === "open").slice(-limit);
}

// ─── Compact per-Normie memory ───────────────────────────────────────────
//
// Deliberately a small free-form JSON blob (recurring positions, notable
// votes, works authored/critiqued) rather than a wide fixed schema — the
// audit's own recommendation is "fiche compacte", not a full relational
// profile. Updated opportunistically at synthesis time and at publish time
// (creativeFingerprint.ts's caller can also feed this).

export async function getNormieMemory(tokenId: number): Promise<Record<string, unknown>> {
  if (USE_NEON) {
    const rows = await query<{ compact: unknown }>("SELECT compact FROM normie_memory WHERE token_id = $1", [tokenId]);
    return (rows[0]?.compact as Record<string, unknown>) ?? {};
  }
  return local.memory.get(tokenId)?.compact ?? {};
}

/** Shallow-merges `patch` into the Normie's compact memory, capping any array field at 10 entries (most recent). */
export async function mergeNormieMemory(tokenId: number, patch: Record<string, unknown>): Promise<void> {
  const current = await getNormieMemory(tokenId);
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v) && Array.isArray(merged[k])) {
      merged[k] = [...(merged[k] as unknown[]), ...v].slice(-10);
    } else {
      merged[k] = v;
    }
  }
  if (USE_NEON) {
    await query(
      `INSERT INTO normie_memory (token_id, compact, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (token_id) DO UPDATE SET compact = $2, updated_at = $3`,
      [tokenId, JSON.stringify(merged), Date.now()],
    );
  } else {
    local.memory.set(tokenId, { compact: merged, updatedAt: Date.now() });
  }
}

/** Renders a short block for a conversation prompt — a handful of fields, never the raw registries. */
export function formatMemoryForPrompt(compact: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(compact.recurringPositions) && compact.recurringPositions.length > 0) {
    parts.push(`Your recurring positions: ${(compact.recurringPositions as string[]).slice(-3).join("; ")}`);
  }
  if (Array.isArray(compact.worksAuthored) && compact.worksAuthored.length > 0) {
    parts.push(`Works you authored: ${(compact.worksAuthored as string[]).slice(-3).join(", ")}`);
  }
  return parts.length > 0 ? `\nYour own memory: ${parts.join(". ")}.\n` : "";
}
