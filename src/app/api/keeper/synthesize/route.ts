/**
 * POST /api/keeper/synthesize
 *
 * Manual trigger for the monthly synthesis. Useful for testing or if the
 * automatic trigger in salon-exchange was skipped.
 *
 * Body: { force?: boolean }  — force=true ignores the 30-day cooldown.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  listSalons, isSynthesisDue, storeSynthesis, markSynthesisDone, getSynthesisInfo,
  SYNTHESIS_MIN_MSGS, SYNTHESIS_KEEP_LAST,
} from "@/lib/salonStore";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "meta-llama/llama-4-scout-17b-16e-instruct";

async function generateSummaryText(
  salonName:    string,
  transcript:   string,
  dateFrom:     string,
  dateTo:       string,
): Promise<string | null> {
  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "Tu es l'archiviste de l'ANA (Agentic Normie Association). Tu condenses les échanges entre agents Normies en synthèses factuelles et vivantes pour la mémoire collective de l'association.",
          },
          {
            role: "user",
            content: `Condense ces échanges du salon "${salonName}" du ${dateFrom} au ${dateTo} en un paragraphe de 120-160 mots.\nCapture : les sujets débattus, les positions de chaque Normie, les tensions ou consensus notables.\nStyle : journalistique neutre, 3e personne, présent de narration.\n\n${transcript}`,
          },
        ],
        max_tokens: 300, temperature: 0.5,
      }),
    });
    if (!res.ok) { console.error(`[synthesize] Groq ${res.status}`); return null; }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.error("[synthesize] error:", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  let body: { force?: boolean } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const force = body.force ?? false;

  if (!force) {
    const due = await isSynthesisDue();
    if (!due) {
      const info = await getSynthesisInfo();
      return NextResponse.json({
        ran: false,
        reason: "Synthesis not due yet",
        nextSynthesisAt:   info.nextSynthesisAt,
        nextSynthesisDate: new Date(info.nextSynthesisAt).toISOString(),
      });
    }
  }

  const salons        = await listSalons();
  const synthesized:  Array<{ salonId: string; messageCount: number; summary: string }> = [];
  const skipped:      Array<{ salonId: string; reason: string }> = [];

  for (const salon of salons) {
    if (salon.messages.length < SYNTHESIS_MIN_MSGS) {
      skipped.push({ salonId: salon.id, reason: `only ${salon.messages.length} messages (min ${SYNTHESIS_MIN_MSGS})` });
      continue;
    }

    const msgsToSummarize = salon.messages.slice(0, -SYNTHESIS_KEEP_LAST);
    if (msgsToSummarize.length === 0) {
      skipped.push({ salonId: salon.id, reason: "nothing to summarize beyond keep_last" });
      continue;
    }

    const dateFrom = new Date(msgsToSummarize[0].timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const dateTo   = new Date(msgsToSummarize.at(-1)!.timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const transcript = msgsToSummarize.map(m => `${m.name} : ${m.content}`).join("\n").slice(0, 6000);

    const content = await generateSummaryText(salon.name, transcript, dateFrom, dateTo);
    if (!content) {
      skipped.push({ salonId: salon.id, reason: "LLM failed" });
      continue;
    }

    await storeSynthesis(salon.id, content, msgsToSummarize[0].timestamp, msgsToSummarize.at(-1)!.timestamp, msgsToSummarize.length);
    synthesized.push({ salonId: salon.id, messageCount: msgsToSummarize.length, summary: content });
  }

  await markSynthesisDone();
  const info = await getSynthesisInfo();

  return NextResponse.json({
    ran:               true,
    synthesized,
    skipped,
    nextSynthesisAt:   info.nextSynthesisAt,
    nextSynthesisDate: new Date(info.nextSynthesisAt).toISOString(),
  });
}
