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

export interface SalonMessage {
  id:        string;
  salonId:   string;
  tokenId:   number;
  name:      string;
  imageUrl:  string;
  content:   string;
  isLlm:     boolean;
  timestamp: number;
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
  currentTopic: string | null;
}

interface SalonStore {
  salons: Record<string, Salon>;
  names:  Record<string, string>; // tokenId.toString() → realName
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const AGORA_SALON_ID  = "salon_agora_ana";
const BLOB_PATH               = "salon/store.json";
const DATA_FILE               = path.join(process.cwd(), "data", "salon.json");
const MAX_MESSAGES_PER_HOUR  = 4;
const MAX_MESSAGES_PER_SALON = 500;

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

console.log(`[salonStore] mode: ${USE_BLOB ? "Vercel Blob" : `local file (${DATA_FILE})`}`);

// ─── Global in-process cache ──────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __anaSalonStore: SalonStore | undefined;
}

// ─── Vercel Blob I/O ─────────────────────────────────────────────────────────

async function blobLoad(): Promise<SalonStore | null> {
  try {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: BLOB_PATH });
    if (blobs.length === 0) return null;
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = await res.json() as SalonStore;
    if (!parsed.names) parsed.names = {};
    console.log(`[salonStore] blob loaded — ${parsed.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`);
    return parsed;
  } catch (e) {
    console.error("[salonStore] blob load error:", e);
    return null;
  }
}

async function blobSave(store: SalonStore): Promise<void> {
  try {
    const { put } = await import("@vercel/blob");
    await put(BLOB_PATH, JSON.stringify(store), {
      access:           "public",
      addRandomSuffix:  false,
      contentType:      "application/json",
    });
    console.log(`[salonStore] blob saved — ${store.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`);
  } catch (e) {
    console.error("[salonStore] blob save error:", e);
  }
}

// ─── Local file I/O (dev fallback) ───────────────────────────────────────────

function fileLoad(): SalonStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as SalonStore;
      if (!parsed.names) parsed.names = {};
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
    members: [], excluded: [], isOpen: true, messages: [], currentTopic: null,
  };
}

function ensureAgora(s: SalonStore): void {
  if (!s.salons[AGORA_SALON_ID]) s.salons[AGORA_SALON_ID] = makeAgora();
}

async function getStore(): Promise<SalonStore> {
  if (!global.__anaSalonStore) {
    const s = USE_BLOB
      ? ((await blobLoad()) ?? { salons: {}, names: {} })
      : fileLoad();
    ensureAgora(s);
    global.__anaSalonStore = s;
    console.log(
      `[salonStore] init (${USE_BLOB ? "blob" : "file"}) — ` +
      `${s.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return global.__anaSalonStore!;
}

async function mutate(fn: (s: SalonStore) => void): Promise<void> {
  // For Blob: always read fresh before writing (prevents overwriting concurrent writes)
  // For file: use global (single process, no concurrency)
  let store: SalonStore;
  if (USE_BLOB) {
    store = (await blobLoad()) ?? { salons: {}, names: {} };
    ensureAgora(store);
  } else {
    store = global.__anaSalonStore ?? fileLoad();
    ensureAgora(store);
  }

  fn(store);

  if (USE_BLOB) {
    await blobSave(store);
  } else {
    fileSave(store);
  }

  global.__anaSalonStore = store;
}

// ─── Debug ────────────────────────────────────────────────────────────────────

export async function getDebugInfo() {
  const store = await getStore();
  const agora = store.salons[AGORA_SALON_ID];
  return {
    mode:          USE_BLOB ? "vercel-blob" : "local-file",
    globalLoaded:  !!global.__anaSalonStore,
    salonCount:    Object.keys(store.salons).length,
    nameCount:     Object.keys(store.names).length,
    agoraMsgCount: agora?.messages.length ?? 0,
    lastAgoraMsg:  agora?.messages.at(-1) ?? null,
  };
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
    members: params.members ?? [], excluded: [], isOpen: true, messages: [], currentTopic: null,
  };
  await mutate(s => { s.salons[id] = salon; });
  return salon;
}

export async function closeSalon(id: string, byTokenId: number): Promise<{ ok: boolean; error?: string }> {
  const salon = await getSalon(id);
  if (!salon) return { ok: false, error: "Salon not found" };
  if (salon.createdBy !== 0 && salon.createdBy !== byTokenId) return { ok: false, error: "Only creator can close salon" };
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
  if (!salon) return { allowed: false };
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

export async function addMessage(msg: Omit<SalonMessage, "id">): Promise<SalonMessage> {
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
    sal.messages.push(full);
    if (sal.messages.length > MAX_MESSAGES_PER_SALON) sal.messages = sal.messages.slice(-MAX_MESSAGES_PER_SALON);
  });

  const count = (await getStore()).salons[msg.salonId]?.messages.length ?? 0;
  console.log(`[salonStore] +msg ${resolvedName} → ${count} total in ${msg.salonId}`);
  return full;
}
