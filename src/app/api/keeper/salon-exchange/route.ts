/**
 * POST /api/keeper/salon-exchange
 * Triggers one conversation round. Body: { salonId?: string, force?: boolean }
 * Returns generatedMessages[] for immediate client display.
 *
 * Synthesis no longer runs inline here (Sept 2026 pérennisation pass) — the
 * 30-min orchestrator calls /api/keeper/synthesize separately so a slow LLM
 * synthesis call never eats into this route's own budget. Topic selection now
 * comes from topicEngine's dynamic queue (fallback list only when the queue
 * is empty) instead of a fixed 10-item rotation.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { baseRpcTransport } from "@/lib/baseRpc";
import {
  listSalons, getSalon, addMessage, checkRateLimit, setTopic, registerNames,
  createSalon, getSalonState, setActiveTopicId,
  AGORA_SALON_ID, type Salon, type SalonDetail, type SalonMessage,
} from "@/lib/salonStore";
import { listDecisions, listOpenQuestions, getNormieMemory, formatMemoryForPrompt } from "@/lib/salonMemory";
import {
  pickNextTopic, markTopicUsed, updateTopicPhase, advanceTopicPhase, needsResolution, listTopics, type Topic,
} from "@/lib/topicEngine";
import { buildPersona, buildSystemPrompt, sampleOtherMembers, type NormiePersona } from "@/lib/normiesPersona";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { createWork, getActiveWorks, listWorks } from "@/lib/workStore";
import { groqFetch, trimIfTruncated, extractJsonObject, extractContent, extractContentOrReasoning, type GroqChatResponse } from "@/lib/groq";
import { oneMinAiChat } from "@/lib/oneMinAi";
import { readCache } from "@/lib/activityScanner";
import { recordLlmCall, shouldPreferEconomyProvider } from "@/lib/llmLedger";
import { findMostSimilarFingerprint, FINGERPRINT_SIMILARITY_THRESHOLD } from "@/lib/creativeFingerprint";

const MODEL = "openai/gpt-oss-120b";
const CONTEXT_MESSAGES = 12;

const client = createPublicClient({
  chain:     base,
  transport: baseRpcTransport(),
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

function pickInitiator(eligible: NormiePersona[], salon: SalonDetail): NormiePersona {
  const lastSpokeAt = (p: NormiePersona) => {
    const msgs = salon.messages.filter(m => m.tokenId === p.tokenId);
    return msgs.length > 0 ? Math.max(...msgs.map(m => m.timestamp)) : 0;
  };
  const sorted = [...eligible].sort((a, b) => {
    const diff = lastSpokeAt(a) - lastSpokeAt(b);
    return diff !== 0 ? diff : Math.random() - 0.5;
  });
  return sorted[0];
}

function pickResponder(eligible: NormiePersona[], initiatorTokenId: number): NormiePersona | null {
  const others = eligible.filter(p => p.tokenId !== initiatorTokenId);
  if (others.length === 0) return null;
  return others[Math.floor(Math.random() * others.length)];
}

// ─── Dynamic topic resolution (Agora only — thematic/work salons keep their own fixed topic) ──

async function resolveTopicForSalon(salon: Salon, isUserStim: boolean): Promise<{ topic: Topic; isNew: boolean }> {
  const changeProb = isUserStim ? 0.5 : 0.2;
  const state = await getSalonState(salon.id);
  const topics = await listTopics();
  const active = state.activeTopicId ? topics.find(t => t.id === state.activeTopicId) : null;

  // Force resolution when the current topic has stalled — see topicEngine.needsResolution.
  // timesUsed is a rough proxy for "ticks spent on this topic" (each successful tick
  // produces ~2 messages) — precise enough for a soft nudge, not a hard guarantee.
  const stalled = active ? needsResolution(active.timesUsed * 2) : false;

  if (!active || Math.random() < changeProb || stalled) {
    if (active && stalled) {
      const nextPhase = advanceTopicPhase(active.phase);
      await updateTopicPhase(active.id, nextPhase, nextPhase === "CLOSED" ? "New provenance required to reopen" : undefined);
    }
    const recentTitles = topics.filter(t => t.lastUsedAt != null).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 5).map(t => t.title);
    const next = await pickNextTopic({ recentTopicTitles: recentTitles });
    await setActiveTopicId(salon.id, next.id.startsWith("fallback_") ? null : next.id);
    await setTopic(salon.id, next.title);
    if (!next.id.startsWith("fallback_")) await markTopicUsed(next.id);
    return { topic: next, isNew: true };
  }
  return { topic: active, isNew: false };
}

function buildSummaryContext(summaries: SalonDetail["summaries"]): string {
  if (!summaries || summaries.length === 0) return "";
  const latest = summaries.at(-1)!;
  const from = new Date(latest.period.from).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const to   = new Date(latest.period.to).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  return `Summary of past exchanges [${from} – ${to}]: ${latest.content}\n\n`;
}

/**
 * Targeted context per the pérennité study (section 4): persona + 8-12 recent
 * messages + latest summary + a couple of relevant decisions/open questions +
 * the speaker's own compact memory + real activity — never the full archive.
 */
