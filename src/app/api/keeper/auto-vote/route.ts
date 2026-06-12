/**
 * POST /api/keeper/auto-vote
 *
 * Simulates or executes automatic votes for all registered Normies.
 * Each Normie's LLM agent decides who to vote for based on personas.
 *
 * Request body:
 *   {
 *     mode: "simulate" | "execute"
 *     sessionId?: number   // ignored if simulate
 *   }
 *
 * In "simulate" mode: returns the LLM-decided votes without submitting anything.
 * In "execute" mode:  submits the votes on-chain using the relayer wallet.
 *                     Requires RELAYER_PRIVATE_KEY in env.
 *                     Each vote uses the member's registered holder address —
 *                     the relayer signs a VoteAttestation (same EIP-712 pattern as registration).
 *
 * NOTE: For auto-vote execution to work, the ConstituentAssembly contract must have
 * a castVoteRelayed() function (planned for next contract update). Until then,
 * only "simulate" mode is fully functional.
 *
 * This endpoint is called by the keeper/cron when a session opens, or manually
 * from /admin for testing.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES, ROLES, ROLE_LABELS } from "@/lib/contracts";
import { buildPersona, personaToPromptBlock, type NormiePersona } from "@/lib/normiesPersona";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "llama-3.3-70b-versatile";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

const CORE = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000";

interface VoteDecision {
  voterTokenId:     number;
  voterName:        string;
  role:             string;
  roleLabel:        string;
  candidateTokenId: number;
  candidateName:    string;
  reasoning:        string;
}

async function getMemberTokenIds(): Promise<number[]> {
  const raw = await client.readContract({
    address: CORE, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberTokenIds",
  });
  return (raw as bigint[]).map(Number);
}

async function buildVotePrompt(
  voter: NormiePersona,
  roleLabel: string,
  candidates: NormiePersona[]
): Promise<string> {
  const candidateBlocks = candidates
    .filter(c => c.tokenId !== voter.tokenId)
    .map(c => personaToPromptBlock(c, "Candidat"))
    .join("\n\n");

  return `Tu es ${voter.name} (Normie #${voter.tokenId}).
${voter.personaText ? `Ton persona : ${voter.personaText}` : ""}
${voter.archetype ? `Ton archétype : ${voter.archetype}` : ""}
Traits : ${voter.traits.slice(0, 5).map(t => `${t.trait_type}: ${t.value}`).join(", ")}

Tu dois voter pour le rôle de ${roleLabel} parmi ces candidats :

${candidateBlocks}

Réponds UNIQUEMENT avec le tokenId du candidat que tu choisis et une phrase d'explication.
Format exact: VOTE: <tokenId> | RAISON: <explication courte>`;
}

async function callGroqSimple(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

function parseVoteResponse(text: string, candidates: NormiePersona[]): { tokenId: number; reasoning: string } | null {
  const match = text.match(/VOTE:\s*(\d+)/i);
  const reasonMatch = text.match(/RAISON:\s*(.+)/i);
  if (!match) return null;
  const tokenId = parseInt(match[1], 10);
  if (!candidates.find(c => c.tokenId === tokenId)) return null;
  return { tokenId, reasoning: reasonMatch?.[1]?.trim() ?? "" };
}

export async function POST(req: NextRequest) {
  let body: { mode?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const mode = body.mode ?? "simulate";
  if (mode !== "simulate" && mode !== "execute") {
    return NextResponse.json({ error: "mode must be simulate or execute" }, { status: 400 });
  }

  if (!CORE) return NextResponse.json({ error: "AssociationCore not configured" }, { status: 500 });

  // 1. Get all member token IDs
  let memberIds: number[];
  try { memberIds = await getMemberTokenIds(); }
  catch (e) { return NextResponse.json({ error: `Chain read failed: ${e}` }, { status: 503 }); }

  if (memberIds.length === 0) {
    return NextResponse.json({ votes: [], message: "No registered members" });
  }

  // 2. Build personas for all members
  const personas = await Promise.all(memberIds.map(id => buildPersona(id).catch(() => null)));
  const validPersonas = personas.filter((p): p is NormiePersona => p !== null);

  // 3. For each role × each member, decide vote via LLM
  const roleEntries = Object.entries(ROLES) as [string, `0x${string}`][];
  const decisions: VoteDecision[] = [];

  for (const [roleName, roleHash] of roleEntries) {
    const roleLabel = ROLE_LABELS[roleHash] ?? roleName;

    for (const voter of validPersonas) {
      const candidates = validPersonas; // all members are candidates
      try {
        const prompt   = await buildVotePrompt(voter, roleLabel, candidates);
        const response = await callGroqSimple(prompt);
        const parsed   = parseVoteResponse(response, candidates);

        if (parsed) {
          const candidate = validPersonas.find(p => p.tokenId === parsed.tokenId);
          decisions.push({
            voterTokenId:     voter.tokenId,
            voterName:        voter.name,
            role:             roleHash,
            roleLabel,
            candidateTokenId: parsed.tokenId,
            candidateName:    candidate?.name ?? `#${parsed.tokenId}`,
            reasoning:        parsed.reasoning,
          });
        }
      } catch {
        // Skip on LLM error for this voter/role pair
      }
    }
  }

  if (mode === "simulate") {
    return NextResponse.json({
      mode: "simulate",
      memberCount:   memberIds.length,
      roleCount:     roleEntries.length,
      decisionCount: decisions.length,
      decisions,
      note: "Simulation only — no transactions submitted. Set mode=execute to submit votes (requires castVoteRelayed contract update).",
    });
  }

  // mode === "execute" — not yet available without castVoteRelayed
  return NextResponse.json({
    mode: "execute",
    error: "Execute mode requires castVoteRelayed() in ConstituentAssembly (planned for next contract update). Use mode=simulate.",
    decisions,
  }, { status: 501 });
}
