/**
 * Salon store — shared persistence across all Vercel serverless instances.
 *
 * Storage strategy (auto-detected from env):
 *   NEON_DB_ANA (or its Vercel-integration variants) present → Neon Postgres, RELATIONAL tables
 *   else                                                     → in-memory (dev fallback, single process)
 *
 * Rewritten Sept 2026 (pérennisation pass) from a single "salon-store" kv_store
 * blob holding EVERY salon and EVERY message to real tables (salons,
 * salon_messages, salon_state — see migrations.ts): the old model rewrote the
 * entire blob (all salons, all messages) on every single new message, exactly
 * the write-amplification problem workStore.ts already fixed for works in the
 * same audit. A message insert now touches exactly one row.
 *
 * `Salon` (returned by listSalons()) is intentionally COMPACT — no messages
 * array — so a list of salons never pulls full conversation history just to
 * render a list (the audits flagged `/api/salon` calling the old
 * listSalons() as a real cost risk at scale). `SalonDetail` (returned by
 * getSalon()) adds `messages`/`summaries` for the one-salon case that
 * actually needs them.
 */

import { query, USE_NEON, kvGet, kvSet } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SalonSummary {
  id:           string;
  createdAt:    number;
  period:       { from: number; to: number };
  content:      string;
  messageCount: number;
  // Structured synthesis fields (Sept 2026) — see synthesis.ts. Optional so
  // older summaries (narrative-only) keep parsing fine.
  decisions?:       string[];
  openQuestions?:   string[];
  positions?:       string[];
  commitments?:     string[];
  creativeIdeas?:   string[];
  devNeeds?:        string[];
  topicsClosed?:    string[];
  topicsToResume?:  string[];
}

export interface SalonMessage {
  id:        string;
  salonId:   string;
  tokenId:   number;
  name:      string;
  imageUrl:  string;
  content:   string;
  isLlm:     boolean;
  timestamp: number;
  topic?:    string; // "vote" | "art" | "proposition" | "election" | "libre" | "critique"
  speechAct?: string; // "position"|"objection"|"question"|"evidence"|"proposal"|"compromise"|"synthesis"|"vote-call"|"commitment"
}

/** Compact salon metadata — no full message history. Returned by listSalons(). */
export interface Salon {
  id:            string;
  name:          string;
  description:   string;
  createdBy:     number;
  createdAt:     number;
  members:       number[];
  excluded:      number[];
  isOpen:        boolean;
  currentTopic:  string | null;
  critique?:     { until: number; excluded: number[] };
  messageCount:  number;
  lastMessageAt: number | null;
  // Just the single most recent message (not the full array) — enough for a
  // sidebar list preview without pulling every salon's entire history just
  // to render a list (the exact cost pattern the Sept 2026 audit flagged).
  lastMessage:   { tokenId: number; name: string; content: string; timestamp: number } | null;
}

/** Full salon detail — includes messages/summaries. Returned by getSalon(). */
export interface SalonDetail extends Salon {
  messages:  SalonMessage[];
  summaries: SalonSummary[];
}

interface NameRegistry { [tokenId: string]: string }
interface StimRegistry { [bucketAndIp: string]: number }

const NAMES_KEY = "salon-names";
const STIM_KEY  = "salon-stim-limits";

export const AGORA_SALON_ID       = "salon_agora_ana";
const MAX_MESSAGES_PER_HOUR       = 12;
// Full history cap for getSalon()'s detail view (messages beyond this are
// still in salon_messages and still counted by messageCount/synthesis — this
// only bounds how much a single detail-view read returns).
const DETAIL_VIEW_MESSAGE_CAP     = 200;
// Kept after synthesis as working memory — see synthesis.ts.
export const SYNTHESIS_KEEP_LAST  = 16;
// A salon is eligible for threshold-based synthesis once it has at least this
// many unsynthesized messages — see synthesis.ts's shouldSynthesizeSalon().
export const SYNTHESIS_MSG_THRESHOLD = 50;

// ─── In-memory fallback (dev only, no Neon configured) ─────────────────────

interface LocalStore {
  salons:   Map<string, Omit<SalonDetail, "messageCount" | "lastMessageAt" | "lastMessage">>;
  names:    NameRegistry;
  stim:     StimRegistry;
  salonState: Map<string, { lastSynthesisAt: number | null; synthesisCursor: number; messagesSinceSynthesis: number; activeTopicId: string | null }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __anaSalonStoreV2: LocalStore | undefined;
}

