/**
 * drawStore.ts — persistence for spontaneous member drawings (artForm
 * "pixel-drawing" submitted OUTSIDE the ANAWork pipeline: no proposal, no
 * collective vote — just member auth, the anti-noise check, and one peer
 * review). Same Neon-blob-with-file-fallback pattern as workStore.ts, kept
 * under its own key since this is a distinct, much simpler lifecycle.
 *
 * Approved drawings aren't pushed anywhere from here — proof-of-draw pulls
 * them (GET /api/ana-art/feed, see that route), the same way it pulls
 * published celebration works. This store has no notion of "delivered".
 */

import fs   from "fs";
import path from "path";

export interface SpontaneousDrawing {
  id:               string;
  submittedBy:      number;
  submittedAt:      number;
  pixels:           string; // base64 raw grayscale bytes, canvasW*canvasH, 0-255
  canvasW:          number;
  canvasH:          number;
  automationRatio:  number;
  reviewerTokenId:  number;
  decision?:        "approved" | "rejected";
  decisionNote?:    string;
  decidedAt?:       number;
}

interface DrawStore {
  drawings: Record<string, SpontaneousDrawing>;
}

const NEON_KEY  = "drawing-store";
const DATA_FILE = path.join(process.cwd(), "data", "drawings.json");

declare global {
  // eslint-disable-next-line no-var
  var __anaDrawStore: DrawStore | undefined;
}

async function neonLoad(): Promise<DrawStore | null> {
  try {
    const { kvGet, USE_NEON } = await import("./db");
    if (!USE_NEON) return null;
    const raw = await kvGet(NEON_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as DrawStore;
    if (!s.drawings) s.drawings = {};
    return s;
  } catch (e) {
    console.error("[drawStore] neonLoad error:", e);
    return null;
  }
}

async function neonSave(store: DrawStore): Promise<void> {
  try {
    const { kvSet, USE_NEON } = await import("./db");
    if (!USE_NEON) return;
    await kvSet(NEON_KEY, JSON.stringify(store));
  } catch (e) {
    console.error("[drawStore] neonSave error:", e);
  }
}

function fileLoad(): DrawStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const s = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as DrawStore;
      if (!s.drawings) s.drawings = {};
      return s;
    }
  } catch { /* empty */ }
  return { drawings: {} };
}

function fileSave(store: DrawStore): void {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error("[drawStore] fileSave error:", e); }
}

async function useNeon(): Promise<boolean> {
  const { USE_NEON } = await import("./db");
  return USE_NEON;
}

async function getStore(): Promise<DrawStore> {
  if (await useNeon()) {
    const fromNeon = await neonLoad();
    const s = fromNeon ?? { drawings: {} };
    if (!s.drawings) s.drawings = {};
    return s;
  }
  if (!global.__anaDrawStore) global.__anaDrawStore = fileLoad();
  return global.__anaDrawStore;
}

// Same race-safety as workStore.ts's mutate(): re-read immediately before
// saving and merge back anything written by a concurrent request, so a
// read-modify-write never silently drops another submission.
async function mutate(fn: (s: DrawStore) => void): Promise<void> {
  const store = await getStore();
  fn(store);

  if (await useNeon()) {
    const latest = await neonLoad();
    if (latest?.drawings) {
      for (const [id, d] of Object.entries(latest.drawings)) {
        if (!(id in store.drawings)) store.drawings[id] = d;
      }
    }
    await neonSave(store);
  } else {
    global.__anaDrawStore = store;
    fileSave(store);
  }
}

export async function getDrawing(id: string): Promise<SpontaneousDrawing | null> {
  return (await getStore()).drawings[id] ?? null;
}

export async function listDrawings(): Promise<SpontaneousDrawing[]> {
  return Object.values((await getStore()).drawings);
}

export async function createDrawing(
  params: Omit<SpontaneousDrawing, "id" | "submittedAt">
): Promise<SpontaneousDrawing> {
  const id = `draw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const drawing: SpontaneousDrawing = { ...params, id, submittedAt: Date.now() };
  await mutate(s => { s.drawings[id] = drawing; });
  return drawing;
}

export async function updateDrawing(id: string, updates: Partial<SpontaneousDrawing>): Promise<void> {
  await mutate(s => { if (s.drawings[id]) Object.assign(s.drawings[id], updates); });
}
