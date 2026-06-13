/**
 * Salon store — persisted to disk, always read-fresh.
 *
 * Data file location:
 *   - Vercel production: /tmp/ana-salon-data.json
 *   - Local dev: ~/.ana-salon-data.json  (os.homedir — guaranteed writable on all OSes)
 *
 * No global cache — every read goes to disk. The file is small (< 500 messages)
 * so this is fast enough and avoids all cross-route isolation issues.
 *
 * Name registry: tokenId → realName, persisted alongside salons.
 * Populated when buildPersona succeeds; used as fallback in addMessage.
 */

import fs   from "fs";
import path from "path";
import os   from "os";

const DATA_FILE = process.env.VERCEL
  ? "/tmp/ana-salon-data.json"
  : path.join(os.homedir(), ".ana-salon-data.json");

console.log("[salonStore] DATA_FILE:", DATA_FILE);

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

// ─── Persistence (no cache — always fresh from disk) ─────────────────────────

function load(): SalonStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw) as SalonStore;
      // Migrate older files that may not have a names field
      if (!parsed.names) parsed.names = {};
      return parsed;
    }
  } catch (e) {
    console.error("[salonStore] load error:", e);
  }
  return { salons: {}, names: {} };
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

function getStore(): SalonStore {
  const store = load();
  ensureAgora(store);
  return store;
}

function mutate(fn: (s: SalonStore) => void): void {
  const store = getStore();
  fn(store);
  save(store);
}

// ─── Name registry ────────────────────────────────────────────────────────────

/** Call this after a successful buildPersona to persist the Normie's real name. */
export function registerName(tokenId: number, name: string): void {
  if (!name || name === `Normie #${tokenId}`) return;
  mutate(s => { s.names[String(tokenId)] = name; });
}

/** Returns the registered real name, or null if only a fallback is known. */
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
  // Resolve the best available name: registered name > provided name > fallback
  const registeredName = getName(msg.tokenId);
  const resolvedName = registeredName ?? (
    msg.name && msg.name !== `Normie #${msg.tokenId}` ? msg.name : `Normie #${msg.tokenId}`
  );

  const id   = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const full: SalonMessage = { id, ...msg, name: resolvedName };

  mutate(s => {
    const sal = s.salons[msg.salonId];
    if (!sal) {
      console.error(`[salonStore] addMessage: salon "${msg.salonId}" not found — store keys:`, Object.keys(s.salons));
      return;
    }
    sal.messages.push(full);
    if (sal.messages.length > MAX_MESSAGES_PER_SALON) {
      sal.messages = sal.messages.slice(-MAX_MESSAGES_PER_SALON);
    }
  });

  return full;
}