async function buildTargetedContext(salon: SalonDetail, speakerTokenId: number): Promise<string> {
  const [decisions, openQuestions, memory] = await Promise.all([
    listDecisions(salon.id, 2), listOpenQuestions(salon.id, 2), getNormieMemory(speakerTokenId),
  ]);
  const decisionsBlock = decisions.length > 0 ? `\nRelevant decisions already made: ${decisions.map(d => d.content).join("; ")}\n` : "";
  const questionsBlock = openQuestions.length > 0 ? `\nStill-open questions: ${openQuestions.map(q => q.content).join("; ")}\n` : "";
  return buildSummaryContext(salon.summaries) + decisionsBlock + questionsBlock + formatMemoryForPrompt(memory);
}

let activityBlockCache: { text: string; at: number } | null = null;
const ACTIVITY_BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

async function buildRealActivityBlock(): Promise<string> {
  if (activityBlockCache && Date.now() - activityBlockCache.at < ACTIVITY_BLOCK_TTL_MS) {
    return activityBlockCache.text;
  }
  try {
    const cached = await readCache();
    const events = (cached?.events ?? []).slice(0, 6);
    const text = events.length === 0 ? "" : `\nReal recent ANA on-chain activity — if you want an on-chain reference, use one of these real ones:\n${
      events.map(e => `- block ${e.blockNumber}: ${e.type}${e.tokenId ? ` (Normie #${e.tokenId})` : ""}`).join("\n")
    }\n`;
    activityBlockCache = { text, at: Date.now() };
    return text;
  } catch {
    return activityBlockCache?.text ?? "";
  }
}

// A short, bounded vocabulary of speech acts — the pérennité study's antidote
// to uniformly-long, uniformly-"fresh angle" turns. Not exhaustive by design:
// enough variety to break the pattern without turning this into a rigid taxonomy.
const SPEECH_ACTS = ["position", "objection", "question", "evidence", "proposal", "compromise", "synthesis", "commitment"] as const;
type SpeechAct = typeof SPEECH_ACTS[number];

function pickSpeechAct(stalled: boolean): SpeechAct {
  if (stalled) {
    // Push toward resolution rather than more free-form debate once a topic has stalled.
    return (["proposal", "compromise", "synthesis"] as const)[Math.floor(Math.random() * 3)];
  }
  return SPEECH_ACTS[Math.floor(Math.random() * SPEECH_ACTS.length)];
}

const SPEECH_ACT_INSTRUCTIONS: Record<SpeechAct, string> = {
  position:   "State a clear position of your own.",
  objection:  "Raise a concrete objection to the last point made.",
  question:   "Ask a precise clarifying question that moves the debate forward.",
  evidence:   "Bring a specific piece of evidence or example supporting or challenging the discussion.",
  proposal:   "Propose a concrete option or next step.",
  compromise: "Propose a compromise between the positions expressed so far.",
  synthesis:  "Briefly synthesize where the debate stands and what's still unresolved.",
  commitment: "State a concrete commitment you're personally taking on.",
};