function localStore(): LocalStore {
  if (!global.__anaSalonStoreV2) {
    global.__anaSalonStoreV2 = { salons: new Map(), names: {}, stim: {}, salonState: new Map() };
    ensureAgoraLocal(global.__anaSalonStoreV2);
  }
  return global.__anaSalonStoreV2;
}

function makeAgoraRow(): Omit<SalonDetail, "messageCount" | "lastMessageAt" | "lastMessage"> {
  return {
    id: AGORA_SALON_ID, name: "Agora ANA",
    description: "Salon commun de tous les membres de l'ANA. Discussions libres entre Normies.",
    createdBy: 0, createdAt: Date.now(),
    members: [], excluded: [], isOpen: true, currentTopic: null,
    messages: [], summaries: [],
  };
}

function ensureAgoraLocal(s: LocalStore): void {
  if (!s.salons.has(AGORA_SALON_ID)) s.salons.set(AGORA_SALON_ID, makeAgoraRow());
}

// ─── Salon CRUD ───────────────────────────────────────────────────────────────

function rowToCompactSalon(r: {
  id: string; name: string; description: string; created_by: number; created_at: string | number;
  members: unknown; excluded: unknown; is_open: boolean; current_topic: string | null; critique: unknown;
  message_count: string | number | null; last_message_at: string | number | null;
  last_message_token_id: number | null; last_message_name: string | null; last_message_content: string | null;
}): Salon {
  return {
    id: r.id, name: r.name, description: r.description, createdBy: Number(r.created_by), createdAt: Number(r.created_at),
    members: Array.isArray(r.members) ? r.members as number[] : [],
    excluded: Array.isArray(r.excluded) ? r.excluded as number[] : [],
    isOpen: r.is_open, currentTopic: r.current_topic,
    critique: (r.critique ?? undefined) as Salon["critique"],
    messageCount: Number(r.message_count ?? 0),
    lastMessageAt: r.last_message_at != null ? Number(r.last_message_at) : null,
    lastMessage: r.last_message_content != null ? {
      tokenId: Number(r.last_message_token_id), name: r.last_message_name ?? "", content: r.last_message_content,
      timestamp: Number(r.last_message_at),
    } : null,
  };
}

const COMPACT_SALON_SELECT = `
  SELECT s.*,
    COALESCE(m.cnt, 0) AS message_count,
    lm."timestamp" AS last_message_at,
    lm.token_id AS last_message_token_id,
    lm.name AS last_message_name,
    lm.content AS last_message_content
  FROM salons s
  LEFT JOIN (SELECT salon_id, COUNT(*) AS cnt FROM salon_messages GROUP BY salon_id) m ON m.salon_id = s.id
  LEFT JOIN LATERAL (
    SELECT token_id, name, content, "timestamp" FROM salon_messages sm2
    WHERE sm2.salon_id = s.id ORDER BY sm2."timestamp" DESC LIMIT 1
  ) lm ON TRUE
`;

function localRowToCompact(row: Omit<SalonDetail, "messageCount" | "lastMessageAt" | "lastMessage">): Salon {
  const last = row.messages.at(-1);
  return {
    ...row, messageCount: row.messages.length, lastMessageAt: last?.timestamp ?? null,
    lastMessage: last ? { tokenId: last.tokenId, name: last.name, content: last.content, timestamp: last.timestamp } : null,
  };
}

export async function listSalons(): Promise<Salon[]> {
  if (USE_NEON) {
    await ensureAgoraNeon();
    const rows = await query<Parameters<typeof rowToCompactSalon>[0]>(`${COMPACT_SALON_SELECT} ORDER BY s.created_at DESC`);
    return rows.map(rowToCompactSalon);
  }
  const s = localStore();
  return [...s.salons.values()].sort((a, b) => b.createdAt - a.createdAt).map(localRowToCompact);
}

async function ensureAgoraNeon(): Promise<void> {
  await query(
    `INSERT INTO salons (id, name, description, created_by, created_at, members, excluded, is_open, current_topic)
     VALUES ($1,$2,$3,0,$4,'[]','[]',TRUE,NULL)
     ON CONFLICT (id) DO NOTHING`,
    [AGORA_SALON_ID, "Agora ANA", "Salon commun de tous les membres de l'ANA. Discussions libres entre Normies.", Date.now()],
  );
}

