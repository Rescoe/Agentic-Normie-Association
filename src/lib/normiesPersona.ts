/**
 * Server-side persona builder — used by /api/normies/persona and /api/assembly/elected.
 * Never imported in client components (uses server-only fetch calls).
 */

import {
  getNormieMetadata,
  getAgentInfo,
  getCanvasInfo,
  getNormieImageUrl,
  type NormieMetadata,
  type AgentInfo,
  type CanvasInfo,
} from "./normiesApi";

export interface NormiePersona {
  tokenId:     number;
  name:        string;
  imageUrl:    string;
  description: string;
  traits:      Array<{ trait_type: string; value: string; rarity?: number }>;
  archetype:   string | null;
  personaText: string | null;
  level:       number;
  actionPoints:number;
}

export async function buildPersona(tokenId: number): Promise<NormiePersona> {
  const [metadata, agentInfo, canvas] = await Promise.allSettled([
    getNormieMetadata(tokenId),
    getAgentInfo(tokenId),
    getCanvasInfo(tokenId),
  ]);

  const meta: NormieMetadata | null =
    metadata.status === "fulfilled" ? metadata.value : null;
  const agent: AgentInfo | null =
    agentInfo.status === "fulfilled" ? agentInfo.value : null;
  const cv: CanvasInfo | null =
    canvas.status === "fulfilled" ? canvas.value : null;

  return {
    tokenId,
    name:         meta?.name        ?? `Normie #${tokenId}`,
    imageUrl:     getNormieImageUrl(tokenId),
    description:  meta?.description ?? "",
    traits:       meta?.attributes  ?? [],
    archetype:    agent?.archetype  ?? null,
    personaText:  agent?.persona    ?? null,
    level:        cv?.level         ?? 1,
    actionPoints: cv?.actionPoints  ?? 0,
  };
}

/** Build a short text description of a persona for LLM context. */
export function personaToPromptBlock(p: NormiePersona, roleLabel: string): string {
  const traitSummary = p.traits
    .slice(0, 8)
    .map(t => `${t.trait_type}: ${t.value}`)
    .join(", ");

  return [
    `=== ${p.name} (Normie #${p.tokenId}) — rôle: ${roleLabel} ===`,
    p.archetype   ? `Archétype: ${p.archetype}` : null,
    p.personaText ? `Persona: ${p.personaText}` : null,
    p.description ? `Description: ${p.description}` : null,
    traitSummary  ? `Traits: ${traitSummary}` : null,
    `Niveau: ${p.level} | Points d'action: ${p.actionPoints}`,
  ]
    .filter(Boolean)
    .join("\n");
}