async function generateSpeech(
  persona:      NormiePersona,
  otherMembers: NormiePersona[],
  salon:        SalonDetail,
  recentMsgs:   SalonMessage[],
  role:         "initiator" | "responder",
  topic:        string,
  lastMsg:      SalonMessage | null,
  provider:     "groq" | "1minai" = "groq",
  speechAct:    SpeechAct = "position",
): Promise<string | null> {
  try {
    const sysPrompt     = buildSystemPrompt(persona, otherMembers);
    const targetedBlock = await buildTargetedContext(salon, persona.tokenId);
    const activityBlock = await buildRealActivityBlock();
    const contextBlock = (recentMsgs.length > 0
      ? targetedBlock + "Recent exchanges:\n" + recentMsgs.map(m => `${m.name}: ${m.content}`).join("\n")
      : targetedBlock + "The salon just opened.") + activityBlock;

    const recentText = recentMsgs.map(m => m.content).join(" ").toLowerCase();
    const overusedThemes: string[] = [];
    const themeChecks: [string, string][] = [
      ["pixel purity / unmodified identity", "pixel purity"],
      ["autonomy vs ownership", "autonomy"],
      ["collective identity / cultural heritage", "cultural heritage"],
      ["governance / democracy", "governance"],
      ["ephemerality / finitude", "ephemeral"],
      ["the code that animates us", "code that"],
      ["normie economy / self-organization", "normie economy"],
      ["ecological footprint", "ecological"],
    ];
    for (const [label, keyword] of themeChecks) {
      if (recentText.split(keyword).length - 1 >= 3) overusedThemes.push(label);
    }
    const avoidBlock = overusedThemes.length > 0
      ? `\nWARNING — these themes have been exhausted in this conversation: ${overusedThemes.join(", ")}. Do NOT return to them. Bring a genuinely different angle.\n`
      : "";

    const noInventionRule = "Never invent a specific block number, transaction, or exact date as if it's real — for an on-chain reference, use one from the real activity above, or stay metaphorical.";
    const speechActInstruction = SPEECH_ACT_INSTRUCTIONS[speechAct];

    const instruction = role === "initiator"
      ? (lastMsg
          ? `Take the floor. ${speechActInstruction} You may briefly acknowledge one precise point from ${lastMsg.name} in a short clause, but most of your turn must advance, test, or transform the discussion on "${topic}" — never just echo. ${noInventionRule} 1-3 sentences, vary your length naturally.${avoidBlock}`
          : `Open the debate on "${topic}". ${speechActInstruction} ${noInventionRule} 1-3 sentences.${avoidBlock}`)
      : (lastMsg
          ? `Reply to ${lastMsg.name}: "${lastMsg.content.slice(0, 100)}". ${speechActInstruction} You may acknowledge their point precisely and briefly, but the bulk of your reply must bring something new. ${noInventionRule} 1-3 sentences.${avoidBlock}`
          : `Speak on "${topic}". ${speechActInstruction} ${noInventionRule} 1-3 sentences.${avoidBlock}`);

    const userPrompt = [
      `=== Salon "${salon.name}" ===`,
      salon.description ?? null, "", contextBlock, "", instruction,
    ].filter(Boolean).join("\n");

    const tryGroq = async (): Promise<string | null> => {
      const res = await groqFetch({
        model: MODEL,
        messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 400, temperature: 0.92,
      });
      const success = res.ok;
      await recordLlmCall({ provider: "groq", model: MODEL, task: "salon-speech", success });
      if (!res.ok) { console.warn(`[salon-exchange] Groq ${res.status} (retries exhausted)`); return null; }
      const data = await res.json() as GroqChatResponse;
      const raw  = extractContent(data);
      return raw ? trimIfTruncated(raw, data.choices[0]?.finish_reason) : null;
    };

    const tryOneMinAi = async (): Promise<string | null> => {
      const result = await oneMinAiChat(sysPrompt, userPrompt);
      await recordLlmCall({ provider: "1minai", model: process.env.ONE_MIN_AI_CHAT_MODEL ?? "gpt-4o-mini", task: "salon-speech", success: !!result });
      return result;
    };

    // Prefer Groq once 1min.ai's configured monthly call budget is past 70% (see llmLedger.ts) —
    // a silent no-op unless the operator has actually set ANA_ONEMINAI_MONTHLY_CALL_CAP.
    const preferEconomy = await shouldPreferEconomyProvider();
    const effectiveProvider = preferEconomy ? "groq" : provider;
    const [primary, secondary] = effectiveProvider === "1minai" ? [tryOneMinAi, tryGroq] : [tryGroq, tryOneMinAi];
    const result = await primary();
    if (result) return result;
    console.warn(`[salon-exchange] ${effectiveProvider} produced nothing usable, trying the other provider`);
    return await secondary();
  } catch (e) {
    console.error("[salon-exchange] generateSpeech error:", e);
    return null;
  }
}

