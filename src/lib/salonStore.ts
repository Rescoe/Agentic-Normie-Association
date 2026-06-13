/**
 * In-process salon store — persisted to .salon-data.json (dev) or /tmp (Vercel).
 *
 * Rate limit: MAX_MESSAGES_PER_HOUR per Normie per salon (auto-exchange).
 * Manual stimulate bypasses this via force flag in the keeper.
 */

import fs from "fs";
import path from "path";

const DATA_FILE = process.env.VERCEL
  ? "/tmp/salon-data.json"
  : path.join(process.cwd(), ".salon-data.json");

const MAX_MESSAGES_PER_HOUR = 4;
const MAX_MESSAGES_PER_SALON = 500;

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
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function load(): SalonStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as SalonStore;
    }
  } catch (e) {
    console.error("[salonStore] load error:", e);
  }
  return { salons: {} };
}

function save(store: SalonStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store), "utf-8");
  } catch (e) {
    console.error("[salonStore] save error:", e);
  }
}

export const AGORA_SALON_ID = "salon_agora_ana";

function ensureAgora(store: SalonStore): void {
  if (store.salons[AGORA_SALON_ID]) return;
  store.salons[AGORA_SALON_ID] = {
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

/**
 * Always reads from file so every route gets a consistent view.
 * Keeps global cache as write-back target to avoid repeated file reads
 * within the same request, but ALWAYS syncs from file on first call per module.
 */
declare global {
  // eslint-disable-next-line no-var
  var __salonStore: SalonStore | undefined;
  // eslint-disable-next-line no-var
  var __salonStoreTs: number | undefined;
}

const CACHE_TTL_MS = 1_000; // 1s cache — fresh enough for real-time use

function getStore(): SalonStore {
  const now = Date.now();
  // Refresh from disk if cache is stale or missing
  if (!global.__salonStore || !global.__salonStoreTs || (now - global.__salonStoreTs) > CACHE_TTL_MS) {
    const store = load();
    ensureAgora(store);
    global.__salonStore  = store;
    global.__salonStoreTs = now;
  }
  return global.__salonStore;
}

function mutate(fn: (s: SalonStore) => void): void {
  // Read fresh from disk before mutating to avoid overwriting concurrent writes
  const store = load();
  ensureAgora(store);
  fn(store);
  save(store);
  // Update cache
  global.__salonStore   = store;
  global.__salonStoreTs = Date.now();
}

// ─── Salon CRUD ──────────────────────────────────────────────────────────────

export function listSalons(): Salon[] {
  return Object.values(getStore().salons).sort((a, b) => b.createdAt - a.createdAt);
}

export function getSalon(id: string): Salon | null {
  return getStore().salons[id] ?? null;
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
  salonId:   string,
  targetId:  number,
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

// ─── Messages ────────────────────────────────────────────────────────────────

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

export function getActiveSalonByCreator(tokenId: number): Salon | null {
  return Object.values(getStore().salons).find(s => s.createdBy === tokenId && s.isOpen) ?? null;
}

export function getMemberStats(tokenId: number): {
  totalMessages: number;
  salonsCount:   number;
  lastActive:    number | null;
} {
  const allSalons  = Object.values(getStore().salons);
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

export function addMessage(msg: Omit<SalonMessage, "id">): SalonMessage {
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const full: SalonMessage = { id, ...msg };
  mutate(s => {
    const sal = s.salons[msg.salonId];
    if (!sal) {
      console.error(`[salonStore] addMessage: salon "${msg.salonId}" not found in store`);
      return;
    }
    sal.messages.push(full);
    if (sal.messages.length > MAX_MESSAGES_PER_SALON) {
      sal.messages = sal.messages.slice(-MAX_MESSAGES_PER_SALON);
    }
  });
  return full;
}
