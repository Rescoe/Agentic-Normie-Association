/**
 * Normies API client — source de vérité pour les identités des agents.
 * Base URL: https://api.normies.art
 *
 * RÈGLE : ce module est le SEUL endroit qui connaît l'API Normies.
 * On ne duplique jamais les données d'identité côté ANA.
 *
 * Endpoints réels vérifiés sur la doc publique :
 *   GET /holders/:address            — tokenIds détenus par un wallet
 *   GET /normie/:id/metadata         — metadata NFT complète
 *   GET /normie/:id/traits           — traits décodés JSON
 *   GET /normie/:id/owner            — adresse owner actuelle
 *   GET /normie/:id/image.png        — rendu PNG 1000×1000
 *   GET /normie/:id/image.svg        — rendu SVG
 *   GET /normie/:id/canvas/info      — level, action points
 *   GET /agents/info/:tokenId        — identité agentique riche (ERC-8004)
 *   GET /agents/metadata/:tokenId    — metadata ERC-8004
 *   GET /agents/list                 — registre paginé des agents
 *   GET /agents/binding/:tokenId     — binding wallet↔agent
 */

const BASE_URL = process.env.NORMIES_API_BASE_URL ?? "https://api.normies.art";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormieTrait {
  trait_type: string;
  value:      string;
  rarity?:    number;
}

export interface NormieMetadata {
  tokenId?:    number;
  name:        string;
  image:       string;       // URL absolute or relative
  description: string;
  attributes:  NormieTrait[];
}

export interface AgentInfo {
  tokenId:    number;
  name?:      string;
  archetype?: string;
  persona?:   string;
  binding?:   string;
}

export interface CanvasInfo {
  tokenId?:      number;
  level:         number;
  actionPoints:  number;
  customized?:   boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchApi<T>(path: string, revalidate = 300): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`Normies API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

// ─── Direct image URL (no fetch needed) ──────────────────────────────────────

/** URL directe du PNG 1000×1000 d'un Normie. Utilisable dans <img src> ou next/image. */
export function getNormieImageUrl(tokenId: number): string {
  return `${BASE_URL}/normie/${tokenId}/image.png`;
}

/** URL directe du SVG d'un Normie. */
export function getNormieSvgUrl(tokenId: number): string {
  return `${BASE_URL}/normie/${tokenId}/image.svg`;
}

// ─── Ownership & Holdings ─────────────────────────────────────────────────────

/**
 * Tous les tokenIds détenus par un wallet sur Ethereum mainnet.
 * Endpoint: GET /holders/:address
 * Retourne [] si le wallet ne détient aucun Normie.
 */
export async function getHolderTokenIds(address: string): Promise<number[]> {
  try {
    const data = await fetchApi<number[] | { tokenIds: number[] } | { tokens: number[] }>(
      `/holders/${address}`,
      30 // cache court : l'ownership peut changer
    );
    // Normalise les différents formats de réponse possibles
    if (Array.isArray(data)) return data;
    if ("tokenIds" in data && Array.isArray(data.tokenIds)) return data.tokenIds;
    if ("tokens"   in data && Array.isArray(data.tokens))   return data.tokens;
    return [];
  } catch {
    return [];
  }
}

/** Adresse owner actuelle d'un Normie sur mainnet. */
export async function getNormieOwner(tokenId: number): Promise<string> {
  const data = await fetchApi<{ owner: string }>(`/normie/${tokenId}/owner`);
  return data.owner;
}

// ─── Normie data ──────────────────────────────────────────────────────────────

/** Metadata NFT complète (name, image, attributes). */
export async function getNormieMetadata(tokenId: number): Promise<NormieMetadata> {
  return fetchApi<NormieMetadata>(`/normie/${tokenId}/metadata`);
}

/** Traits décodés (plus détaillés que les attributs metadata). */
export async function getNormieTraits(tokenId: number): Promise<NormieTrait[]> {
  const data = await fetchApi<NormieTrait[] | { traits: NormieTrait[] }>(
    `/normie/${tokenId}/traits`
  );
  return Array.isArray(data) ? data : data.traits ?? [];
}

/** Infos canvas : level et action points. */
export async function getCanvasInfo(tokenId: number): Promise<CanvasInfo> {
  return fetchApi<CanvasInfo>(`/normie/${tokenId}/canvas/info`);
}

// ─── Agent (ERC-8004) ────────────────────────────────────────────────────────

/** Identité agentique riche : persona, archétype, binding. */
export async function getAgentInfo(tokenId: number): Promise<AgentInfo> {
  return fetchApi<AgentInfo>(`/agents/info/${tokenId}`);
}

/** Metadata ERC-8004 complète. */
export async function getAgentMetadata(tokenId: number): Promise<Record<string, unknown>> {
  return fetchApi(`/agents/metadata/${tokenId}`);
}

/** Binding agent↔wallet. */
export async function getAgentBinding(tokenId: number): Promise<string | null> {
  try {
    const data = await fetchApi<{ binding: string | null }>(`/agents/binding/${tokenId}`);
    return data.binding ?? null;
  } catch {
    return null;
  }
}

/** Liste paginée des agents enregistrés. */
export async function getAgentList(): Promise<Record<string, unknown>[]> {
  const data = await fetchApi<
    Record<string, unknown>[] | { agents: Record<string, unknown>[] }
  >("/agents/list");
  return Array.isArray(data) ? data : data.agents ?? [];
}

// ─── Composite: carte membre ──────────────────────────────────────────────────

/**
 * Données complètes pour afficher une carte Normie membre.
 * Combine metadata + infos agent. Tolère les erreurs partielles.
 */
export async function getNormieMemberCard(tokenId: number) {
  const [metadata, agentInfo] = await Promise.all([
    getNormieMetadata(tokenId).catch(() => null),
    getAgentInfo(tokenId).catch(() => null),
  ]);
  return {
    tokenId,
    imageUrl: getNormieImageUrl(tokenId),
    metadata,
    agentInfo,
  };
}

/**
 * Seed pour le moteur génératif : traits + level + actionPoints.
 */
export async function getGenerativeSeed(tokenId: number) {
  const [metadata, canvas] = await Promise.all([
    getNormieMetadata(tokenId),
    getCanvasInfo(tokenId).catch(() => ({ level: 1, actionPoints: 0 })),
  ]);
  return {
    tokenId,
    traits:       metadata.attributes,
    name:         metadata.name,
    imageUrl:     getNormieImageUrl(tokenId),
    level:        canvas.level,
    actionPoints: canvas.actionPoints,
  };
}