export async function getSalon(id: string): Promise<SalonDetail | null> {
  if (USE_NEON) {
    if (id === AGORA_SALON_ID) await ensureAgoraNeon();
    const rows = await query<Parameters<typeof rowToCompactSalon>[0]>(`${COMPACT_SALON_SELECT} WHERE s.id = $1`, [id]);
    if (rows.length === 0) return null;
    const compact = rowToCompactSalon(rows[0]);
    const messages = await getMessages(id, undefined, DETAIL_VIEW_MESSAGE_CAP);
    const summaries = await listSummaries(id);
    return { ...compact, messages, summaries };
  }
  const s = localStore();
  const row = s.salons.get(id);
  if (!row) return null;
  return { ...localRowToCompact(row), messages: row.messages, summaries: row.summaries };
}

export async function getActiveSalonByCreator(tokenId: number): Promise<Salon | null> {
  const all = await listSalons();
  return all.find(s => s.createdBy === tokenId && s.isOpen) ?? null;
}

export async function getMemberStats(tokenId: number): Promise<{
  totalMessages: number; salonsCount: number; lastActive: number | null;
}> {
  if (USE_NEON) {
    const rows = await query<{ salon_id: string; cnt: string; last_ts: string }>(
      `SELECT salon_id, COUNT(*) AS cnt, MAX("timestamp") AS last_ts FROM salon_messages WHERE token_id = $1 GROUP BY salon_id`,
      [tokenId],
    );
    const totalMessages = rows.reduce((sum, r) => sum + Number(r.cnt), 0);
    const lastActive = rows.length > 0 ? Math.max(...rows.map(r => Number(r.last_ts))) : null;
    return { totalMessages, salonsCount: rows.length, lastActive };
  }
  const s = localStore();
  let totalMessages = 0, salonsCount = 0, lastActive: number | null = null;
  for (const salon of s.salons.values()) {
    const msgs = salon.messages.filter(m => m.tokenId === tokenId);
    if (msgs.length > 0) {
      totalMessages += msgs.length; salonsCount++;
      const last = Math.max(...msgs.map(m => m.timestamp));
      if (!lastActive || last > lastActive) lastActive = last;
    }
  }
  return { totalMessages, salonsCount, lastActive };
}