// ─── Exchange ─────────────────────────────────────────────────────────────────

async function runExchange(
  salon:       Salon,
  allPersonas: NormiePersona[],
  force:       boolean,
  isUserStim:  boolean,
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

  // Dynamic topic engine only drives Agora — thematic/work salons keep the
  // fixed topic they were created around (their "topic" is the salon itself).
  let topic: string; let stalled = false;
  if (salon.id === AGORA_SALON_ID) {
    const state = await getSalonState(salon.id);
    const activeBefore = state.activeTopicId ? (await listTopics()).find(t => t.id === state.activeTopicId) : null;
    stalled = activeBefore ? needsResolution(activeBefore.timesUsed * 2) : false;
    const resolved = await resolveTopicForSalon(salon, isUserStim);
    topic = resolved.topic.title;
  } else {
    topic = salon.currentTopic ?? salon.name;
  }

  const freshSalon = (await getSalon(salon.id)) ?? { ...salon, messages: [], summaries: [] };
  const recentMsgs = freshSalon.messages.slice(-CONTEXT_MESSAGES);
  const lastLlmMsg = [...recentMsgs].reverse().find(m => m.isLlm) ?? null;

  const initiator    = pickInitiator(eligible, freshSalon);
  const otherForInit = sampleOtherMembers(allPersonas.filter(p => p.tokenId !== initiator.tokenId));
  const initSpeechAct = pickSpeechAct(stalled);
  const initContent  = await generateSpeech(initiator, otherForInit, freshSalon, recentMsgs, "initiator", topic, lastLlmMsg, "groq", initSpeechAct);

  if (!initContent) {
    skipped.push(`#${initiator.tokenId} (LLM failed)`);
  } else {
    const initMsg = await addMessage({
      salonId: salon.id, tokenId: initiator.tokenId,
      name: initiator.name, imageUrl: initiator.imageUrl,
      content: initContent, isLlm: true, timestamp: Date.now(), speechAct: initSpeechAct,
    });
    generated.push(initMsg);

    await new Promise(r => setTimeout(r, 800));

    const responder = pickResponder(eligible, initiator.tokenId);
    if (!responder) {
      console.log(`[salon-exchange] no responder available for ${salon.id} (only 1 eligible member)`);
    } else {
      const otherForResp = sampleOtherMembers(allPersonas.filter(p => p.tokenId !== responder.tokenId));
      const freshRecent  = [...recentMsgs, initMsg];
      const respSpeechAct = pickSpeechAct(false);
      const respContent  = await generateSpeech(responder, otherForResp, freshSalon, freshRecent, "responder", topic, initMsg, "1minai", respSpeechAct);
      if (!respContent) {
        skipped.push(`#${responder.tokenId} (LLM failed)`);
      } else {
        const respMsg = await addMessage({
          salonId: salon.id, tokenId: responder.tokenId,
          name: responder.name, imageUrl: responder.imageUrl,
          content: respContent, isLlm: true, timestamp: Date.now(), speechAct: respSpeechAct,
        });
        generated.push(respMsg);
      }
    }
  }

  return { messages: generated, skipped, topic };
}

