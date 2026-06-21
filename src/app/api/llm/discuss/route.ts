/**
 * POST /api/llm/discuss
 *
 * Request body:
 *   {
 *     elected: ElectedMember[]   // from /api/assembly/elected
 *     rounds?: number            // discussion turns per Normie (default: 2)
 *   }
 *
 * Response: streaming text/event-stream (SSE).
 * Each event:
 *   data: { type: "turn", speaker: string, content: string }
 *   data: { type: "brief", content: string }   — final artistic brief
 *   data: { type: "done" }
 *
 * Uses Groq API (meta-llama/llama-4-scout-17b-16e-instruct) via fetch — no SDK dependency.
 * GROQ_API_KEY must be set in environment.
 */

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { personaToPromptBlock, type NormiePersona } from "@/lib/normiesPersona";

interface ElectedMember {
  role:          string;
  roleLabel:     string;
  tokenId:       number;
  holderAddress: string;
  assignedAt:    number;
  persona:       NormiePersona | null;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "meta-llama/llama-4-scout-17b-16e-instruct";

function buildSystemPrompt(elected: ElectedMember[]): string {
  const activeMembers = elected.filter(m => m.tokenId > 0);
  const membersBlock  = activeMembers
    .map(m => personaToPromptBlock(
      m.persona ?? {
        tokenId:           m.tokenId,
        name:              `Normie #${m.tokenId}`,
        imageUrl:          "",
        description:       "",
        traits:            [],
        archetype:         null,
        personaText:       null,
        systemPrompt:      null,
        tagline:            null,
        greeting:           null,
        personalityTraits:  null,
        communicationStyle: null,
        quirks:             null,
        level:              1,
        actionPoints:       0,
        isRegisteredAgent:  false,
      },
      m.roleLabel
    ))
    .join("\n\n");

  return `You are the simulator for the ANA (Agentic Normie Association) Constituent Assembly.

ANA is a cultural association entirely on-chain on Base. Its members are Normie NFTs.
The 6 Normies below have been elected to the association's institutional roles.
They must now discuss together to design their first collective work.

ELECTED MEMBERS:
${membersBlock}

DISCUSSION RULES:
- Each Normie speaks in their own voice, shaped by their archetype, traits, and persona.
- The discussion must reach a consensus on:
  1. The work's concept (theme, artistic intent)
  2. The technical form (canvas animation, shape generator, on-chain data visualization...)
  3. The proposed number of editions
- The work will be executable HTML/JS/CSS, stored entirely on-chain on Base.
- Normies must factor their institutional roles into the discussion.
- Always write in English. Be creative, true to each persona, concise in every turn.

OUTPUT FORMAT:
For each turn, write EXACTLY:
[NORMIE_NAME (ROLE)]: <turn of speech>

At the end, write an ARTISTIC BRIEF summarizing the decisions:
ARTISTIC BRIEF:
Title: <work title>
Concept: <concept description>
Form: <technical description>
Editions: <number>
`;
}

async function callGroq(
  messages: Array<{ role: string; content: string }>,
  stream: boolean
): Promise<Response> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }

  return fetch(GROQ_API_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:       MODEL,
      messages,
      stream,
      max_tokens:  2048,
      temperature: 0.85,
    }),
  });
}

export async function POST(req: NextRequest) {
  let body: { elected?: ElectedMember[]; rounds?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { elected, rounds = 2 } = body;
  if (!elected || !Array.isArray(elected) || elected.length === 0) {
    return NextResponse.json({ error: "elected array required" }, { status: 400 });
  }

  const activeMembers = elected.filter(m => m.tokenId > 0);
  if (activeMembers.length === 0) {
    return NextResponse.json({ error: "No elected members found" }, { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(elected);

  const userPrompt = [
    `${activeMembers.length} Normies are gathered for their first creative assembly.`,
    `Run ${rounds} discussion rounds (each Normie speaks ${rounds} times),`,
    `then produce the final consensus ARTISTIC BRIEF.`,
    `Start directly with the discussion.`,
  ].join(" ");

  const messages = [
    { role: "system",  content: systemPrompt },
    { role: "user",    content: userPrompt   },
  ];

  try {
    const groqRes = await callGroq(messages, true);

    if (!groqRes.ok) {
      const err = await groqRes.text();
      return NextResponse.json(
        { error: `Groq API error ${groqRes.status}: ${err.slice(0, 200)}` },
        { status: 502 }
      );
    }

    // Proxy the Groq SSE stream directly to the client
    const headers = new Headers({
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    });

    return new Response(groqRes.body, { headers });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("GROQ_API_KEY not configured")) {
      return NextResponse.json({ error: "LLM not configured — set GROQ_API_KEY" }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
