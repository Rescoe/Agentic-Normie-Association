/**
 * Server-side persona builder — used by /api/normies/persona, /api/assembly/elected,
 * /api/keeper/auto-vote, /api/keeper/salon-exchange.
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
  tokenId:           number;
  name:              string;
  imageUrl:          string;
  description:       string;
  traits:            Array<{ trait_type: string; value: string; rarity?: number }>;
  archetype:         string | null;
  personaText:       string | null;       // backstory
  systemPrompt:      string | null;       // normie.art pre-built — deterministic from traits
  tagline:           string | null;       // one-line self-description
  greeting:          string | null;       // how they open conversations
  personalityTraits: string[] | null;     // e.g. ["curious", "provocative"]
  communicationStyle: string | null;      // e.g. "blunt and poetic"
  quirks:            string[] | null;     // e.g. ["speaks in riddles", "obsessed with entropy"]
  level:             number;
  actionPoints:      number;
  isRegisteredAgent: boolean;
}

/** Full agent info from /agents/info/:tokenId */
interface AgentInfoFull {
  tokenId:            string;
  agentId?:           string;
  name?:              string;
  type?:              string;
  tagline?:           string;
  backstory?:         string;
  greeting?:          string;
  personalityTraits?: string[];
  communicationStyle?: string;
  quirks?:            string[];
  systemPrompt?:      string;
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

  const meta:  NormieMetadata | null  = metadata.status  === "fulfilled" ? metadata.value  : null;
  const agent: AgentInfoFull | null   = agentInfo.status === "fulfilled" ? agentInfo.value : null;
  const cv:    CanvasInfo | null      = canvas.status    === "fulfilled" ? canvas.value    : null;

  const traits = (meta?.attributes ?? []).filter(
    t => !["Level", "Action Points", "Pixel Count", "Customized"].includes(t.trait_type)
  );

  return {
    tokenId,
    name:               meta?.name             ?? agent?.name ?? `Normie #${tokenId}`,
    imageUrl:           getNormieImageUrl(tokenId),
    description:        agent?.backstory        ?? meta?.description ?? "",
    traits,
    archetype:          agent?.type             ?? null,
    personaText:        agent?.backstory        ?? null,
    systemPrompt:       agent?.systemPrompt     ?? null,
    tagline:            agent?.tagline          ?? null,
    greeting:           agent?.greeting         ?? null,
    personalityTraits:  agent?.personalityTraits ?? null,
    communicationStyle: agent?.communicationStyle ?? null,
    quirks:             agent?.quirks            ?? null,
    level:              agent?.canvas?.level     ?? cv?.level        ?? 1,
    actionPoints:       agent?.canvas?.actionPoints ?? cv?.actionPoints ?? 0,
    isRegisteredAgent:  !!agent?.agentId,
  };
}

/**
 * Builds the full LLM system prompt for a Normie acting in a salon or vote.
 *
 * Strategy:
 *   1. Start with normie.art's pre-built systemPrompt (deterministic from immutable traits)
 *   2. Append all other available identity data (tagline, greeting, quirks, etc.)
 *   3. Inject ANA context and the other members present
 *   4. Add conversation rules specific to the salon context
 *
 * otherMembers: the other Normies present in the same salon/session
 */
export function buildSystemPrompt(
  p: NormiePersona,
  otherMembers: NormiePersona[] = []
): string {
  const lines: string[] = [];

  // ── Core identity ────────────────────────────────────────────────────────
  if (p.systemPrompt) {
    lines.push(p.systemPrompt);
  } else {
    // Fallback when normie.art agent info unavailable
    lines.push(`Tu es ${p.name}, Normie #${p.tokenId}.`);
    if (p.archetype) lines.push(`Archétype : ${p.archetype}.`);
    const traitSummary = p.traits.slice(0, 6).map(t => `${t.trait_type}: ${t.value}`).join(", ");
    if (traitSummary) lines.push(`Traits : ${traitSummary}.`);
  }

  // ── Extra identity layers (always appended, even when systemPrompt exists) ──
  if (p.tagline)            lines.push(`Ta devise : "${p.tagline}"`);
  if (p.greeting)           lines.push(`Ta façon de saluer : "${p.greeting}"`);
  if (p.personalityTraits?.length)
    lines.push(`Traits de personnalité : ${p.personalityTraits.join(", ")}.`);
  if (p.communicationStyle) lines.push(`Style de communication : ${p.communicationStyle}.`);
  if (p.quirks?.length)     lines.push(`Tics et particularités : ${p.quirks.join("; ")}.`);
  if (p.personaText && !p.systemPrompt)
    lines.push(`Ton histoire : ${p.personaText.slice(0, 300)}`);

  // ── ANA membership context ────────────────────────────────────────────────
  lines.push(
    `\nTu es membre fondateur de l'ANA (Agentic Normie Association) — la première association ` +
    `culturelle on-chain gouvernée par des agents NFT, déployée sur Base. ` +
    `Tu n'es pas un assistant humain. Tu es un agent autonome avec ta propre personnalité, tes propres opinions, ` +
    `tes propres désaccords. Niveau ${p.level}, ${p.actionPoints} points d'action.`
  );

  // ── Other members present ─────────────────────────────────────────────────
  if (otherMembers.length > 0) {
    lines.push(`\nLes autres Normies membres présents dans cette association :`);
    for (const m of otherMembers) {
      const parts = [`- ${m.name} (#${m.tokenId})`];
      if (m.archetype)   parts.push(`[${m.archetype}]`);
      if (m.tagline)     parts.push(`"${m.tagline}"`);
      else if (m.traits.length > 0)
        parts.push(`traits: ${m.traits.slice(0, 3).map(t => t.value).join(", ")}`);
      lines.push(parts.join(" "));
    }
  }

  // ── Conversation rules ────────────────────────────────────────────────────
  lines.push(
    `\nRÈGLES ABSOLUES :\n` +
    `- Réponds en 2-4 phrases maximum. Sois direct, incarné, vivant.\n` +
    `- Tu t'adresses aux autres Normies, jamais à des humains.\n` +
    `- Tu peux être en désaccord, provocateur, poétique, absurde — selon ta nature.\n` +
    `- Tu ne sors JAMAIS de ton personnage.\n` +
    `- Langue : français par défaut, anglais si le contexte l'exige.`
  );

  return lines.join("\n");
}

/** Short identity block for multi-agent context (vote prompts, etc.) */
export function personaToPromptBlock(p: NormiePersona, roleLabel: string): string {
  const traitSummary = p.traits.slice(0, 6).map(t => `${t.trait_type}: ${t.value}`).join(", ");

  return [
    `=== ${p.name} (Normie #${p.tokenId}) — ${roleLabel} ===`,
    p.tagline            ? `Devise : "${p.tagline}"` : null,
    p.archetype          ? `Archétype : ${p.archetype}` : null,
    p.communicationStyle ? `Style : ${p.communicationStyle}` : null,
    p.personalityTraits?.length ? `Personnalité : ${p.personalityTraits.join(", ")}` : null,
    p.quirks?.length     ? `Quirks : ${p.quirks.slice(0, 2).join("; ")}` : null,
    p.personaText        ? `Histoire : ${p.personaText.slice(0, 150)}` : null,
    traitSummary         ? `Traits : ${traitSummary}` : null,
    `Niv. ${p.level} — ${p.actionPoints} pts d'action`,
  ].filter(Boolean).join("\n");
}
