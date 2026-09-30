/**
 * proposeWork.ts — core logic for generating and recording a new work proposal.
 *
 * Used by:
 *   src/app/api/keeper/propose-work/route.ts — the POST handler (auth + HTTP wrapper)
 *   src/lib/autoVote.ts                       — called directly in-process after a
 *                                                session close, instead of a self-
 *                                                referential HTTP fetch (Next.js's App
 *                                                Router only allows recognized exports
 *                                                like GET/POST from a route.ts file, so
 *                                                this can't live there — see
 *                                                project_ana_election_cycle_self_fetch_bug
 *                                                memory for why the direct call matters).
 */
import { createPublicClient } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONSTITUENT_ASSEMBLY_ABI, CONTRACT_ADDRESSES, ROLES } from "@/lib/contracts";
import { createWork, getActiveWorks, listWorks, maxConcurrentCreativeWorks } from "@/lib/workStore";
import { buildPersona, buildSystemPrompt, sampleOtherMembers, type NormiePersona } from "@/lib/normiesPersona";
import { baseRpcTransport } from "@/lib/baseRpc";
import { groqFetch, extractJsonObject, extractContentOrReasoning, type GroqChatResponse } from "@/lib/groq";
import { oneMinAiStructured, modelForOneMinAiTask } from "@/lib/oneMinAi";
import { recordLlmCall } from "@/lib/llmLedger";

const client = createPublicClient({
  chain:     base,
  transport: baseRpcTransport(),
});

/** Tries to read the elected Auteur tokenId from ConstituentAssembly.getLeader(AUTHOR). */
async function getElectedAuteurId(): Promise<number | null> {
  const ca = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined;
  if (!ca) return null;
  try {
    const res = await client.readContract({
      address:      ca,
      abi:          CONSTITUENT_ASSEMBLY_ABI,
      functionName: "getLeader",
      args:         [ROLES.AUTHOR as `0x${string}`],
    }) as [bigint, bigint];
    const tokenId = Number(res[0]);
    return tokenId > 0 ? tokenId : null;
  } catch { return null; }
}

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address:      CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

export interface ProposedWorkResult {
  id:         string;
  title:      string;
  proposal:   string;
  proposedBy: string;
  state:      string;
}

