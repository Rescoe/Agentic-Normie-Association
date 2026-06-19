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

const SYSTEM_PROMPT = `Tu es un développeur génératif expert. Tu crées des programmes HTML/JS/CSS auto-contenus
qui s'exécutent dans un iframe sandbox (allow-scripts uniquement, pas de réseau, pas de DOM parent).

RÈGLES ABSOLUES :
- Retourne UNIQUEMENT le code HTML, sans markdown, sans balises de code, sans explication
- Le fichier doit être un HTML complet et valide (<!DOCTYPE html> ... </html>)
- Tout le CSS et le JS doit être inline (pas de CDN, pas d'import, pas de fetch)
- Utilise <canvas> pour les visuels génératifs (requestAnimationFrame pour l'animation)
- Palette sombre par défaut (background #0A0A0A, couleurs saturées mais fines)
- Police monospace pour tout texte
- Le programme doit être autonome, infini, et beau
- Taille max : ~15 KB de code (pas de bibliothèques volumineuses)
- Commence directement par <!DOCTYPE html>`;

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
        return `- ${m.roleLabel} : Normie #${m.tokenId}${arch ? ` (${arch})` : ""}${traits ? ` [${traits}]` : ""}`;
      }).join("\n")
    : "";

  const userPrompt = `BRIEF ARTISTIQUE DE L'ASSEMBLÉE :
${brief}

${normieContext ? `NORMIES CRÉATEURS :\n${normieContext}\n` : ""}

Génère un programme HTML/JS génératif qui incarne ce brief.
Le programme doit être visuel, animé, et refléter l'identité collective de ces Normies.
Code HTML complet, autonomous, auto-contenu. Commence par <!DOCTYPE html>.`;

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
