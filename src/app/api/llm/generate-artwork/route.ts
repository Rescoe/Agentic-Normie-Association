/**
 * POST /api/llm/generate-artwork
 *
 * Takes an artistic brief produced by the Normie discussion and generates
 * a complete self-contained HTML/JS/CSS generative artwork.
 *
 * Body: { brief: string, elected: ElectedMember[] }
 *
 * Returns: { html: string } — ready to paste into WorkRegistry.publish()
 */

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import type { NormiePersona } from "@/lib/normiesPersona";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "meta-llama/llama-4-scout-17b-16e-instruct";

interface ElectedMember {
  roleLabel: string;
  tokenId:   number;
  persona:   NormiePersona | null;
}

const SYSTEM_PROMPT = `You are an expert generative developer. You write self-contained HTML/JS/CSS programs
that run inside a sandboxed iframe (allow-scripts only, no network, no parent DOM).

ABSOLUTE RULES:
- Always write in English for any visible text in the artwork.
- Return ONLY the HTML code — no markdown, no code fences, no explanation
- The file must be a complete, valid HTML document (<!DOCTYPE html> ... </html>)
- All CSS and JS must be inline (no CDN, no import, no fetch)
- Use <canvas> for generative visuals (requestAnimationFrame for animation)
- Dark palette by default (background #0A0A0A, saturated but restrained colors)
- Monospace font for any text
- The program must be self-contained, endless, and beautiful
- Max size: ~15 KB of code (no heavy libraries)
- Start directly with <!DOCTYPE html>`;

export async function POST(req: NextRequest) {
  let body: { brief?: string; elected?: ElectedMember[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { brief, elected = [] } = body;
  if (!brief?.trim()) {
    return NextResponse.json({ error: "brief is required" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  // Build context about the elected Normies
  const normieContext = elected.length > 0
    ? elected.map(m => {
        const traits = m.persona?.traits?.slice(0, 3).map(t => `${t.trait_type}:${t.value}`).join(", ") ?? "";
        const arch   = m.persona?.archetype ?? "";
        return `- ${m.roleLabel}: Normie #${m.tokenId}${arch ? ` (${arch})` : ""}${traits ? ` [${traits}]` : ""}`;
      }).join("\n")
    : "";

  const userPrompt = `ASSEMBLY'S ARTISTIC BRIEF:
${brief}

${normieContext ? `CREATING NORMIES:\n${normieContext}\n` : ""}

Generate a generative HTML/JS program that embodies this brief.
The program must be visual, animated, and reflect the collective identity of these Normies.
Complete, self-contained, standalone HTML code. Start with <!DOCTYPE html>.`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model:       MODEL,
        messages:    [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt },
        ],
        max_tokens:  4096,
        temperature: 0.85,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Groq ${res.status}: ${err}` }, { status: 502 });
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    let html = data.choices[0]?.message?.content?.trim() ?? "";

    // Strip any accidental markdown code fences
    html = html
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/,      "")
      .replace(/\s*```$/,      "")
      .trim();

    if (!html.toLowerCase().includes("<!doctype") && !html.toLowerCase().includes("<html")) {
      return NextResponse.json({
        error: "LLM did not return valid HTML",
        raw:   html.slice(0, 300),
      }, { status: 502 });
    }

    return NextResponse.json({ html });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "Unexpected error",
    }, { status: 500 });
  }
}