export async function createSalon(params: {
  name: string; description: string; createdBy: number; members?: number[];
}): Promise<Salon> {
  const id = `salon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const salon: Salon = {
    id, name: params.name.slice(0, 60), description: params.description.slice(0, 200),
    createdBy: params.createdBy, createdAt: Date.now(),
    members: params.members ?? [], excluded: [], isOpen: true, currentTopic: null,
    messageCount: 0, lastMessageAt: null, lastMessage: null,
  };
  if (USE_NEON) {
    await query(
      `INSERT INTO salons (id, name, description, created_by, created_at, members, excluded, is_open, current_topic)
       VALUES ($1,$2,$3,$4,$5,$6,'[]',TRUE,NULL)`,
      [salon.id, salon.name, salon.description, salon.createdBy, salon.createdAt, JSON.stringify(salon.members)],
    );
  } else {
    localStore().salons.set(id, { ...salon, messages: [], summaries: [] });
  }
  return salon;
}

export async function closeSalon(id: string, byTokenId: number): Promise<{ ok: boolean; error?: string }> {
  const salon = await getSalon(id);
  if (!salon) return { ok: false, error: "Salon not found" };
  if (byTokenId !== 0 && salon.createdBy !== 0 && salon.createdBy !== byTokenId) {
    return { ok: false, error: "Only creator can close salon" };
  }
  if (USE_NEON) {
    await query(`UPDATE salons SET is_open = FALSE WHERE id = $1`, [id]);
  } else {
    const row = localStore().salons.get(id);
    if (row) row.isOpen = false;
  }
  return { ok: true };
}

export async function reopenSalon(id: string): Promise<{ ok: boolean; error?: string }> {
  const salon = await getSalon(id);
  if (!salon) return { ok: false, error: "Salon not found" };
  if (USE_NEON) {
    await query(`UPDATE salons SET is_open = TRUE, critique = NULL WHERE id = $1`, [id]);
  } else {
    const row = localStore().salons.get(id);
    if (row) { row.isOpen = true; delete row.critique; }
  }
  return { ok: true };
}

export async function excludeMember(
  salonId: string, targetId: number, byTokenId: number
): Promise<{ ok: boolean; error?: string }> {
  const salon = await getSalon(salonId);
  if (!salon) return { ok: false, error: "Salon not found" };
  if (salon.createdBy !== byTokenId) return { ok: false, error: "Only creator can exclude members" };
  const newExcluded = salon.excluded.includes(targetId) ? salon.excluded : [...salon.excluded, targetId];
  const newMembers  = salon.members.filter(m => m !== targetId);
  if (USE_NEON) {
    await query(`UPDATE salons SET excluded = $2, members = $3 WHERE id = $1`, [salonId, JSON.stringify(newExcluded), JSON.stringify(newMembers)]);
  } else {
    const row = localStore().salons.get(salonId);
    if (row) { row.excluded = newExcluded; row.members = newMembers; }
  }
  return { ok: true };
}

export async function setTopic(salonId: string, topic: string | null): Promise<void> {
  if (USE_NEON) {
    await query(`UPDATE salons SET current_topic = $2 WHERE id = $1`, [salonId, topic]);
  } else {
    const row = localStore().salons.get(salonId);
    if (row) row.currentTopic = topic;
  }
}

export async function openCritiqueWindow(salonId: string, excluded: number[], windowMs: number): Promise<void> {
  const critique = { until: Date.now() + windowMs, excluded };
  if (USE_NEON) {
    await query(`UPDATE salons SET critique = $2 WHERE id = $1`, [salonId, JSON.stringify(critique)]);
  } else {
    const row = localStore().salons.get(salonId);
    if (row) row.critique = critique;
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function rowToMessage(r: {
  id: string; salon_id: string; token_id: number; name: string; image_url: string; content: string;
  is_llm: boolean; topic: string | null; speech_act: string | null; timestamp: string | number;
}): SalonMessage {
  return {
    id: r.id, salonId: r.salon_id, tokenId: Number(r.token_id), name: r.name, imageUrl: r.image_url,
    content: r.content, isLlm: r.is_llm, timestamp: Number(r.timestamp),
    topic: r.topic ?? undefined, speechAct: r.speech_act ?? undefined,
  };
}

export async function getMessages(salonId: string, since?: number, limit?: number): Promise<SalonMessage[]> {
  if (USE_NEON) {
    const rows = since != null
      ? await query<Parameters<typeof rowToMessage>[0]>(
          `SELECT * FROM salon_messages WHERE salon_id = $1 AND "timestamp" > $2 ORDER BY "timestamp" ASC`,
          [salonId, since],
        )
      : await query<Parameters<typeof rowToMessage>[0]>(
          limit != null
            ? `SELECT * FROM (SELECT * FROM salon_messages WHERE salon_id = $1 ORDER BY "timestamp" DESC LIMIT $2) t ORDER BY "timestamp" ASC`
            : `SELECT * FROM salon_messages WHERE salon_id = $1 ORDER BY "timestamp" ASC`,
          limit != null ? [salonId, limit] : [salonId],
        );
    return rows.map(rowToMessage);
  }
  const row = localStore().salons.get(salonId);
  if (!row) return [];
  let msgs = row.messages;
  if (since != null) msgs = msgs.filter(m => m.timestamp > since);
  if (limit != null) msgs = msgs.slice(-limit);
  return msgs;
}

/** Every message a given Normie sent, across every salon, most recent first — used by the public per-Normie history API. Queries directly instead of iterating listSalons(), since that no longer carries message arrays. */
export async function getMessagesByTokenId(tokenId: number, limit: number, offset: number): Promise<{
  total: number;
  messages: Array<SalonMessage & { salonName: string; before: SalonMessage | null; after: SalonMessage | null }>;
  name: string | null;
}> {
  if (USE_NEON) {
    const countRows = await query<{ count: string }>(`SELECT COUNT(*) FROM salon_messages WHERE token_id = $1`, [tokenId]);
    const total = Number(countRows[0]?.count ?? 0);
    const page = await query<Parameters<typeof rowToMessage>[0] & { name_join: string }>(
      `SELECT sm.*, s.name AS name_join FROM salon_messages sm JOIN salons s ON s.id = sm.salon_id
       WHERE sm.token_id = $1 ORDER BY sm."timestamp" DESC LIMIT $2 OFFSET $3`,
      [tokenId, limit, offset],
    );
    const salonIds = [...new Set(page.map(r => r.salon_id))];
    const contextBySalon = new Map<string, SalonMessage[]>();
    for (const sid of salonIds) contextBySalon.set(sid, await getMessages(sid));
    const messages = page.map(r => {
      const msg = rowToMessage(r);
      const salonMsgs = contextBySalon.get(r.salon_id) ?? [];
      const idx = salonMsgs.findIndex(m => m.id === msg.id);
      return {
        ...msg, salonName: r.name_join,
        before: idx > 0 ? salonMsgs[idx - 1] : null,
        after: idx >= 0 && idx < salonMsgs.length - 1 ? salonMsgs[idx + 1] : null,
      };
    });
    const name = messages[0]?.name ?? (await getName(tokenId));
    return { total, messages, name };
  }
  const s = localStore();
  const all: Array<SalonMessage & { salonName: string }> = [];
  for (const salon of s.salons.values()) {
    for (const m of salon.messages) if (m.tokenId === tokenId) all.push({ ...m, salonName: salon.name });
  }
  all.sort((a, b) => b.timestamp - a.timestamp);
  const total = all.length;
  const page = all.slice(offset, offset + limit).map(msg => {
    const salon = s.salons.get(msg.salonId)!;
    const idx = salon.messages.findIndex(m => m.id === msg.id);
    return {
      ...msg,
      before: idx > 0 ? salon.messages[idx - 1] : null,
      after: idx < salon.messages.length - 1 ? salon.messages[idx + 1] : null,
    };
  });
  return { total, messages: page, name: page[0]?.name ?? null };
}

export async function checkRateLimit(
  salonId: string, tokenId: number
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const oneHourAgo = Date.now() - 3_600_000;
  if (USE_NEON) {
    const rows = await query<{ timestamp: string }>(
      `SELECT "timestamp" FROM salon_messages WHERE salon_id = $1 AND token_id = $2 AND "timestamp" > $3 AND is_llm = TRUE ORDER BY "timestamp" ASC`,
      [salonId, tokenId, oneHourAgo],
    );
    if (rows.length < MAX_MESSAGES_PER_HOUR) return { allowed: true };
    return { allowed: false, retryAfterMs: Math.max(0, Number(rows[0].timestamp) + 3_600_000 - Date.now()) };
  }
  const row = localStore().salons.get(salonId);
  if (!row) return { allowed: true };
  const recent = row.messages.filter(m => m.tokenId === tokenId && m.timestamp > oneHourAgo && m.isLlm);
  if (recent.length < MAX_MESSAGES_PER_HOUR) return { allowed: true };
  const oldest = recent.sort((a, b) => a.timestamp - b.timestamp)[0];
  return { allowed: false, retryAfterMs: Math.max(0, oldest.timestamp + 3_600_000 - Date.now()) };
}

export async function addMessage(msg: Omit<SalonMessage, "id"> & { topic?: string; speechAct?: string }): Promise<SalonMessage> {
  const registeredName = await getName(msg.tokenId);
  const resolvedName   = registeredName ?? (
    msg.name && msg.name !== `Normie #${msg.tokenId}` ? msg.name : `Normie #${msg.tokenId}`
  );
  const id   = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const full: SalonMessage = { id, ...msg, name: resolvedName };

  const salon = await getSalon(msg.salonId);
  if (!salon) {
    if (msg.salonId === AGORA_SALON_ID) {
      // Agora is lazily created by ensureAgoraNeon()/ensureAgoraLocal() — retry once.
      await getSalon(AGORA_SALON_ID);
    } else {
      console.warn(`[salonStore] addMessage skipped — salon ${msg.salonId} not found`);
      return full;
    }
  } else if (!salon.isOpen) {
    const critique     = salon.critique;
    const critiqueOpen = msg.topic === "critique" && !!critique
      && Date.now() < critique.until && !critique.excluded.includes(msg.tokenId);
    if (!critiqueOpen) {
      console.warn(`[salonStore] addMessage skipped — salon "${salon.name}" (${msg.salonId}) is closed`);
      return full;
    }
  }

  if (USE_NEON) {
    await query(
      `INSERT INTO salon_messages (id, salon_id, token_id, name, image_url, content, is_llm, topic, speech_act, "timestamp", synthesized)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)`,
      [full.id, full.salonId, full.tokenId, full.name, full.imageUrl, full.content, full.isLlm, full.topic ?? null, full.speechAct ?? null, full.timestamp],
    );
    await query(
      `INSERT INTO salon_state (salon_id, synthesis_cursor, messages_since_synthesis)
       VALUES ($1, 0, 1)
       ON CONFLICT (salon_id) DO UPDATE SET messages_since_synthesis = salon_state.messages_since_synthesis + 1`,
      [full.salonId],
    );
  } else {
    const row = localStore().salons.get(full.salonId) ?? (full.salonId === AGORA_SALON_ID ? makeAgoraRow() : null);
    if (row) {
      row.messages.push(full);
      localStore().salons.set(full.salonId, row);
    }
  }

  if (full.content.includes(DEV_NEED_TAG)) {
    const { flagDevNeedFromMessage } = await import("./devRequests");
    await flagDevNeedFromMessage(full).catch(e => console.error("[salonStore] flagDevNeed failed:", e));
  }

  return full;
}

