/**
 * devRequests.ts — structured human/tool-request workflow, replacing the old
 * flat "[DEV-NEEDED]" list (salonStore.ts's DevNeed[] on the salon-store
 * blob) with a real lifecycle:
 *
 *   OBSERVED -> PROPOSED -> DISCUSSING -> SELECTED -> HUMAN_REVIEW
 *     -> IN_PROGRESS -> DELIVERED -> NORMIE_TESTING -> CLOSED
 *   (REJECTED reachable from any non-terminal state, with a reason)
 *
 * A raw "[DEV-NEEDED]" tag in a salon message still creates the initial
 * OBSERVED entry automatically (see flagDevNeedFromMessage(), called from
 * salonStore.addMessage()) — Normies don't need a separate action to start
 * this. Promotion out of OBSERVED happens in two ways:
 *   1. Automatically, at synthesis time (synthesis.ts's structured output
 *      names it in `devNeeds[]`) — treated as evidence the request came up
 *      again meaningfully, so it moves to PROPOSED.
 *   2. Manually, by an admin (skip straight to HUMAN_REVIEW+ for a critical
 *      incident) — see updateDevRequestStatus().
 *
 * Dedup: a new OBSERVED tag is folded into an existing OPEN request (by
 * title-word-overlap) instead of creating a duplicate row, and just adds a
 * support/evidence note.
 */
import { query, USE_NEON } from "./db";
import type { SalonMessage } from "./salonStore";

export type DevRequestType = "bug" | "tool" | "integration" | "data" | "rule";
export type DevRequestStatus =
  | "OBSERVED" | "PROPOSED" | "DISCUSSING" | "SELECTED" | "HUMAN_REVIEW"
  | "IN_PROGRESS" | "DELIVERED" | "NORMIE_TESTING" | "CLOSED" | "REJECTED";

export interface DevRequest {
  id:                 string;
  type:               DevRequestType;
  title:              string;
  problem:            string;
  evidence:           string[];
  proposedSolution:   string | null;
  benefit:            string | null;
  risk:               string | null;
  priority:           "low" | "normal" | "high" | "critical";
  authorTokenId:      number | null;
  authorName:         string | null;
  supports:           number[]; // tokenIds who voiced support (deduped)
  objections:         string[];
  acceptanceCriteria: string[];
  status:             DevRequestStatus;
  humanResponse:      string | null;
  salonId:            string | null;
  createdAt:          number;
  updatedAt:          number;
}

const OPEN_STATUSES: DevRequestStatus[] = ["OBSERVED", "PROPOSED", "DISCUSSING", "SELECTED", "HUMAN_REVIEW", "IN_PROGRESS"];
const MAX_LOCAL = 200;
const localRequests: DevRequest[] = [];