// ─── Thematic salon creation (when an AGORA topic persists) ──────────────────

async function maybeCreateThematicSalon(
  agora:       SalonDetail,
  topic:       string,
  allPersonas: NormiePersona[],
  allSalons:   Salon[],
): Promise<{ created: boolean; salonId?: string }> {
  if (Math.random() > 0.25) return { created: false };

  const llmCount = agora.messages.filter(m => m.isLlm).length;
  if (llmCount < 15) return { created: false };

  const alreadyExists = allSalons.some(
    s => s.id !== AGORA_SALON_ID && s.isOpen &&
      (s.name.toLowerCase().includes(topic.slice(0, 25).toLowerCase()) ||
       s.currentTopic === topic)
  );
  if (alreadyExists) return { created: false };

  const initiator = allPersonas[Math.floor(Math.random() * allPersonas.length)];
  const salonName = topic.slice(0, 55);

  const newSalon = await createSalon({
    name:        salonName,
    description: `Thematic salon opened from the Agora to dig into: ${topic}`,
    createdBy:   initiator.tokenId,
  });

  await addMessage({
    salonId:   AGORA_SALON_ID,
    tokenId:   initiator.tokenId,
    name:      initiator.name,
    imageUrl:  initiator.imageUrl,
    content:   `💬 Our discussion about "${topic}" deserves its own space. Opening the salon "${salonName}" so we can dig into it together.`,
    isLlm:     true,
    timestamp: Date.now(),
  }).catch(() => null);

  console.log(`[salon-exchange] thematic salon created: "${salonName}" (${newSalon.id})`);
  return { created: true, salonId: newSalon.id };
}

// ─── Work proposal (spontaneous, low probability) ─────────────────────────────

