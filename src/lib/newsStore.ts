import fs from "fs";
import path from "path";
import { kvGet, kvListByPrefix, kvSet, USE_NEON } from "./db";

export interface ANANewsItem {
  id: string;
  sourceEventId: string;
  eventType: string;
  title: string;
  body: string;
  socialText: string;
  link?: string;
  eventAt: number;
  publishedAt: number;
  authorTokenId: number;
  authorName: string;
  authorRole: "Rapporteur";
}

const PREFIX = "news:item:";
const SEEN_KEY = "news:seen-events";
const LOCAL_FILE = path.join(process.cwd(), ".ana-news.json");

function readLocal(): ANANewsItem[] {
  try { return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8")) as ANANewsItem[]; }
  catch { return []; }
}

export async function listNews(limit = 50): Promise<ANANewsItem[]> {
  const items = USE_NEON
    ? (await kvListByPrefix(PREFIX)).flatMap(row => {
        try { return [JSON.parse(row.value) as ANANewsItem]; } catch { return []; }
      })
    : readLocal();
  return items.sort((a, b) => b.eventAt - a.eventAt).slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function saveNews(items: ANANewsItem[]): Promise<void> {
  if (!items.length) return;
  if (USE_NEON) {
    await Promise.all(items.map(item => kvSet(PREFIX + item.id, JSON.stringify(item))));
    return;
  }
  const existing = readLocal();
  const byId = new Map(existing.map(item => [item.id, item]));
  for (const item of items) byId.set(item.id, item);
  fs.writeFileSync(LOCAL_FILE, JSON.stringify([...byId.values()], null, 2));
}

export async function getSeenNewsEventIds(): Promise<Set<string>> {
  if (!USE_NEON) return new Set(readLocal().map(item => item.sourceEventId));
  const raw = await kvGet(SEEN_KEY);
  try { return new Set(JSON.parse(raw ?? "[]") as string[]); } catch { return new Set(); }
}

export async function markNewsEventsSeen(ids: string[]): Promise<void> {
  if (!ids.length || !USE_NEON) return;
  const seen = await getSeenNewsEventIds();
  for (const id of ids) seen.add(id);
  // A bounded cursor is enough: only recent activity is ever considered.
  await kvSet(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
}
