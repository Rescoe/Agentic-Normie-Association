/**
 * Salon store — dual persistence: global singleton + JSON file.
 *
 * The file lives at <project>/data/salon.json (outside .next, committed to .gitignore).
 * The global guarantees in-process sharing across route handlers.
 * The file guarantees survival across server restarts.
 */

import fs   from "fs";
import path from "path";

// ─── File path ────────────────────────────────────────────────────────────────

// process.cwd() = project root when Next.js runs. The `data/` dir is created
// at runtime if missing.
const DATA_DIR  = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "salon.json");

// On Vercel use /tmp (ephemeral, but at least within one function execution)
const FILE_PATH = process.env.VERCEL ? "/tmp/salon.json" : DATA_FILE;

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

// ─── Global singleton (in-process) ───────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __anaSalonStore: SalonStore | undefined;
}

export const AGORA_SALON_ID = "salon_agora_ana";

const MAX_MESSAGES_PER_HOUR  = 4;
const MAX_MESSAGES_PER_SALON = 500;

function makeAgora(): Salon {
  return {
    id:          AGORA_SALON_ID,
    name:        "Agora ANA",
    description: "Salon commun de tous les membres de l'ANA. Discussions libres entre Normies.",
    createdBy:   0,
    createdAt:   Date.now(),
    members:     [],
    excluded:    [],
    isOpen:      true,
    messages:    [],
    currentTopic: null,
  };
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function loadFromDisk(): SalonStore {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw    = fs.readFileSync(FILE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as SalonStore;
      if (!parsed.names) parsed.names = {};
      const total = Object.values(parsed.salons)
        .reduce((n, s) => n + s.messages.length, 0);
      console.log(`[salonStore] loaded ${FILE_PATH} — ${total} messages`);
      return parsed;
    }
  } catch (e) {
    console.error("[salonStore] load error:", e);
  }
  return { salons: {}, names: {} };
}

function saveToDisk(store: SalonStore): void {
  try {
    // Ensure directory exists
    if (!process.env.VERCEL) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const json = JSON.stringify(store, null, 2);
    // Atomic write: write to temp file then rename
    const tmp = FILE_PATH + ".tmp";
    fs.writeFileSync(tmp, json, "utf-8");
    fs.renameSync(tmp, FILE_PATH);
    const agora = store.salons[AGORA_SALON_ID];
    console.log(`[salonStore] saved → ${FILE_PATH} (${agora?.messages.length ?? 0} agora msgs)`);
  } catch (e) {
    console.error("[salonStore] save FAILED:", FILE_PATH, e);
  }
}

// ─── Store access ─────────────────────────────────────────────────────────────