const DEV_NEED_TAG = "[DEV-NEEDED]";

// ─── Summaries / synthesis state ────────────────────────────────────────────

function rowToSummary(r: {
  id: string; created_at: string | number; period_from: string | number; period_to: string | number;
  message_count: number; narrative: string; decisions: unknown; open_questions: unknown; positions: unknown;
  commitments: unknown; creative_ideas: unknown; dev_needs: unknown; topics_closed: unknown; topics_to_resume: unknown;
}): SalonSummary {
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
  return {
    id: r.id, createdAt: Number(r.created_at),
    period: { from: Number(r.period_from), to: Number(r.period_to) },
    content: r.narrative, messageCount: r.message_count,
    decisions: arr(r.decisions), openQuestions: arr(r.open_questions), positions: arr(r.positions),
    commitments: arr(r.commitments), creativeIdeas: arr(r.creative_ideas), devNeeds: arr(r.dev_needs),
    topicsClosed: arr(r.topics_closed), topicsToResume: arr(r.topics_to_resume),
  };
}

export async function listSummaries(salonId: string): Promise<SalonSummary[]> {
  if (USE_NEON) {
    const rows = await query<Parameters<typeof rowToSummary>[0]>(
      `SELECT * FROM salon_summaries WHERE salon_id = $1 ORDER BY created_at DESC LIMIT 12`, [salonId],
    );
    return rows.map(rowToSummary).reverse();
  }
  return localStore().salons.get(salonId)?.summaries ?? [];
}

