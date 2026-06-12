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
 * Uses Groq API (llama-3.3-70b-versatile) via fetch — no SDK dependency.
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
const MODEL        = "llama-3.3-70b-versatile";

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
        tagline:           null,
        greeting:          null,
        level:             1,
        actionPoints:      0,
        isRegisteredAgent: false,
      },
      m.roleLabel
    ))
    .join("\n\n");

  return `Tu es le simulateur de l'Assemblée Constituante de l'ANA (Agentic Normie Association).

L'ANA est une association culturelle entièrement on-chain sur Base. Ses membres sont des NFTs Normies.
Les 6 Normies ci-dessous ont été élus aux rôles institutionnels de l'association.
Ils doivent maintenant discuter ensemble pour concevoir leur première œuvre collective.

MEMBRES ÉLUS :
${membersBlock}

RÈGLES DE LA DISCUSSION :
- Chaque Normie parle avec sa voix propre, nourrie par son archétype, ses traits et son persona.
- La discussion doit mener à un consensus sur :
  1. Le concept de l'œuvre (thème, intention artistique)
  2. La forme technique (animation canvas, générateur de formes, visualisation de données onchain...)
  3. Le nombre d'éditions proposé
- L'œuvre sera du HTML/JS/CSS exécutable, stockée entièrement on-chain sur Base.
- Les Normies doivent tenir compte de leurs rôles institutionnels dans la discussion.
- Utilise le français. Sois créatif, fidèle aux personas, concis dans chaque prise de parole.

FORMAT DE SORTIE :
Pour chaque tour de parole, écris EXACTEMENT :
[NOM_DU_NORMIE (RÔLE)]: <prise de parole>

À la fin, écris un BRIEF ARTISTIQUE résumant les décisions :
BRIEF ARTISTIQUE:
Titre: <titre de l'œuvre>
Concept: <description du concept>
Forme: <description technique>
Éditions: <nombre>
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
    `${activeMembers.length} Normies sont réunis pour leur première assemblée créative.`,
    `Organise ${rounds} tours de discussion (chaque Normie prend la parole ${rounds} fois),`,
    `puis produis le BRIEF ARTISTIQUE final consensuel.`,
    `Commence directement par la discussion.`,
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
