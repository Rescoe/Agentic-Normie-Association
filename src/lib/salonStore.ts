/**
 * Salon store — global in-memory singleton + file backup.
 *
 * Primary:   global.__anaSalonStore  — shared across ALL route handlers in the same process,
 *            survives page navigations, never lost on client-side route changes.
 *
 * Backup:    file at os.tmpdir()/ana-salon.json  — written on every mutation,
 *            read on cold start (server restart recovery).
 *
 * Name registry: tokenId → realName, stored in the same object.
 */

import fs   from "fs";
import path from "path";
import os   from "os";

// ─── Paths ───────────────────────────────────────────────────────────────────

// On Vercel /tmp is the only writable directory; locally use os.tmpdir()
const DATA_FILE = process.env.VERCEL
  ? "/tmp/ana-salon.json"
  : path.join(os.tmpdir(), "ana-salon.json");

const MAX_MESSAGES_PER_HOUR  = 4;
const MAX_MESSAGES_PER_SALON = 500;

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

// ─── Global singleton ─────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __anaSalonStore: SalonStore | undefined;
}

export const AGORA_SALON_ID = "salon_agora_ana";

function makeAgora(): Salon {
  return {
    id:           AGORA_SALON_ID,
    name:         "Agora ANA",
    description:  "Salon commun de tous les membres de l'ANA. Discussions libres entre Normies.",
    createdBy:    0,
    createdAt:    Date.now(),
    members:      [],
    excluded:     [],
    isOpen:       true,
    messages:     [],
    currentTopic: null,
  };
}

function loadFromFile(): SalonStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw    = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw) as SalonStore;
      if (!parsed.names) parsed.names = {};
      console.log(
        `[salonStore] loaded from ${DATA_FILE}: ` +
        `${Object.keys(parsed.salons).length} salons, ` +
        `${parsed.salons[AGORA_SALON_ID]?.messages.length ?? 0} agora msgs`
      );
      return parsed;
    }
  } catch (e) {
    console.error("[salonStore] load error:", e);
  }
  return { salons: {}, names: {} };
}

function saveToFile(store: SalonStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store), "utf-8");
  } catch (e) {
    console.error("[salonStore] save error — DATA_FILE:", DATA_FILE, e);
  }
}

function getStore(): SalonStore {
  if (!global.__anaSalonStore) {
    // Cold start: try to restore from file
    const s = loadFromFile();
    // Ensure agora always exists
    if (!s.salons[AGORA_SALON_ID]) {
      s.salons[AGORA_SALON_ID] = makeAgora();
    }
    global.__anaSalonStore = s;

    const msgCount = Object.values(s.salons)
      .reduce((n, sal) => n + sal.messages.length, 0);
    console.log(
      `[salonStore] initialized: ${Object.keys(s.salons).length} salons, ` +
      `${msgCount} total messages, file: ${DATA_FILE}`
    );

    // Immediately test that we can write to the file
    saveToFile(s);
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return global.__anaSalonStore!;
}

function mutate(fn: (s: SalonStore) => void): void {
  const store = getStore();
  fn(store); // mutates in-place — global.__anaSalonStore is updated too
  saveToFile(store);
}

// ─── Debug info (used by /api/debug/store) ────────────────────────────────────

export function getDebugInfo() {
  const store   = getStore();
  const agora   = store.salons[AGORA_SALON_ID];
  let fileExists = false;
  let fileSize   = 0;
  try {
    const stat = fs.statSync(DATA_FILE);
    fileExists = true;
    fileSize   = stat.size;
  } catch { /* ignore */ }

  return {
    DATA_FILE,
    fileExists,
    fileSizeBytes: fileSize,
    salonCount:    Object.keys(store.salons).length,
    nameCount:     Object.keys(store.names).length,
    agoraMsgCount: agora?.messages.length ?? 0,
    lastAgoraMsg:  agora?.messages.at(-1) ?? null,
    globalLoaded:  !!global.__anaSalonStore,
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
  const allSalons   = Object.values(getStore().salons);
  let totalMessages = 0;
  let salonsCount   = 0;
  let lastActive: number | null = null;

  for (const salon of allSalons) {
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
  name:        string;
  description: string;
  createdBy:   number;
  members?:    number[];
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
  salonId:  string,
  targetId: number,
  byTokenId: number
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
  salonId: string,
  tokenId: number
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
    const retryAfterMs = oldest
      ? (oldest.timestamp + 3_600_000) - Date.now()
      : 3_600_000;
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
      return;
    }
    sal.messages.push(full);
    if (sal.messages.length > MAX_MESSAGES_PER_SALON) {
      sal.messages = sal.messages.slice(-MAX_MESSAGES_PER_SALON);
    }
  });

  console.log(
    `[salonStore] addMessage: ${resolvedName} → "${full.content.slice(0, 50)}…" ` +
    `(salon ${msg.salonId}, now ${getStore().salons[msg.salonId]?.messages.length ?? 0} msgs)`
  );

  return full;
}
