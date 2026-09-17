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
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONSTITUENT_ASSEMBLY_ABI, CONTRACT_ADDRESSES, ROLES } from "@/lib/contracts";
import { createWork, listWorks } from "@/lib/workStore";
import { buildPersona, buildSystemPrompt, sampleOtherMembers, type NormiePersona } from "@/lib/normiesPersona";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
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
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not configured");

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) throw new Error("No member found on AssociationCore");

  const [personaResults, allWorks] = await Promise.all([
    Promise.allSettled(memberIds.map(id => buildPersona(id))),
    listWorks(),
  ]);
  const personas: NormiePersona[] = personaResults
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);

  if (personas.length === 0) throw new Error("Normies API unavailable");

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

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:           "openai/gpt-oss-120b",
      max_tokens:      350,
      temperature:     0.97,
      response_format: { type: "json_object" },
      messages: [
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

Respond ONLY in JSON, always in English:
{
  "title": "Specific title (3-6 words, NO blockchain cliché)",
  "proposal": "Proposal in 2-3 sentences: concrete idea, chosen form, why this work from YOUR point of view.",
  "suggestedForm": "haiku"|"sonnet"|"poem"|"prose"|"manifesto"|"html-canvas"|"html-p5js"|"html-threejs"|"html-webgl"
}`,
        },
      ],
    }),
  }).catch(() => null);

  if (!res?.ok) throw new Error("Groq API error");

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const raw  = data.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("LLM returned empty response");

  let parsed: { title?: string; proposal?: string; suggestedForm?: string };
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`LLM response parse error: ${raw.slice(0, 200)}`); }

  if (!parsed.title || !parsed.proposal) throw new Error("LLM response missing title or proposal");

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