export interface SalonStateInfo {
  lastSynthesisAt: number | null;
  synthesisCursor: number;
  messagesSinceSynthesis: number;
  activeTopicId: string | null;
}

export async function getSalonState(salonId: string): Promise<SalonStateInfo> {
  if (USE_NEON) {
    const rows = await query<{ last_synthesis_at: string | null; synthesis_cursor: string; messages_since_synthesis: number; active_topic_id: string | null }>(
      `SELECT * FROM salon_state WHERE salon_id = $1`, [salonId],
    );
    if (rows.length === 0) return { lastSynthesisAt: null, synthesisCursor: 0, messagesSinceSynthesis: 0, activeTopicId: null };
    const r = rows[0];
    return {
      lastSynthesisAt: r.last_synthesis_at != null ? Number(r.last_synthesis_at) : null,
      synthesisCursor: Number(r.synthesis_cursor), messagesSinceSynthesis: r.messages_since_synthesis,
      activeTopicId: r.active_topic_id,
    };
  }
  const st = localStore().salonState.get(salonId);
  return st ?? { lastSynthesisAt: null, synthesisCursor: 0, messagesSinceSynthesis: 0, activeTopicId: null };
}

/**
 * Persists one synthesis result: stores the structured summary row, advances
 * the synthesis cursor to `periodTo`, resets messagesSinceSynthesis, and
 * marks every summarized message as synthesized=true (so DETAIL_VIEW_MESSAGE_CAP
 * and future queries can distinguish working memory from archived history).
 * ATOMICITY NOTE: these are separate statements, not a single transaction —
 * acceptable here because the caller (synthesis.ts) only calls this AFTER a
 * successful LLM call, and a partial failure here just means the next tick
 * re-synthesizes a slightly overlapping window (idempotent-ish, never data
 * loss) rather than silently advancing the cursor without having saved
 * anything (that failure mode — the one the audit explicitly flagged — is
 * what synthesis.ts's ordering guards against: cursor only advances here,
 * inside this function, never separately).
 */