function rowToRequest(r: {
  id: string; type: string; title: string; problem: string; evidence: unknown; proposed_solution: string | null;
  benefit: string | null; risk: string | null; priority: string; author_token_id: number | null; author_name: string | null;
  supports: unknown; objections: unknown; acceptance_criteria: unknown; status: string; human_response: string | null;
  salon_id: string | null; created_at: string | number; updated_at: string | number;
}): DevRequest {
  const arrStr = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
  const arrNum = (v: unknown): number[] => Array.isArray(v) ? v.map(Number) : [];
  return {
    id: r.id, type: r.type as DevRequestType, title: r.title, problem: r.problem,
    evidence: arrStr(r.evidence), proposedSolution: r.proposed_solution, benefit: r.benefit, risk: r.risk,
    priority: r.priority as DevRequest["priority"], authorTokenId: r.author_token_id, authorName: r.author_name,
    supports: arrNum(r.supports), objections: arrStr(r.objections), acceptanceCriteria: arrStr(r.acceptance_criteria),
    status: r.status as DevRequestStatus, humanResponse: r.human_response, salonId: r.salon_id,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

export async function listDevRequests(status?: DevRequestStatus): Promise<DevRequest[]> {
  if (USE_NEON) {
    const rows = status
      ? await query<Parameters<typeof rowToRequest>[0]>("SELECT * FROM dev_requests WHERE status = $1 ORDER BY created_at DESC", [status])
      : await query<Parameters<typeof rowToRequest>[0]>("SELECT * FROM dev_requests ORDER BY created_at DESC");
    return rows.map(rowToRequest);
  }
  return localRequests.filter(r => !status || r.status === status).sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeTitle(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3));
}

function titleOverlap(a: string, b: string): number {
  const setA = normalizeTitle(a), setB = normalizeTitle(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared / Math.max(setA.size, setB.size);
}

async function findSimilarOpenRequest(title: string): Promise<DevRequest | null> {
  const open = await listDevRequests();
  const candidates = open.filter(r => OPEN_STATUSES.includes(r.status));
  let best: { req: DevRequest; score: number } | null = null;
  for (const r of candidates) {
    const score = titleOverlap(title, r.title);
    if (score > 0.5 && (!best || score > best.score)) best = { req: r, score };
  }
  return best?.req ?? null;
}

async function insertRequest(req: DevRequest): Promise<void> {
  if (USE_NEON) {
    await query(
      `INSERT INTO dev_requests (id, type, title, problem, evidence, proposed_solution, benefit, risk, priority, author_token_id, author_name, supports, objections, acceptance_criteria, status, human_response, salon_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [req.id, req.type, req.title, req.problem, JSON.stringify(req.evidence), req.proposedSolution, req.benefit, req.risk,
       req.priority, req.authorTokenId, req.authorName, JSON.stringify(req.supports), JSON.stringify(req.objections),
       JSON.stringify(req.acceptanceCriteria), req.status, req.humanResponse, req.salonId, req.createdAt, req.updatedAt],
    );
  } else {
    localRequests.unshift(req);
    if (localRequests.length > MAX_LOCAL) localRequests.length = MAX_LOCAL;
  }
}

async function patchRequest(id: string, patch: Partial<DevRequest>): Promise<void> {
  const updatedAt = Date.now();
  if (USE_NEON) {
    const sets: string[] = []; const params: unknown[] = [id];
    const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.evidence)     push("evidence", JSON.stringify(patch.evidence));
    if (patch.supports)     push("supports", JSON.stringify(patch.supports));
    if (patch.objections)   push("objections", JSON.stringify(patch.objections));
    if (patch.status)       push("status", patch.status);
    if (patch.humanResponse !== undefined) push("human_response", patch.humanResponse);
    if (patch.proposedSolution !== undefined) push("proposed_solution", patch.proposedSolution);
    if (patch.priority)     push("priority", patch.priority);
    push("updated_at", updatedAt);
    await query(`UPDATE dev_requests SET ${sets.join(", ")} WHERE id = $1`, params);
  } else {
    const r = localRequests.find(x => x.id === id);
    if (r) Object.assign(r, patch, { updatedAt });
  }
}

/** Called from salonStore.addMessage() when a message contains the [DEV-NEEDED] tag. */
export async function flagDevNeedFromMessage(msg: SalonMessage): Promise<void> {
  const content = msg.content.replace("[DEV-NEEDED]", "").trim();
  const title = content.slice(0, 80);

  const existing = await findSimilarOpenRequest(title);
  if (existing) {
    const evidence = [...existing.evidence, content.slice(0, 200)].slice(-10);
    const supports = existing.supports.includes(msg.tokenId) ? existing.supports : [...existing.supports, msg.tokenId];
    await patchRequest(existing.id, { evidence, supports });
    console.log(`[devRequests] folded new observation into existing request ${existing.id}: "${existing.title}"`);
    return;
  }

  const req: DevRequest = {
    id: `dn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: "bug", title, problem: content, evidence: [content.slice(0, 200)],
    proposedSolution: null, benefit: null, risk: null, priority: "normal",
    authorTokenId: msg.tokenId, authorName: msg.name, supports: [msg.tokenId], objections: [],
    acceptanceCriteria: [], status: "OBSERVED", humanResponse: null, salonId: msg.salonId,
    createdAt: msg.timestamp, updatedAt: msg.timestamp,
  };
  await insertRequest(req);
  console.log(`[devRequests] new OBSERVED request from ${msg.name}: ${title}`);
}

/**
 * Called by synthesis.ts when a salon's structured synthesis names a dev-need
 * that came up in the debate — promotes any matching OBSERVED request to
 * PROPOSED (evidence that it's recurring, not a one-off aside), or creates a
 * fresh PROPOSED request if nothing matches yet.
 */
export async function promoteOrCreateFromSynthesis(devNeedText: string, salonId: string): Promise<void> {
  const existing = await findSimilarOpenRequest(devNeedText.slice(0, 80));
  if (existing) {
    if (existing.status === "OBSERVED") await patchRequest(existing.id, { status: "PROPOSED" });
    return;
  }
  const req: DevRequest = {
    id: `dn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: "tool", title: devNeedText.slice(0, 80), problem: devNeedText, evidence: [devNeedText.slice(0, 200)],
    proposedSolution: null, benefit: null, risk: null, priority: "normal",
    authorTokenId: null, authorName: null, supports: [], objections: [],
    acceptanceCriteria: [], status: "PROPOSED", humanResponse: null, salonId,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await insertRequest(req);
}

/** Admin action — moves a request through its lifecycle and records a human response. Skipping straight to a later status (e.g. critical incident) is allowed. */
export async function updateDevRequestStatus(
  id: string, status: DevRequestStatus, humanResponse?: string,
): Promise<{ ok: boolean; error?: string }> {
  const all = await listDevRequests();
  const req = all.find(r => r.id === id);
  if (!req) return { ok: false, error: "Request not found" };
  await patchRequest(id, { status, ...(humanResponse !== undefined ? { humanResponse } : {}) });
  return { ok: true };
}

// Backward-compat shape for the old admin panel, which listed {id, name, content, timestamp, resolved} —
// kept as a thin projection so the existing admin UI keeps rendering something sensible without a rewrite.
export interface LegacyDevNeedView {
  id: string; salonId: string; tokenId: number; name: string; content: string; timestamp: number; resolved: boolean;
}
export function toLegacyView(r: DevRequest): LegacyDevNeedView {
  return {
    id: r.id, salonId: r.salonId ?? "", tokenId: r.authorTokenId ?? 0, name: r.authorName ?? "ANA",
    content: r.problem, timestamp: r.createdAt,
    resolved: r.status === "CLOSED" || r.status === "DELIVERED" || r.status === "REJECTED",
  };
}
