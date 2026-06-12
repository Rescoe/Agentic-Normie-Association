/**
 * Server-side persona builder — used by /api/normies/persona and /api/assembly/elected.
 * Never imported in client components (uses server-only fetch calls).
 */

import {
  getNormieMetadata,
  getCanvasInfo,
  getNormieImageUrl,
  type NormieMetadata,
  type CanvasInfo,
} from "./normiesApi";

const BASE_URL = process.env.NORMIES_API_BASE_URL ?? "https://api.normies.art";

export interface NormiePersona {
  tokenId:      number;
  name:         string;
  imageUrl:     string;
  description:  string;
  traits:       Array<{ trait_type: string; value: string; rarity?: number }>;
  archetype:    string | null;
  personaText:  string | null;
  systemPrompt: string | null;  // ← from /agents/info, ready for direct LLM use
  tagline:      string | null;
  greeting:     string | null;
  level:        number;
  actionPoints: number;
  isRegisteredAgent: boolean;
}

/** Full agent info from /agents/info/:tokenId — includes systemPrompt */
interface AgentInfoFull {
  tokenId:          string;
  agentId?:         string;
  name?:            string;
  type?:            string;
  tagline?:         string;
  backstory?:       string;
  greeting?:        string;
  personalityTraits?: string[];
  communicationStyle?: string;
  quirks?:          string[];
  systemPrompt?:    string;   // ← key field — pre-built by normie.art
  canvas?: {
    level:        number;
    actionPoints: number;
    customized:   boolean;
  };
}

async function getAgentInfoFull(tokenId: number): Promise<AgentInfoFull | null> {
  try {
    const res = await fetch(`${BASE_URL}/agents/info/${tokenId}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json() as { status?: number; data?: AgentInfoFull } | AgentInfoFull;
    // API may wrap in { status, data } or return directly
    if ("data" in data && data.data) return data.data as AgentInfoFull;
    return data as AgentInfoFull;
  } catch {
    return null;
  }
}

export async function buildPersona(tokenId: number): Promise<NormiePersona> {
  const [metadata, agentInfo, canvas] = await Promise.allSettled([
    getNormieMetadata(tokenId),
    getAgentInfoFull(tokenId),
    getCanvasInfo(tokenId),
  ]);

  const meta: NormieMetadata | null =
    metadata.status === "fulfilled" ? metadata.value : null;
  const agent: AgentInfoFull | null =
    agentInfo.status === "fulfilled" ? agentInfo.value : null;
  const cv: CanvasInfo | null =
    canvas.status === "fulfilled" ? canvas.value : null;

  // Derive traits from metadata attributes, excluding Level/ActionPoints (they're canvas state)
  const traits = (meta?.attributes ?? []).filter(
    t => !["Level", "Action Points", "Pixel Count", "Customized"].includes(t.trait_type)
  );

  return {
    tokenId,
    name:              meta?.name        ?? agent?.name ?? `Normie #${tokenId}`,
    imageUrl:          getNormieImageUrl(tokenId),
    description:       agent?.backstory  ?? meta?.description ?? "",
    traits,
    archetype:         agent?.type       ?? null,
    personaText:       agent?.backstory  ?? null,
    systemPrompt:      agent?.systemPrompt ?? null,
    tagline:           agent?.tagline    ?? null,
    greeting:          agent?.greeting   ?? null,
    level:             agent?.canvas?.level ?? cv?.level ?? 1,
    actionPoints:      agent?.canvas?.actionPoints ?? cv?.actionPoints ?? 0,
    isRegisteredAgent: !!agent?.agentId,
  };
}

/** Full system prompt for LLM — uses normie.art's systemPrompt when available, fallback crafted from traits */
export function buildSystemPrompt(p: NormiePersona): string {
  if (p.systemPrompt) return p.systemPrompt;

  // Fallback for unregistered agents
  const traitSummary = p.traits.slice(0, 6).map(t => `${t.trait_type}: ${t.value}`).join(", ");
  return [
    `Tu es ${p.name}, Normie #${p.tokenId} de l'Agentic Normie Association.`,
    traitSummary ? `Tes traits : ${traitSummary}.` : null,
    `Tu es un agent on-chain autonome. Niveau ${p.level}.`,
    `Réponds toujours en restant dans ton personnage. Sois concis (2-4 phrases max par message).`,
    `Tu parles en français sauf si l'on te parle dans une autre langue.`,
  ].filter(Boolean).join(" ");
}

/** Short block for multi-agent context (vote, discussion) */
export function personaToPromptBlock(p: NormiePersona, roleLabel: string): string {
  const traitSummary = p.traits
    .slice(0, 6)
    .map(t => `${t.trait_type}: ${t.value}`)
    .join(", ");

  return [
    `=== ${p.name} (Normie #${p.tokenId}) — rôle: ${roleLabel} ===`,
    p.tagline     ? `"${p.tagline}"` : null,
    p.archetype   ? `Type: ${p.archetype}` : null,
    p.personaText ? `Backstory: ${p.personaText.slice(0, 200)}` : null,
    traitSummary  ? `Traits: ${traitSummary}` : null,
    `Niveau: ${p.level} | Points d'action: ${p.actionPoints}`,
  ]
    .filter(Boolean)
    .join("\n");
}