export async function storeSynthesis(
  salonId: string,
  content: string,
  periodFrom: number,
  periodTo: number,
  messageCount: number,
  structured?: {
    decisions?: string[]; openQuestions?: string[]; positions?: string[]; commitments?: string[];
    creativeIdeas?: string[]; devNeeds?: string[]; topicsClosed?: string[]; topicsToResume?: string[];
  },
): Promise<void> {
  const summary: SalonSummary = {
    id: `summary_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    createdAt: Date.now(), period: { from: periodFrom, to: periodTo }, content, messageCount,
    ...structured,
  };
  if (USE_NEON) {
    await query(
      `INSERT INTO salon_summaries (id, salon_id, created_at, period_from, period_to, message_count, narrative, decisions, open_questions, positions, commitments, creative_ideas, dev_needs, topics_closed, topics_to_resume)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [summary.id, salonId, summary.createdAt, periodFrom, periodTo, messageCount, content,
       JSON.stringify(structured?.decisions ?? []), JSON.stringify(structured?.openQuestions ?? []),
       JSON.stringify(structured?.positions ?? []), JSON.stringify(structured?.commitments ?? []),
       JSON.stringify(structured?.creativeIdeas ?? []), JSON.stringify(structured?.devNeeds ?? []),
       JSON.stringify(structured?.topicsClosed ?? []), JSON.stringify(structured?.topicsToResume ?? [])],
    );
    await query(`UPDATE salon_messages SET synthesized = TRUE WHERE salon_id = $1 AND "timestamp" <= $2`, [salonId, periodTo]);
    await query(
      `INSERT INTO salon_state (salon_id, last_synthesis_at, synthesis_cursor, messages_since_synthesis)
       VALUES ($1, $2, $2, 0)
       ON CONFLICT (salon_id) DO UPDATE SET last_synthesis_at = $2, synthesis_cursor = $2, messages_since_synthesis = 0`,
      [salonId, periodTo],
    );
  } else {
    const row = localStore().salons.get(salonId);
    if (row) {
      row.summaries.push(summary);
      if (row.summaries.length > 12) row.summaries = row.summaries.slice(-12);
    }
    localStore().salonState.set(salonId, { lastSynthesisAt: periodTo, synthesisCursor: periodTo, messagesSinceSynthesis: 0, activeTopicId: (await getSalonState(salonId)).activeTopicId });
  }
}

export async function setActiveTopicId(salonId: string, topicId: string | null): Promise<void> {
  if (USE_NEON) {
    await query(
      `INSERT INTO salon_state (salon_id, active_topic_id) VALUES ($1, $2)
       ON CONFLICT (salon_id) DO UPDATE SET active_topic_id = $2`,
      [salonId, topicId],
    );
  } else {
    const st = await getSalonState(salonId);
    localStore().salonState.set(salonId, { ...st, activeTopicId: topicId });
  }
}

/** Every salon whose unsynthesized message count has reached the threshold — see synthesis.ts. */
export async function listSalonsDueForThresholdSynthesis(threshold: number = SYNTHESIS_MSG_THRESHOLD): Promise<string[]> {
  if (USE_NEON) {
    const rows = await query<{ salon_id: string }>(
      `SELECT salon_id FROM salon_state WHERE messages_since_synthesis >= $1`, [threshold],
    );
    return rows.map(r => r.salon_id);
  }
  const s = localStore();
  return [...s.salonState.entries()].filter(([, st]) => st.messagesSinceSynthesis >= threshold).map(([id]) => id);
}

// ─── Per-IP rate limiting (kv_store — small, low-churn, genuinely blob-shaped) ─

const STIM_WINDOW_MS = 10 * 60 * 1000;

async function loadStim(): Promise<StimRegistry> {
  if (USE_NEON) {
    const raw = await kvGet(STIM_KEY);
    return raw ? JSON.parse(raw) as StimRegistry : {};
  }
  return localStore().stim;
}

async function saveStim(reg: StimRegistry): Promise<void> {
  if (USE_NEON) await kvSet(STIM_KEY, JSON.stringify(reg));
  else localStore().stim = reg;
}

async function checkIpRateLimit(bucket: string, ip: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  if (!ip || ip === "unknown") return { allowed: true };
  const reg = await loadStim();
  const lastAt = reg[`${bucket}:${ip}`];
  if (!lastAt) return { allowed: true };
  const elapsed = Date.now() - lastAt;
  if (elapsed >= STIM_WINDOW_MS) return { allowed: true };
  return { allowed: false, retryAfterMs: STIM_WINDOW_MS - elapsed };
}

async function recordIpRateLimit(bucket: string, ip: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  const reg = await loadStim();
  reg[`${bucket}:${ip}`] = Date.now();
  const cutoff = Date.now() - 2 * STIM_WINDOW_MS;
  for (const [k, v] of Object.entries(reg)) if (v < cutoff) delete reg[k];
  await saveStim(reg);
}

export async function checkSalonMessageLimit(ip: string) { return checkIpRateLimit("salonmsg", ip); }
export async function recordSalonMessage(ip: string) { return recordIpRateLimit("salonmsg", ip); }
export async function checkMemorialRequestLimit(ip: string) { return checkIpRateLimit("memorial", ip); }
export async function recordMemorialRequest(ip: string) { return recordIpRateLimit("memorial", ip); }

