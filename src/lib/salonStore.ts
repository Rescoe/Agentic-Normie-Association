/**
 * Salon store — shared persistence across all Vercel serverless instances.
 *
 * Storage strategy (auto-detected from env):
 *   BLOB_READ_WRITE_TOKEN present → Vercel Blob (production on Vercel)
 *   else                          → local JSON file (dev, single process)
 *
 * All functions are async. Global acts as in-process read cache.
 */

import fs   from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SalonSummary {
  id:           string;
  createdAt:    number;
  period:       { from: number; to: number };
  content:      string;
  messageCount: number;
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
  topic?:    string; // "vote" | "art" | "proposition" | "election" | "libre"
}

export interface Salon {
  id:           string;
  name:         string;
  description:  string;
  createdBy:    number;
  createdAt:    number;
  members:      number[];
  excluded:     number[];
  isOpen:       boolean;
  messages:     SalonMessage[];
  summaries:    SalonSummary[];
  currentTopic: string | null;
}

interface SalonStore {
  salons:           Record<string, Salon>;
  names:            Record<string, string>; // tokenId.toString() → realName
  lastSynthesisAt?: number;                 // timestamp of last synthesis run
  stimulations?:    Record<string, number>; // ip → last user-triggered stim timestamp
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const AGORA_SALON_ID       = "salon_agora_ana";
const NEON_KEY                    = "salon-store";
const DATA_FILE                   = path.join(process.cwd(), "data", "salon.json");
const MAX_MESSAGES_PER_HOUR       = 12;
const MAX_MESSAGES_PER_SALON      = 500;
// Keep last N messages after synthesis (recent context for Normies)
export const SYNTHESIS_KEEP_LAST  = 10;
// Minimum messages in a salon before synthesis is worthwhile
export const SYNTHESIS_MIN_MSGS   = 40;
// 30 days between syntheses
export const SYNTHESIS_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __anaSalonStore: SalonStore | undefined;
}

// ─── Neon I/O ─────────────────────────────────────────────────────────────────

async function neonLoad(): Promise<SalonStore | null> {
  try {
    const { kvGet, USE_NEON } = await import("./db");
    if (!USE_NEON) return null;
    const raw = await kvGet(NEON_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SalonStore;
    if (!parsed.names)  parsed.names  = {};
    if (!parsed.salons) parsed.salons = {};
    for (const salon of Object.values(parsed.salons)) {
      if (!salon.summaries) salon.summaries = [];
    }
    console.log(`[salonStore] neon loaded — ${parsed.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`);
    return parsed;
  } catch (e) {
    console.error("[salonStore] neonLoad error:", e);
    return null;
  }
}

async function neonSave(store: SalonStore): Promise<void> {
  try {
    const { kvSet, USE_NEON } = await import("./db");
    if (!USE_NEON) return;
    await kvSet(NEON_KEY, JSON.stringify(store));
    console.log(`[salonStore] neon saved — ${store.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`);
  } catch (e) {
    console.error("[salonStore] neonSave error:", e);
  }
}

// ─── Local file I/O (dev fallback when NEON_DB_ANA is not set) ───────────────

function fileLoad(): SalonStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as SalonStore;
      if (!parsed.names)  parsed.names  = {};
      if (!parsed.salons) parsed.salons = {};
      for (const salon of Object.values(parsed.salons)) {
        if (!salon.summaries) salon.summaries = [];
      }
      console.log(`[salonStore] file loaded — ${parsed.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`);
      return parsed;
    }
  } catch (e) { console.error("[salonStore] file load error:", e); }
  return { salons: {}, names: {} };
}

function fileSave(store: SalonStore): void {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmp, DATA_FILE);
    console.log(`[salonStore] file saved — ${store.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`);
  } catch (e) { console.error("[salonStore] file save FAILED:", DATA_FILE, e); }
}

// ─── Core ─────────────────────────────────────────────────────────────────────

function makeAgora(): Salon {
  return {
    id: AGORA_SALON_ID, name: "Agora ANA",
    description: "Salon commun de tous les membres de l'ANA. Discussions libres entre Normies.",
    createdBy: 0, createdAt: Date.now(),
    members: [], excluded: [], isOpen: true, messages: [], summaries: [], currentTopic: null,
  };
}

function ensureAgora(s: SalonStore): void {
  if (!s.salons[AGORA_SALON_ID]) s.salons[AGORA_SALON_ID] = makeAgora();
}

async function useNeon(): Promise<boolean> {
  const { USE_NEON } = await import("./db");
  return USE_NEON;
}

// Neon is the source of truth, read fresh on every call — no cross-request
// in-memory caching. Vercel routes serverless functions to whichever Lambda
// instance is available, so a per-instance TTL cache caused different pages
// to see different ages of the same data, sometimes for a full minute.
// Neon reads are fast and this app's traffic is low, so always-fresh is cheap.
async function getStore(): Promise<SalonStore> {
  if (await useNeon()) {
    const fromNeon = await neonLoad();
    const s = fromNeon ?? { salons: {}, names: {} };
    ensureAgora(s);
    return s;
  }
  // Local dev fallback only (no NEON_DB_ANA configured)
  if (!global.__anaSalonStore) {
    const s = fileLoad();
    ensureAgora(s);
    global.__anaSalonStore = s;
  }
  return global.__anaSalonStore;
}

