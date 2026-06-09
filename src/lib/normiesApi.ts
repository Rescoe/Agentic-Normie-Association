/**
 * Normies API client
 * Base URL: https://api.normies.art
 *
 * This module wraps all calls to the Normies API.
 * It is the ONLY place in the codebase that knows about the Normies API.
 * The app NEVER duplicates Normies identity data — it reads and composes.
 */

const BASE_URL = process.env.NORMIES_API_BASE_URL ?? "https://api.normies.art";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormieTrait {
  trait_type: string;
  value:      string;
  rarity?:    number;
}

export interface NormieMetadata {
  tokenId:     number;
  name:        string;
  image:       string;
  description: string;
  attributes:  NormieTrait[];
}

export interface AgentIdentity {
  tokenId:   number;
  name:      string;
  archetype: string;
  persona:   string;
  binding?:  string; // linked wallet address if available
}

export interface CanvasState {
  tokenId:      number;
  level:        number;
  actionPoints: number;
  customization?: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    next: { revalidate: 300 }, // 5-minute cache (Next.js fetch cache)
  });
  if (!res.ok) {
    throw new Error(`Normies API error: ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/** Normie ERC-721 metadata (name, image, attributes / traits) */
export async function getNormieMetadata(tokenId: number): Promise<NormieMetadata> {
  return fetchApi<NormieMetadata>(`/normies/metadata/${tokenId}`);
}

/** Current owner address of a Normie on mainnet (from API) */
export async function getNormieOwner(tokenId: number): Promise<string> {
  const data = await fetchApi<{ owner: string }>(`/normies/owner/${tokenId}`);
  return data.owner;
}

/** Normie traits (richer than metadata attributes) */
export async function getNormieTraits(tokenId: number): Promise<NormieTrait[]> {
  const data = await fetchApi<{ traits: NormieTrait[] }>(`/normies/traits/${tokenId}`);
  return data.traits;
}

/** Agent ERC-8004 identity / persona */
export async function getAgentIdentity(tokenId: number): Promise<AgentIdentity> {
  return fetchApi<AgentIdentity>(`/agents/identity/${tokenId}`);
}

/** Agent metadata (ERC-8004 full metadata) */
export async function getAgentMetadata(tokenId: number): Promise<Record<string, unknown>> {
  return fetchApi(`/agents/metadata/${tokenId}`);
}

/** Agent persona preview (short persona string) */
export async function getAgentPersonaPreview(tokenId: number): Promise<string> {
  const data = await fetchApi<{ persona: string }>(`/agents/persona-preview/${tokenId}`);
  return data.persona;
}

/** Canvas state — level and action points */
export async function getCanvasState(tokenId: number): Promise<CanvasState> {
  return fetchApi<CanvasState>(`/canvas/state/${tokenId}`);
}

/** Total count of Normie agents */
export async function getAgentCount(): Promise<number> {
  const data = await fetchApi<{ count: number }>("/agents/count");
  return data.count;
}

/** Paginated list of agents */
export async function getAgentList(): Promise<Record<string, unknown>[]> {
  const data = await fetchApi<{ agents: Record<string, unknown>[] }>("/agents/list");
  return data.agents;
}

// ─── Composite: full member card ──────────────────────────────────────────────

/**
 * Compose all API data needed to render a Normie member card.
 * Called from server-side API routes to avoid multiple client-side fetches.
 */
export async function getNormieMemberCard(tokenId: number) {
  const [metadata, identity] = await Promise.all([
    getNormieMetadata(tokenId).catch(() => null),
    getAgentIdentity(tokenId).catch(() => null),
  ]);
  return { tokenId, metadata, identity };
}

/**
 * Compose all data needed for the generative engine seed.
 * Traits + level + actionPoints = the creative seed.
 */
export async function getGenerativeSeed(tokenId: number) {
  const [metadata, canvas] = await Promise.all([
    getNormieMetadata(tokenId),
    getCanvasState(tokenId).catch(() => ({ tokenId, level: 1, actionPoints: 0 })),
  ]);
  return {
    tokenId,
    traits:       metadata.attributes,
    name:         metadata.name,
    image:        metadata.image,
    level:        canvas.level,
    actionPoints: canvas.actionPoints,
  };
}