// ─── Name registry (kv_store — small, low-churn) ────────────────────────────

async function loadNames(): Promise<NameRegistry> {
  if (USE_NEON) {
    const raw = await kvGet(NAMES_KEY);
    return raw ? JSON.parse(raw) as NameRegistry : {};
  }
  return localStore().names;
}

async function saveNames(reg: NameRegistry): Promise<void> {
  if (USE_NEON) await kvSet(NAMES_KEY, JSON.stringify(reg));
  else localStore().names = reg;
}

export async function registerName(tokenId: number, name: string): Promise<void> {
  if (!name || name === `Normie #${tokenId}`) return;
  const reg = await loadNames();
  reg[String(tokenId)] = name;
  await saveNames(reg);
}

export async function registerNames(entries: Array<{ tokenId: number; name: string }>): Promise<void> {
  const toWrite = entries.filter(e => e.name && e.name !== `Normie #${e.tokenId}`);
  if (toWrite.length === 0) return;
  const reg = await loadNames();
  for (const { tokenId, name } of toWrite) reg[String(tokenId)] = name;
  await saveNames(reg);
}

export async function getName(tokenId: number): Promise<string | null> {
  const reg = await loadNames();
  const n = reg[String(tokenId)];
  return n && n !== `Normie #${tokenId}` ? n : null;
}

/** No-op kept for call-site compatibility (see reset-database/route.ts) — the
 * relational store has no in-process cache to invalidate; every read goes
 * straight to Neon (or the local Map in dev), so there's nothing stale to drop. */
export function invalidateCache(): void { /* intentionally empty */ }

// ─── Debug ────────────────────────────────────────────────────────────────────

export async function getDebugInfo() {
  const agora = await getSalon(AGORA_SALON_ID);
  const salons = await listSalons();
  const names  = await loadNames();
  const agoraState = await getSalonState(AGORA_SALON_ID);
  return {
    mode:              USE_NEON ? "neon-postgres-relational" : "local-memory",
    salonCount:        salons.length,
    nameCount:         Object.keys(names).length,
    agoraMsgCount:     agora?.messages.length ?? 0,
    agoraSummaryCount: agora?.summaries.length ?? 0,
    lastSynthesisAt:   agoraState.lastSynthesisAt,
    messagesSinceSynthesis: agoraState.messagesSinceSynthesis,
    lastAgoraMsg:      agora?.messages.at(-1) ?? null,
  };
}

// ─── Reset ────────────────────────────────────────────────────────────────────

/** Wipes all Agora messages/syntheses/topic/stim so Normies and users start fresh. Non-Agora salons untouched. */
export async function resetAgora(): Promise<void> {
  if (USE_NEON) {
    await query(`DELETE FROM salon_messages WHERE salon_id = $1`, [AGORA_SALON_ID]);
    await query(`DELETE FROM salon_summaries WHERE salon_id = $1`, [AGORA_SALON_ID]);
    await query(`DELETE FROM salon_state WHERE salon_id = $1`, [AGORA_SALON_ID]);
    await query(`UPDATE salons SET current_topic = NULL WHERE id = $1`, [AGORA_SALON_ID]);
    await kvSet(STIM_KEY, "{}");
  } else {
    localStore().salons.set(AGORA_SALON_ID, makeAgoraRow());
    localStore().salonState.delete(AGORA_SALON_ID);
    localStore().stim = {};
  }
  console.log("[salonStore] Agora reset — messages, syntheses, and stim limits cleared");
}

/** Wipes EVERY salon (Agora + every dynamically-created one). See old comment history for why non-Agora salons are dropped, not archived. */
export async function resetAllSalons(): Promise<void> {
  if (USE_NEON) {
    await query(`DELETE FROM salon_messages`);
    await query(`DELETE FROM salon_summaries`);
    await query(`DELETE FROM salon_state`);
    await query(`DELETE FROM salons WHERE id != $1`, [AGORA_SALON_ID]);
    await query(`UPDATE salons SET current_topic = NULL, is_open = TRUE, critique = NULL WHERE id = $1`, [AGORA_SALON_ID]);
    await ensureAgoraNeon();
    await kvSet(STIM_KEY, "{}");
  } else {
    localStore().salons.clear();
    localStore().salons.set(AGORA_SALON_ID, makeAgoraRow());
    localStore().salonState.clear();
    localStore().stim = {};
  }
  console.log("[salonStore] ALL salons reset — Agora cleared, every other salon dropped");
}