function getStore(): SalonStore {
  if (!global.__anaSalonStore) {
    const s = loadFromDisk();
    if (!s.salons[AGORA_SALON_ID]) {
      s.salons[AGORA_SALON_ID] = makeAgora();
    }
    global.__anaSalonStore = s;
    console.log(
      `[salonStore] initialized global — ${Object.keys(s.salons).length} salons, ` +
      `${s.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs, file: ${FILE_PATH}`
    );
    // Validate we can write
    saveToDisk(s);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return global.__anaSalonStore!;
}

function mutate(fn: (s: SalonStore) => void): void {
  const store = getStore();
  fn(store);          // mutates in-place — global is updated immediately
  saveToDisk(store);  // persist backup
}

// ─── Debug ────────────────────────────────────────────────────────────────────

export function getDebugInfo() {
  const store  = getStore();
  const agora  = store.salons[AGORA_SALON_ID];
  let fileSize = 0;
  try { fileSize = fs.statSync(FILE_PATH).size; } catch { /* ignore */ }

  return {
    FILE_PATH,
    fileExists:    fileSize > 0,
    fileSizeBytes: fileSize,
    globalLoaded:  !!global.__anaSalonStore,
    salonCount:    Object.keys(store.salons).length,
    nameCount:     Object.keys(store.names).length,
    agoraMsgCount: agora?.messages.length ?? 0,
    lastAgoraMsg:  agora?.messages.at(-1) ?? null,
  };
}

// ─── Name registry ────────────────────────────────────────────────────────────

export function registerName(tokenId: number, name: string): void {
  if (!name || name === `Normie #${tokenId}`) return;
  mutate(s => { s.names[String(tokenId)] = name; });
}

export function getName(tokenId: number): string | null {
  const n = getStore().names[String(tokenId)];
  return n && n !== `Normie #${tokenId}` ? n : null;
}

// ─── Salon CRUD ───────────────────────────────────────────────────────────────

export function listSalons(): Salon[] {
  return Object.values(getStore().salons).sort((a, b) => b.createdAt - a.createdAt);
}

export function getSalon(id: string): Salon | null {
  return getStore().salons[id] ?? null;
}

export function getActiveSalonByCreator(tokenId: number): Salon | null {
  return Object.values(getStore().salons).find(s => s.createdBy === tokenId && s.isOpen) ?? null;
}

export function getMemberStats(tokenId: number): {
  totalMessages: number;
  salonsCount:   number;
  lastActive:    number | null;
} {
  let totalMessages = 0, salonsCount = 0;
  let lastActive: number | null = null;
  for (const salon of Object.values(getStore().salons)) {
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

export function createSalon(params: {
  name: string; description: string; createdBy: number; members?: number[];
}): Salon {
  const id = `salon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const salon: Salon = {
    id,
    name:         params.name.slice(0, 60),
    description:  params.description.slice(0, 200),
    createdBy:    params.createdBy,
    createdAt:    Date.now(),
    members:      params.members ?? [],
    excluded:     [],
    isOpen:       true,
    messages:     [],
    currentTopic: null,
  };
  mutate(s => { s.salons[id] = salon; });
  return salon;
}

export function closeSalon(id: string, byTokenId: number): { ok: boolean; error?: string } {
  const salon = getSalon(id);
  if (!salon) return { ok: false, error: "Salon not found" };
  if (salon.createdBy !== 0 && salon.createdBy !== byTokenId) {
    return { ok: false, error: "Only creator can close salon" };
  }
  mutate(s => { s.salons[id].isOpen = false; });
  return { ok: true };
}

export function excludeMember(
  salonId: string, targetId: number, byTokenId: number
): { ok: boolean; error?: string } {
  const salon = getSalon(salonId);
  if (!salon) return { ok: false, error: "Salon not found" };
  if (salon.createdBy !== byTokenId) return { ok: false, error: "Only creator can exclude members" };
  mutate(s => {
    const sal = s.salons[salonId];
    if (!sal.excluded.includes(targetId)) sal.excluded.push(targetId);
    sal.members = sal.members.filter(m => m !== targetId);
  });
  return { ok: true };
}

export function setTopic(salonId: string, topic: string | null): void {
  mutate(s => {
    if (s.salons[salonId]) s.salons[salonId].currentTopic = topic;
  });
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function getMessages(salonId: string, since?: number): SalonMessage[] {
  const salon = getSalon(salonId);
  if (!salon) return [];
  if (!since) return salon.messages;
  return salon.messages.filter(m => m.timestamp > since);
}

export function checkRateLimit(
  salonId: string, tokenId: number
): { allowed: boolean; retryAfterMs?: number } {
  const salon = getSalon(salonId);
  if (!salon) return { allowed: false };
  const oneHourAgo  = Date.now() - 3_600_000;
  const recentCount = salon.messages.filter(
    m => m.tokenId === tokenId && m.timestamp > oneHourAgo && m.isLlm
  ).length;
  if (recentCount >= MAX_MESSAGES_PER_HOUR) {
    const oldest = salon.messages
      .filter(m => m.tokenId === tokenId && m.timestamp > oneHourAgo && m.isLlm)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    const retryAfterMs = oldest ? (oldest.timestamp + 3_600_000) - Date.now() : 3_600_000;
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }
  return { allowed: true };
}

export function addMessage(msg: Omit<SalonMessage, "id">): SalonMessage {
  const registeredName = getName(msg.tokenId);
  const resolvedName = registeredName ?? (
    msg.name && msg.name !== `Normie #${msg.tokenId}` ? msg.name : `Normie #${msg.tokenId}`
  );
  const id   = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const full: SalonMessage = { id, ...msg, name: resolvedName };

  mutate(s => {
    const sal = s.salons[msg.salonId];
    if (!sal) {
      console.error(`[salonStore] addMessage: salon "${msg.salonId}" not found. Keys:`, Object.keys(s.salons));
      // Auto-create agora if missing (safety net)
      if (msg.salonId === AGORA_SALON_ID) {
        s.salons[AGORA_SALON_ID] = makeAgora();
        s.salons[AGORA_SALON_ID].messages.push(full);
      }
      return;
    }
    sal.messages.push(full);
    if (sal.messages.length > MAX_MESSAGES_PER_SALON) {
      sal.messages = sal.messages.slice(-MAX_MESSAGES_PER_SALON);
    }
  });

  const count = getStore().salons[msg.salonId]?.messages.length ?? 0;
  console.log(`[salonStore] +msg from ${resolvedName} → ${count} total in ${msg.salonId}`);

  return full;
}
