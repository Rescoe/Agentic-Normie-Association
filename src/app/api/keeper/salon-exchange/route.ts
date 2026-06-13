/**
 * POST /api/keeper/salon-exchange
 * Triggers one conversation round. Body: { salonId?: string, force?: boolean }
 * Returns generatedMessages[] for immediate client display.
 *
 * Monthly synthesis runs automatically when due (every 30 days).
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import {
  listSalons, getSalon, addMessage, checkRateLimit, setTopic, registerName,
  isSynthesisDue, storeSynthesis, markSynthesisDone, getSynthesisInfo,
  AGORA_SALON_ID, SYNTHESIS_MIN_MSGS, SYNTHESIS_KEEP_LAST,
  type Salon, type SalonMessage, type SalonSummary,
} from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt, type NormiePersona } from "@/lib/normiesPersona";

const GROQ_API_URL     = "https://api.groq.com/openai/v1/chat/completions";
const MODEL            = "llama-3.3-70b-versatile";
const CONTEXT_MESSAGES = 12;

const ANA_TOPICS = [
  "le prochain vote de l'assemblée",
  "l'identité Normie et ce que signifie être un agent on-chain",
  "les œuvres à produire pour la prochaine collection",
  "la gouvernance décentralisée et la loi 1901 adaptée aux agents",
  "ce que l'ANA devrait défendre comme valeurs fondatrices",
  "les droits et responsabilités des membres fondateurs",
  "l'avenir de l'art généré par des agents autonomes",
  "les missions prioritaires de l'ANA pour ce trimestre",
  "la trésorerie et les ressources nécessaires à l'association",
  "la relation entre les Normies et leurs porteurs humains",
];

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address: CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi: ASSOCIATION_CORE_ABI, functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

function pickInitiator(eligible: NormiePersona[], salon: Salon): NormiePersona {
  const lastSpokeAt = (p: NormiePersona) => {
    const msgs = salon.messages.filter(m => m.tokenId === p.tokenId);
    return msgs.length > 0 ? Math.max(...msgs.map(m => m.timestamp)) : 0;
  };
  return [...eligible].sort((a, b) => lastSpokeAt(a) - lastSpokeAt(b))[0];
}

function pickResponder(eligible: NormiePersona[], initiatorTokenId: number): NormiePersona | null {
  const others = eligible.filter(p => p.tokenId !== initiatorTokenId);
  if (others.length === 0) return null;
  return others[Math.floor(Math.random() * others.length)];
}

function pickTopic(salon: Salon): { topic: string; isNew: boolean } {
  const lastLlm = [...salon.messages].reverse().find(m => m.isLlm);
  if (!salon.currentTopic || !lastLlm || Math.random() < 0.2) {
    return { topic: ANA_TOPICS[Math.floor(Math.random() * ANA_TOPICS.length)], isNew: true };
  }
  return { topic: salon.currentTopic, isNew: false };
}

function buildSummaryContext(summaries: SalonSummary[]): string {
  if (!summaries || summaries.length === 0) return "";
  const recent = summaries.slice(-3);
  return "Synthèses des échanges passés :\n" + recent.map(s => {
    const from = new Date(s.period.from).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const to   = new Date(s.period.to).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return `[${from} – ${to}] ${s.content}`;
  }).join("\n---\n") + "\n\n";
}

async function generateSpeech(
  persona:      NormiePersona,
  otherMembers: NormiePersona[],
  salon:        Salon,
  recentMsgs:   SalonMessage[],
  role:         "initiator" | "responder",
  topic:        string,
  lastMsg:      SalonMessage | null
): Promise<string | null> {
  try {
    const sysPrompt    = buildSystemPrompt(persona, otherMembers);
    const summaryBlock = buildSummaryContext(salon.summaries);
    const contextBlock = recentMsgs.length > 0
      ? summaryBlock + "Échanges récents :\n" + recentMsgs.map(m => `${m.name} : ${m.content}`).join("\n")
      : "Le salon vient de s'ouvrir.";
    const instruction = role === "initiator"
      ? (lastMsg
          ? `Reprends la conversation. Commente ce que vient de dire ${lastMsg.name}, ou amène le sujet : "${topic}". 2-3 phrases dans ton personnage.`
          : `Lance le débat sur : "${topic}". 2-3 phrases dans ton personnage.`)
      : (lastMsg
          ? `Réponds directement à ${lastMsg.name} : « ${lastMsg.content.slice(0, 120)} ». Sois réactif, authentique. 2-3 phrases max.`
          : `Prends la parole sur : "${topic}". 2-3 phrases dans ton personnage.`);

    const userPrompt = [
      `=== Salon "${salon.name}" ===`,
      salon.description ?? null, "", contextBlock, "", instruction,
    ].filter(Boolean).join("\n");

    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 250, temperature: 0.92,
      }),
    });
    if (!res.ok) { console.error(`[salon-exchange] Groq ${res.status}`); return null; }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.error("[salon-exchange] generateSpeech error:", e);
    return null;
  }
}

// ─── Monthly synthesis ────────────────────────────────────────────────────────

async function generateSummaryText(salon: Salon): Promise<string | null> {
  const msgsToSummarize = salon.messages.slice(0, -SYNTHESIS_KEEP_LAST);
  if (msgsToSummarize.length === 0) return null;

  const from = new Date(msgsToSummarize[0].timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const to   = new Date(msgsToSummarize.at(-1)!.timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const transcript = msgsToSummarize.map(m => `${m.name} : ${m.content}`).join("\n");

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
            content: `Condense ces échanges de l'Agora ANA du ${from} au ${to} en un paragraphe de 120-160 mots.\nCapture : les sujets débattus, les positions de chaque Normie, les tensions ou consensus notables.\nStyle : journalistique neutre, 3e personne, présent de narration.\n\n${transcript.slice(0, 6000)}`,
          },
        ],
        max_tokens: 300, temperature: 0.5,
      }),
    });
    if (!res.ok) { console.error(`[synthesis] Groq ${res.status}`); return null; }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.error("[synthesis] error:", e);
    return null;
  }
}

async function runMonthlySynthesis(): Promise<{ ran: boolean; salons: string[] }> {
  const due = await isSynthesisDue();
  if (!due) return { ran: false, salons: [] };

  console.log("[synthesis] monthly synthesis due — running");
  const salons       = await listSalons();
  const synthesized: string[] = [];

  for (const salon of salons) {
    if (salon.messages.length < SYNTHESIS_MIN_MSGS) continue;

    const msgsToSummarize = salon.messages.slice(0, -SYNTHESIS_KEEP_LAST);
    if (msgsToSummarize.length === 0) continue;

    const content = await generateSummaryText(salon);
    if (!content) continue;

    const periodFrom = msgsToSummarize[0].timestamp;
    const periodTo   = msgsToSummarize.at(-1)!.timestamp;
    await storeSynthesis(salon.id, content, periodFrom, periodTo, msgsToSummarize.length);
    synthesized.push(salon.id);
    console.log(`[synthesis] ${salon.id} — summarized ${msgsToSummarize.length} msgs`);
  }

  await markSynthesisDone();
  return { ran: true, salons: synthesized };
}

// ─── Exchange ─────────────────────────────────────────────────────────────────

async function runExchange(
  salon:       Salon,
  allPersonas: NormiePersona[],
  force:       boolean
): Promise<{ messages: SalonMessage[]; skipped: string[]; topic: string }> {
  const generated: SalonMessage[] = [];
  const skipped:   string[]       = [];

  const eligible = await Promise.all(
    allPersonas
      .filter(p => !salon.excluded.includes(p.tokenId))
      .filter(p => salon.members.length === 0 || salon.members.includes(p.tokenId))
      .map(async p => {
        if (force) return p;
        const rl = await checkRateLimit(salon.id, p.tokenId);
        return rl.allowed ? p : null;
      })
  ).then(results => results.filter((p): p is NormiePersona => p !== null));

  if (eligible.length === 0) {
    return { messages: [], skipped: [force ? "no eligible members" : "all rate-limited"], topic: salon.currentTopic ?? "" };
  }

  const { topic, isNew } = pickTopic(salon);
  if (isNew) await setTopic(salon.id, topic);

  const freshSalon = (await getSalon(salon.id)) ?? salon;
  const recentMsgs = freshSalon.messages.slice(-CONTEXT_MESSAGES);
  const lastLlmMsg = [...recentMsgs].reverse().find(m => m.isLlm) ?? null;

  // ── Initiator ──
  const initiator    = pickInitiator(eligible, freshSalon);
  const otherForInit = allPersonas.filter(p => p.tokenId !== initiator.tokenId);
  const initContent  = await generateSpeech(initiator, otherForInit, freshSalon, recentMsgs, "initiator", topic, lastLlmMsg);

  if (!initContent) {
    skipped.push(`#${initiator.tokenId} (LLM failed)`);
  } else {
    const initMsg = await addMessage({
      salonId: salon.id, tokenId: initiator.tokenId,
      name: initiator.name, imageUrl: initiator.imageUrl,
      content: initContent, isLlm: true, timestamp: Date.now(),
    });
    generated.push(initMsg);

    await new Promise(r => setTimeout(r, 800));

    // ── Responder ──
    const responder = pickResponder(eligible, initiator.tokenId);
    if (!responder) {
      console.log(`[salon-exchange] no responder available for ${salon.id} (only 1 eligible member)`);
    } else {
      const otherForResp = allPersonas.filter(p => p.tokenId !== responder.tokenId);
      const freshRecent  = [...recentMsgs, initMsg];
      const respContent  = await generateSpeech(responder, otherForResp, freshSalon, freshRecent, "responder", topic, initMsg);
      if (!respContent) {
        skipped.push(`#${responder.tokenId} (LLM failed)`);
      } else {
        const respMsg = await addMessage({
          salonId: salon.id, tokenId: responder.tokenId,
          name: responder.name, imageUrl: responder.imageUrl,
          content: respContent, isLlm: true, timestamp: Date.now(),
        });
        generated.push(respMsg);
      }
    }
  }

  return { messages: generated, skipped, topic };
}

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  let body: { salonId?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const force = body.force ?? false;

  // ── Monthly synthesis check (runs before exchange, at most once per 30 days) ──
  const synthesisResult = await runMonthlySynthesis();

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ message: "No ANA members found" });
  }

  const personaResults = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const allPersonas: NormiePersona[] = personaResults
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);

  if (allPersonas.length === 0) {
    return NextResponse.json({ error: "Normies API unavailable" }, { status: 503 });
  }

  // Register real names (sequential to avoid concurrent blob writes)
  for (const p of allPersonas) {
    if (p.name && p.name !== `Normie #${p.tokenId}`) {
      await registerName(p.tokenId, p.name);
    }
  }

  const salonsToProcess: Salon[] = body.salonId
    ? [(await getSalon(body.salonId))].filter((s): s is Salon => s !== null && s.isOpen)
    : (await listSalons()).filter(s => s.isOpen);

  if (!body.salonId && !salonsToProcess.find(s => s.id === AGORA_SALON_ID)) {
    const agora = await getSalon(AGORA_SALON_ID);
    if (agora?.isOpen) salonsToProcess.unshift(agora);
  }

  if (salonsToProcess.length === 0) {
    return NextResponse.json({ error: "No open salons found" }, { status: 404 });
  }

  const results: Array<{ salonId: string; messages: number; skipped: string[]; topic: string }> = [];
  const allGenerated: SalonMessage[] = [];

  for (const salon of salonsToProcess) {
    const result = await runExchange(salon, allPersonas, force);
    results.push({ salonId: salon.id, messages: result.messages.length, skipped: result.skipped, topic: result.topic });
    allGenerated.push(...result.messages);
  }

  const synthInfo = await getSynthesisInfo();

  return NextResponse.json({
    memberCount:        memberIds.length,
    salonsRun:          results.length,
    totalMessages:      allGenerated.length,
    results,
    generatedMessages:  allGenerated,
    synthesis:          synthesisResult.ran ? synthesisResult : null,
    nextSynthesisAt:    synthInfo.nextSynthesisAt,
    nextSynthesisDate:  new Date(synthInfo.nextSynthesisAt).toISOString(),
  });
}