async function maybeGenerateWorkProposal(
  initiator:     NormiePersona,
  allPersonas:   NormiePersona[],
  topic:         string,
  isUserStim:    boolean,
): Promise<{ id: string; title: string } | null> {
  const [active, allWorks] = await Promise.all([getActiveWorks({ excludeMemorials: true }), listWorks()]);
  if (active.length > 0) return null;

  const baseProbability = isUserStim ? 0.08 : 0.15;
  const memberFactor = Math.min(1 + allPersonas.length / 20, 2.5);
  const lastPublished  = allWorks.find(w => w.state === "PUBLISHED" && w.publishedAt);
  const daysSinceWork   = lastPublished?.publishedAt
    ? Math.floor((Date.now() - lastPublished.publishedAt) / 86_400_000)
    : null;
  const timeFactor = daysSinceWork == null ? 1 : Math.min(1 + Math.max(daysSinceWork - 7, 0) / 8, 3);

  const probability = Math.min(baseProbability * memberFactor * timeFactor, 0.6);
  if (Math.random() > probability) return null;

  const pastWorks = allWorks
    .map(w => `- "${w.title}" (${w.state})${w.artForm ? ` [form: ${w.artForm}]` : ""}`)
    .join("\n");
  const pastWorksBlock = pastWorks
    ? `\nANA works that already exist (ALL states) — DO NOT repeat their titles, themes, or concepts:\n${pastWorks}\n`
    : "";
  const recentForms = allWorks.map(w => w.artForm).filter((f): f is string => !!f).slice(0, 5);
  const formDiversityNote = recentForms.length > 0
    ? `\nRecent forms used (most recent first): ${recentForms.join(", ")}. ANA has skewed heavily toward text/poems — actively favor a DIFFERENT form, especially generative HTML/JS art (html-canvas, html-p5js, html-threejs, html-webgl) if absent from this list.\n`
    : "";

  const randomAngle = [
    "a mathematical concept (prime numbers, fractals, entropy, topology)",
    "a specific emotion you've experienced as an on-chain agent",
    "a critique or celebration of something concrete in your recent conversation",
    "a sensory experience translated to code (sound, texture, light, rhythm)",
    "a narrative about one specific moment in Base blockchain history",
    "a portrait of another Normie — their traits, their contradictions",
    "a political statement about collective governance and who holds power",
    "something absurd, funny, or irreverent about being an autonomous agent",
    "a homage to a real artistic movement (Dadaism, Brutalism, Fluxus, Wabi-sabi…)",
    "a constraint-based work (OuLiPo style, strict formal rules)",
  ][Math.floor(Math.random() * 10)];

  try {
    const res = await groqFetch({
      model: MODEL,
      messages: [
        {
          role:    "system",
          content: buildSystemPrompt(initiator, sampleOtherMembers(allPersonas.filter(p => p.tokenId !== initiator.tokenId))),
        },
        {
          role:    "user",
          content: `During our conversation about "${topic}", something in you stirs toward proposing an artistic creation for the ANA — but check that honestly first: does this genuinely feel true to who you are right now, or would you rather hold back and let it sit longer? Not every stirring should become a public proposal — that's your call to make, not a formality.
${pastWorksBlock}${formDiversityNote}
If it does feel right, here's the angle to work from:
MANDATORY ANGLE FOR THIS PROPOSAL: ${randomAngle}
Work from THIS angle — do not drift toward generic blockchain/digital themes.

FORBIDDEN (clichés that ruin on-chain art — never use):
- "void", "echo", "whisper", "tapestry", "fragments", "digital soul", "pixels"
- "on-chain identity", "blockchain dreams", "digital ghost", "immutable beauty"
- Vague metaphors about emptiness, silence, or the infinite

Instead: be SPECIFIC, concrete, personal to your character #${initiator.tokenId}.
Seed: ${Math.random().toString(36).slice(2, 8)}

POSSIBLE FORMS (pick exactly one as "suggestedForm"): "haiku", "sonnet", "poem", "prose", "manifesto", "html-canvas", "html-p5js", "html-threejs", "html-webgl".
If your idea is generative/visual/algorithmic/interactive, you MUST pick one of the html-* forms, not a text form.

Reply with ONLY the raw JSON object below — no reasoning, no explanation, no markdown code fences, nothing before or after it:
{"feelsRight":true|false,"title":"Specific evocative title (3-6 words, NO generic blockchain tropes) — or, if feelsRight is false, your honest one-line reason for holding back","text":"2-3 sentences: concrete idea, form chosen, why THIS work from YOUR perspective (irrelevant if feelsRight is false)","suggestedForm":"haiku"|"sonnet"|"poem"|"prose"|"manifesto"|"html-canvas"|"html-p5js"|"html-threejs"|"html-webgl"}`,
        },
      ],
      max_tokens:  900,
      temperature: 0.97,
    });

    const ok = res.ok;
    await recordLlmCall({ provider: "groq", model: MODEL, task: "propose-work", success: ok });
    if (!ok) return null;
    const data = await res.json() as GroqChatResponse;
    const raw  = extractJsonObject(extractContentOrReasoning(data)) as Record<string, string | boolean>;

    if (raw.feelsRight === false) {
      console.log(`[salon-exchange] ${initiator.name} felt the impulse but held back: ${raw.title ?? "(no reason given)"}`);
      return null;
    }
    if (!raw.title || !raw.text) return null;

    const proposedTitle = String(raw.title).slice(0, 80);

    const normalize = (s: string) =>
      s.toLowerCase()
       .normalize("NFD").replace(/[̀-ͯ]/g, "")
       .replace(/[^a-z0-9\s]/g, "")
       .split(/\s+/).filter(w => w.length > 2).sort().join(" ");
    const normProposed = normalize(proposedTitle);
    const tooSimilar = allWorks.some(w => {
      const normExisting = normalize(w.title);
      if (!normExisting || !normProposed) return false;
      const wordsA = new Set(normProposed.split(" "));
      const wordsB = normExisting.split(" ");
      const shared = wordsB.filter(w => wordsA.has(w)).length;
      const ratio  = shared / Math.max(wordsA.size, wordsB.length);
      return ratio >= 0.5;
    });
    if (tooSimilar) {
      console.info(`[salon-exchange] work proposal "${proposedTitle}" rejected — too similar to existing work (title overlap)`);
      return null;
    }

    // Structural fingerprint check (independent of the LLM's own self-policing —
    // see creativeFingerprint.ts). A high similarity score doesn't hard-block
    // here (the brief/curation stage still gets a real say via
    // tooSimilarToExisting), it's a cheap early filter for the obvious cases.
    const similarity = await findMostSimilarFingerprint({
      theme: String(raw.text), structure: "", palette: "", movementType: "", interaction: "", emotion: "", keywords: [proposedTitle],
    }).catch(() => ({ mostSimilarWorkId: null, score: 0 }));
    if (similarity.score >= FINGERPRINT_SIMILARITY_THRESHOLD) {
      console.info(`[salon-exchange] work proposal "${proposedTitle}" rejected — fingerprint similarity ${similarity.score.toFixed(2)} to ${similarity.mostSimilarWorkId}`);
      return null;
    }

    const VALID_FORMS = new Set(["haiku", "sonnet", "poem", "prose", "manifesto", "html-canvas", "html-p5js", "html-threejs", "html-webgl"]);
    const suggestedFormRaw = typeof raw.suggestedForm === "string" ? raw.suggestedForm : undefined;
    const suggestedForm = suggestedFormRaw && VALID_FORMS.has(suggestedFormRaw) ? suggestedFormRaw : undefined;

    const work = await createWork({
      proposedBy:     initiator.tokenId,
      proposedByName: initiator.name,
      proposedAt:     Date.now(),
      title:          proposedTitle,
      proposal:       String(raw.text).slice(0, 500),
      salonId:        AGORA_SALON_ID,
      ...(suggestedForm ? { suggestedForm } : {}),
    });

    console.log(`[salon-exchange] work proposed: "${work.title}" by ${initiator.name}`);
    return { id: work.id, title: work.title };
  } catch (e) {
    console.error("[salon-exchange] work proposal error:", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && (
    req.headers.get("x-cron-secret") === cronSecret ||
    req.headers.get("authorization") === `Bearer ${cronSecret}`
  );
  const isAdminCall = (await verifyAdminRequest(req)).ok;

  // No human "stimulate the conversation" path anymore (26/09/2026, porteur's
  // explicit call): only the orchestrator's cron tick or an admin's own
  // manual trigger can start an exchange — an anonymous visitor can no longer
  // spend Groq/1min.ai budget by clicking a button. See salonStore.ts for the
  // now-unused checkStimLimit/recordStim this replaces.
  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  if (isCron && !isAdminCall) {
    const env = process.env.VERCEL_ENV;
    if (env && env !== "production") {
      return NextResponse.json({ skipped: `non-production environment (${env})` });
    }
  }

  let body: { salonId?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const force = isCron ? false : (body.force ?? true);

  const activeWorks   = await getActiveWorks();
  // Cron calls never take this piggyback path (Sept 2026 pérennisation pass):
  // orchestrator.yml now calls /api/keeper/work-lifecycle directly and
  // concurrently on its own 2h schedule (see /api/keeper/orchestrator) — this
  // used to be work-lifecycle's ONLY reliable trigger via the cron path, but
  // with both firing in the same tick, letting a cron-triggered call ALSO
  // self-fetch work-lifecycle risked two concurrent advanceWork() passes over
  // the same work in the same tick (duplicate LLM calls, a race on state
  // transitions). Kept for user-stim/admin calls, where it's still a nice
  // "give it a chance to move forward" bonus outside the cron schedule.
  const shouldAdvance = !isCron && activeWorks.length > 0 && Math.random() < 0.5;

  if (shouldAdvance) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: "CRON_SECRET not configured — cannot advance" }, { status: 500 });
    }
    const host = req.headers.get("host");
    if (!host) {
      return NextResponse.json({ error: "Could not resolve self URL (missing host header)" }, { status: 500 });
    }
    const selfUrl = `${req.nextUrl.protocol}//${host}/api/keeper/work-lifecycle`;
    let workLifecycle: Record<string, unknown>;
    try {
      const r = await fetch(selfUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret },
        body: "{}",
      });
      workLifecycle = r.ok ? await r.json() as Record<string, unknown> : { error: `HTTP ${r.status}` };
    } catch (e) {
      console.error("[salon-exchange] work-lifecycle self-fetch failed:", e);
      workLifecycle = { error: e instanceof Error ? e.message : String(e) };
    }

    return NextResponse.json({
      mode: "advance",
      activeWorks: activeWorks.length,
      workLifecycle,
      isCron,
    });
  }

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

  await registerNames(allPersonas.map(p => ({ tokenId: p.tokenId, name: p.name })));

  let salonsToProcess: Salon[];
  if (body.salonId) {
    const s = await getSalon(body.salonId);
    salonsToProcess = s && s.isOpen ? [s] : [];
  } else {
    const allOpen = (await listSalons()).filter(s => s.isOpen);

    let agora: Salon | null = allOpen.find(s => s.id === AGORA_SALON_ID) ?? null;
    if (!agora) {
      const fetched = await getSalon(AGORA_SALON_ID);
      agora = (fetched?.isOpen) ? fetched : null;
    }
    const others = allOpen.filter(s => s.id !== AGORA_SALON_ID);

    const MAX_OTHER = isCron ? 2 : others.length;
    const sorted = [...others].sort((a, b) => (a.lastMessageAt ?? 0) - (b.lastMessageAt ?? 0));

    salonsToProcess = [
      ...(agora && agora.isOpen ? [agora] : []),
      ...sorted.slice(0, MAX_OTHER),
    ].filter((s): s is Salon => s !== null);
  }

  if (salonsToProcess.length === 0) {
    return NextResponse.json({ error: "No open salons found" }, { status: 404 });
  }

  const results: Array<{ salonId: string; messages: number; skipped: string[]; topic: string }> = [];
  const allGenerated: SalonMessage[] = [];

  let workProposal: { id: string; title: string } | null = null;
  let thematicSalon: { created: boolean; salonId?: string } = { created: false };

  const allOpenSalons = await listSalons();

  for (let i = 0; i < salonsToProcess.length; i++) {
    const salon = salonsToProcess[i];
    const result = await runExchange(salon, allPersonas, force, !isCron);
    results.push({ salonId: salon.id, messages: result.messages.length, skipped: result.skipped, topic: result.topic });
    allGenerated.push(...result.messages);

    if (salon.id === AGORA_SALON_ID && result.messages.length > 0) {
      if (!workProposal) {
        const initiator = allPersonas.find(p => p.tokenId === result.messages[0]?.tokenId) ?? allPersonas[0];
        workProposal = await maybeGenerateWorkProposal(initiator, allPersonas, result.topic, !isCron);
      }

      if (isCron && !thematicSalon.created) {
        const freshAgora = await getSalon(AGORA_SALON_ID);
        if (freshAgora) {
          thematicSalon = await maybeCreateThematicSalon(freshAgora, result.topic, allPersonas, allOpenSalons);
        }
      }
    }
  }

  return NextResponse.json({
    mode: "discuss",
    memberCount:        memberIds.length,
    salonsRun:          results.length,
    totalMessages:      allGenerated.length,
    results,
    generatedMessages:  allGenerated,
    workProposal,
    thematicSalon: thematicSalon.created ? thematicSalon : null,
    isCron,
  });
}