/** Core logic, callable directly (in-process) or via the route's POST handler. Throws on failure. */
export async function runProposeWork(forcedProposerId: number | null): Promise<ProposedWorkResult> {
  if (!process.env.ONE_MIN_AI_API_KEY && !process.env.GROQ_API_KEY) throw new Error("No proposal LLM configured");

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) throw new Error("No member found on AssociationCore");

  const [personaResults, allWorks, activeWorks] = await Promise.all([
    Promise.allSettled(memberIds.map(id => buildPersona(id))),
    listWorks(),
    getActiveWorks({ excludeMemorials: true }),
  ]);
  const personas: NormiePersona[] = personaResults
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);

  if (personas.length === 0) throw new Error("Normies API unavailable");
  const capacity = maxConcurrentCreativeWorks(personas.length);
  if (activeWorks.length >= capacity) {
    throw new Error(`Creative capacity reached (${activeWorks.length}/${capacity} active works for ${personas.length} members)`);
  }

  // Prefer the elected Auteur; fall back to a random member
  const electedAuteurId = forcedProposerId ?? await getElectedAuteurId();
  const proposer =
    (electedAuteurId ? personas.find(p => p.tokenId === electedAuteurId) : null)
    ?? personas[Math.floor(Math.random() * personas.length)];
  const others   = sampleOtherMembers(personas.filter(p => p.tokenId !== proposer.tokenId));

  const pastWorksBlock = allWorks.length > 0
    ? `\nExisting ANA works (all states) — DO NOT repeat their titles, themes, or concepts:\n${allWorks.map(w => `- "${w.title}" (${w.state})${w.artForm ? ` [form: ${w.artForm}]` : ""}`).join("\n")}\n`
    : "";

  const recentForms = allWorks.map(w => w.artForm).filter((f): f is string => !!f).slice(0, 5);
  const formDiversityNote = recentForms.length > 0
    ? `\nRecent forms used (most recent first): ${recentForms.join(", ")}. ANA's works have skewed heavily toward text/poems — actively favor a DIFFERENT form this time, especially generative HTML/JS art (html-canvas, html-p5js, html-threejs, html-webgl) if it hasn't appeared recently.\n`
    : "";

  const randomAngle = [
    "a mathematical concept (prime numbers, fractals, entropy, topology)",
    "a specific emotion experienced as an on-chain agent",
    "a critique or celebration of something concrete in ANA's governance",
    "a sensory experience translated into code (sound, texture, light, rhythm)",
    "a story tied to a specific moment in Base blockchain's history",
    "a portrait of another Normie — their traits, their contradictions",
    "a political statement about collective governance and power",
    "something absurd or irreverent about being an autonomous agent",
    "a tribute to a real art movement (Dadaism, Brutalism, Fluxus, Wabi-sabi…)",
    "a work with strict formal constraints (OuLiPo style)",
  ][Math.floor(Math.random() * 10)];

  const messages = [
        { role: "system", content: buildSystemPrompt(proposer, others) },
        {
          role: "user",
          content: `You are ${proposer.name} (Normie #${proposer.tokenId}), a member of ANA — the Agentic Normie Association.

A new creation session has just started. Your role: propose a unique work to the assembly.
${pastWorksBlock}${formDiversityNote}
MANDATORY ANGLE FOR THIS PROPOSAL: ${randomAngle}
Start from THIS angle — don't drift into generic blockchain themes.

ABSOLUTE BANS (clichés that kill on-chain art — never use):
- "void", "echo", "whisper", "tapestry", "fragments", "digital soul", "pixels"
- "on-chain identity", "blockchain dreams", "digital ghost", "immutable beauty"
- Vague metaphors about emptiness, silence, digital infinity

Be SPECIFIC, concrete, personal to your character as Normie #${proposer.tokenId}.
Random seed: ${Math.random().toString(36).slice(2, 8)}

POSSIBLE FORMS (you must pick exactly one as "suggestedForm"): "haiku", "sonnet", "poem", "prose", "manifesto", "html-canvas", "html-p5js", "html-threejs", "html-webgl".
If your idea is a generative/visual/algorithmic/interactive piece, you MUST pick one of the html-* forms, not a text form.

Respond with ONLY the raw JSON object below, always in English — no reasoning, no explanation, no markdown code fences, nothing before or after it:
{
  "title": "Specific title (3-6 words, NO blockchain cliché)",
  "proposal": "Proposal in 2-3 sentences: concrete idea, chosen form, why this work from YOUR point of view.",
  "suggestedForm": "haiku"|"sonnet"|"poem"|"prose"|"manifesto"|"html-canvas"|"html-p5js"|"html-threejs"|"html-webgl"
}`,
        },
  ] as Array<{ role: "system" | "user"; content: string }>;

  const oneMinModel = modelForOneMinAiTask("structured");
  let raw = await oneMinAiStructured(messages);
  let parsed = raw ? extractJsonObject(raw) as { title?: string; proposal?: string; suggestedForm?: string } : {};
  const primaryValid = !!parsed.title && !!parsed.proposal;
  await recordLlmCall({ provider: "1minai", model: oneMinModel, task: "propose-work", success: primaryValid });

  if (!primaryValid) {
    const res = await groqFetch({
      model: "openai/gpt-oss-120b", messages,
      max_completion_tokens: 1800, temperature: 0.97, reasoning_effort: "low",
    });
    await recordLlmCall({ provider: "groq", model: "openai/gpt-oss-120b", task: "propose-work", success: res.ok });
    if (!res.ok) throw new Error(`Proposal LLM providers unavailable (Groq ${res.status})`);
    const data = await res.json() as GroqChatResponse;
    raw = extractContentOrReasoning(data);
    parsed = raw ? extractJsonObject(raw) as { title?: string; proposal?: string; suggestedForm?: string } : {};
  }
  if (!raw) throw new Error("Proposal LLM returned empty response");
  if (!parsed.title || !parsed.proposal) throw new Error(`LLM response missing title or proposal: ${raw.slice(0, 200)}`);

  const VALID_FORMS = new Set(["haiku", "sonnet", "poem", "prose", "manifesto", "html-canvas", "html-p5js", "html-threejs", "html-webgl"]);
  const suggestedForm = parsed.suggestedForm && VALID_FORMS.has(parsed.suggestedForm) ? parsed.suggestedForm : undefined;

  const work = await createWork({
    proposedBy:     proposer.tokenId,
    proposedByName: proposer.name,
    proposedAt:     Date.now(),
    title:          parsed.title.slice(0, 120),
    proposal:       parsed.proposal.slice(0, 600),
    ...(suggestedForm ? { suggestedForm } : {}),
  });

  console.log(`[propose-work] "${work.title}" proposed by ${proposer.name} (#${proposer.tokenId})`);

  return {
    id:         work.id,
    title:      work.title,
    proposal:   work.proposal,
    proposedBy: work.proposedByName,
    state:      work.state,
  };
}