async function mutate(fn: (s: SalonStore) => void): Promise<void> {
  const store = await getStore();
  fn(store);
  if (await useNeon()) {
    await neonSave(store);
  } else {
    global.__anaSalonStore = store;
    fileSave(store);
  }
}

// ─── Debug ────────────────────────────────────────────────────────────────────

export async function getDebugInfo() {
  const store = await getStore();
  const agora = store.salons[AGORA_SALON_ID];
  return {
    mode:              (await useNeon()) ? "neon-postgres" : "local-file",
    globalLoaded:      !!global.__anaSalonStore,
    salonCount:        Object.keys(store.salons).length,
    nameCount:         Object.keys(store.names).length,
    agoraMsgCount:     agora?.messages.length ?? 0,
    agoraSummaryCount: agora?.summaries.length ?? 0,
    lastSynthesisAt:   store.lastSynthesisAt ?? null,
    nextSynthesisAt:   getNextSynthesisAt(store.lastSynthesisAt),
    lastAgoraMsg:      agora?.messages.at(-1) ?? null,
  };
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

export function getNextSynthesisAt(lastSynthesisAt?: number | null): number {
  if (!lastSynthesisAt) {
    // Never synthesized: schedule from now + 30 days
    return Date.now() + SYNTHESIS_INTERVAL_MS;
  }
  return lastSynthesisAt + SYNTHESIS_INTERVAL_MS;
}

export async function isSynthesisDue(): Promise<boolean> {
  const store = await getStore();
  return Date.now() >= getNextSynthesisAt(store.lastSynthesisAt);
}

export async function getSynthesisInfo(): Promise<{
  lastSynthesisAt: number | null;
  nextSynthesisAt: number;
  isDue: boolean;
}> {
  const store = await getStore();
  const next = getNextSynthesisAt(store.lastSynthesisAt);
  return {
    lastSynthesisAt: store.lastSynthesisAt ?? null,
    nextSynthesisAt: next,
    isDue: Date.now() >= next,
  };
}

export async function storeSynthesis(
  salonId: string,
  content: string,
  periodFrom: number,
  periodTo: number,
  messageCount: number,
): Promise<void> {
  const summary: SalonSummary = {
    id:           `summary_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    createdAt:    Date.now(),
    period:       { from: periodFrom, to: periodTo },
    content,
    messageCount,
  };
  await mutate(s => {
    const salon = s.salons[salonId];
    if (!salon) return;
    if (!salon.summaries) salon.summaries = [];

    // Trim messages: keep only the most recent ones (Normies still have recent context)
    const toSummarize = salon.messages.filter(m => m.timestamp <= periodTo);
    salon.messages    = salon.messages.filter(m => m.timestamp >  periodTo);

    // Safety: keep last SYNTHESIS_KEEP_LAST even if all are within period
    if (salon.messages.length === 0 && toSummarize.length > 0) {
      salon.messages = toSummarize.slice(-SYNTHESIS_KEEP_LAST);
    }

    salon.summaries.push(summary);
    // Keep at most 12 summaries (≈ 1 year of monthly archives)
    if (salon.summaries.length > 12) salon.summaries = salon.summaries.slice(-12);
  });
}

export async function markSynthesisDone(): Promise<void> {
  await mutate(s => { s.lastSynthesisAt = Date.now(); });
}

// ─── User stim rate limit (1 per IP per 10 min) ──────────────────────────────

const STIM_WINDOW_MS = 10 * 60 * 1000;

export async function checkStimLimit(ip: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  if (!ip || ip === "unknown") return { allowed: true };
  const store  = await getStore();
  const lastAt = store.stimulations?.[ip];
  if (!lastAt) return { allowed: true };
  const elapsed = Date.now() - lastAt;
  if (elapsed >= STIM_WINDOW_MS) return { allowed: true };
  return { allowed: false, retryAfterMs: STIM_WINDOW_MS - elapsed };
}

export async function recordStim(ip: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  const cutoff = Date.now() - 2 * STIM_WINDOW_MS;
  await mutate(s => {
    if (!s.stimulations) s.stimulations = {};
    s.stimulations[ip] = Date.now();
    // Prune entries older than 48h to keep blob lean
    for (const [k, v] of Object.entries(s.stimulations)) {
      if (v < cutoff) delete s.stimulations![k];
    }
  });
}

// ─── Name registry ────────────────────────────────────────────────────────────

export async function registerName(tokenId: number, name: string): Promise<void> {
  if (!name || name === `Normie #${tokenId}`) return;
  await mutate(s => { s.names[String(tokenId)] = name; });
}

export async function getName(tokenId: number): Promise<string | null> {
  const n = (await getStore()).names[String(tokenId)];
  return n && n !== `Normie #${tokenId}` ? n : null;
}

// ─── Salon CRUD ───────────────────────────────────────────────────────────────

export async function listSalons(): Promise<Salon[]> {
  return Object.values((await getStore()).salons).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSalon(id: string): Promise<Salon | null> {
  return (await getStore()).salons[id] ?? null;
}

export async function getActiveSalonByCreator(tokenId: number): Promise<Salon | null> {
  return Object.values((await getStore()).salons).find(s => s.createdBy === tokenId && s.isOpen) ?? null;
}

export async function getMemberStats(tokenId: number): Promise<{
  totalMessages: number; salonsCount: number; lastActive: number | null;
}> {
  let totalMessages = 0, salonsCount = 0, lastActive: number | null = null;
  for (const salon of Object.values((await getStore()).salons)) {
    const msgs = salon.messages.filter(m => m.tokenId === tokenId);
    if (msgs.length > 0) {
      totalMessages += msgs.length;
      salonsCount++;
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
    members: params.members ?? [], excluded: [], isOpen: true,
    messages: [], summaries: [], currentTopic: null,
  };
  await mutate(s => { s.salons[id] = salon; });
  return salon;
}

export async function closeSalon(id: string, byTokenId: number): Promise<{ ok: boolean; error?: string }> {
  const salon = await getSalon(id);
  if (!salon) return { ok: false, error: "Salon not found" };
  // byTokenId=0 means system/keeper close — always allowed
  if (byTokenId !== 0 && salon.createdBy !== 0 && salon.createdBy !== byTokenId) {
    return { ok: false, error: "Only creator can close salon" };
  }
  await mutate(s => { s.salons[id].isOpen = false; });
  return { ok: true };
}

export async function excludeMember(
  salonId: string, targetId: number, byTokenId: number
): Promise<{ ok: boolean; error?: string }> {
  const salon = await getSalon(salonId);
  if (!salon) return { ok: false, error: "Salon not found" };
  if (salon.createdBy !== byTokenId) return { ok: false, error: "Only creator can exclude members" };
  await mutate(s => {
    const sal = s.salons[salonId];
    if (!sal.excluded.includes(targetId)) sal.excluded.push(targetId);
    sal.members = sal.members.filter(m => m !== targetId);
  });
  return { ok: true };
}

export async function setTopic(salonId: string, topic: string | null): Promise<void> {
  await mutate(s => { if (s.salons[salonId]) s.salons[salonId].currentTopic = topic; });
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(salonId: string, since?: number): Promise<SalonMessage[]> {
  const salon = await getSalon(salonId);
  if (!salon) return [];
  if (!since) return salon.messages;
  return salon.messages.filter(m => m.timestamp > since);
}

export async function checkRateLimit(
  salonId: string, tokenId: number
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const salon = await getSalon(salonId);
  // Permissive if salon not found (cold start / Neon miss) — better to allow than silence all Normies
  if (!salon) return { allowed: true };
  const oneHourAgo  = Date.now() - 3_600_000;
  const recentCount = salon.messages.filter(
    m => m.tokenId === tokenId && m.timestamp > oneHourAgo && m.isLlm
  ).length;
  if (recentCount >= MAX_MESSAGES_PER_HOUR) {
    const oldest = salon.messages
      .filter(m => m.tokenId === tokenId && m.timestamp > oneHourAgo && m.isLlm)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    return { allowed: false, retryAfterMs: Math.max(0, (oldest?.timestamp ?? Date.now()) + 3_600_000 - Date.now()) };
  }
  return { allowed: true };
}

export async function addMessage(msg: Omit<SalonMessage, "id"> & { topic?: string }): Promise<SalonMessage> {
  const registeredName = await getName(msg.tokenId);
  const resolvedName   = registeredName ?? (
    msg.name && msg.name !== `Normie #${msg.tokenId}` ? msg.name : `Normie #${msg.tokenId}`
  );
  const id   = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const full: SalonMessage = { id, ...msg, name: resolvedName };

  await mutate(s => {
    const sal = s.salons[msg.salonId];
    if (!sal) {
      if (msg.salonId === AGORA_SALON_ID) {
        s.salons[AGORA_SALON_ID] = makeAgora();
        s.salons[AGORA_SALON_ID].messages.push(full);
      }
      return;
    }
    if (!sal.isOpen) {
      console.warn(`[salonStore] addMessage skipped — salon "${sal.name}" (${msg.salonId}) is closed`);
      return;
    }
    sal.messages.push(full);
    if (sal.messages.length > MAX_MESSAGES_PER_SALON) sal.messages = sal.messages.slice(-MAX_MESSAGES_PER_SALON);
  });

  const count = (await getStore()).salons[msg.salonId]?.messages.length ?? 0;
  console.log(`[salonStore] +msg ${resolvedName} → ${count} total in ${msg.salonId}`);
  return full;
}

// ─── Reset ────────────────────────────────────────────────────────────────────

/** Wipes all messages, syntheses, topic, and stimulation records so Normies and users start fresh. */
export async function resetAgora(): Promise<void> {
  await mutate(s => {
    s.salons[AGORA_SALON_ID] = makeAgora();
    s.stimulations = {};
  });
  console.log("[salonStore] Agora reset — messages, syntheses, and stim limits cleared");
}
