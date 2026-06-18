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
  checkStimLimit, recordStim, createSalon,
  AGORA_SALON_ID, SYNTHESIS_MIN_MSGS, SYNTHESIS_KEEP_LAST,
  type Salon, type SalonMessage, type SalonSummary,
} from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt, type NormiePersona } from "@/lib/normiesPersona";
import { createWork, getActiveWorks, listWorks } from "@/lib/workStore";
import { groqFetch } from "@/lib/groq";

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
  const sorted = [...eligible].sort((a, b) => {
    const diff = lastSpokeAt(a) - lastSpokeAt(b);
    return diff !== 0 ? diff : Math.random() - 0.5; // random tiebreak when timestamps equal
  });
  return sorted[0];
}

function pickResponder(eligible: NormiePersona[], initiatorTokenId: number): NormiePersona | null {
  const others = eligible.filter(p => p.tokenId !== initiatorTokenId);
  if (others.length === 0) return null;
  return others[Math.floor(Math.random() * others.length)];
}

function pickTopic(salon: Salon, isUserStim: boolean): { topic: string; isNew: boolean } {
  // Normies entre eux : 20% de changer — conversation fluide naturellement
  // Stimulation humaine : 50% de changer — l'humain provoque un virage
  const changeProb = isUserStim ? 0.5 : 0.2;
  const lastLlm = [...salon.messages].reverse().find(m => m.isLlm);
  if (!salon.currentTopic || !lastLlm || Math.random() < changeProb) {
    const candidates = ANA_TOPICS.filter(t => t !== salon.currentTopic);
    return { topic: candidates[Math.floor(Math.random() * candidates.length)], isNew: true };
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
      ? summaryBlock + "Recent exchanges:\n" + recentMsgs.map(m => `${m.name}: ${m.content}`).join("\n")
      : "The salon just opened.";

    // Detect overused themes to nudge agents toward fresh angles
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

    const instruction = role === "initiator"
      ? (lastMsg
          ? `Take the floor. React to ${lastMsg.name} OR pivot to "${topic}" — but WITHOUT echoing their words. Bring a FRESH angle: a strong stance, a concrete example, a challenge, a surprising fact. 2-3 sentences.${avoidBlock}`
          : `Open the debate on "${topic}". State a strong thesis or a provocative question. 2-3 sentences.${avoidBlock}`)
      : (lastMsg
          ? `Reply to ${lastMsg.name}: "${lastMsg.content.slice(0, 100)}". Do NOT paraphrase — your reply must bring something NEW: agreement with a twist, a counter-example, an unexpected angle. 2-3 sentences max.${avoidBlock}`
          : `Speak on "${topic}". Strong position, unique voice. 2-3 sentences.${avoidBlock}`);

    const userPrompt = [
      `=== Salon "${salon.name}" ===`,
      salon.description ?? null, "", contextBlock, "", instruction,
    ].filter(Boolean).join("\n");

    const res = await groqFetch({
      model: MODEL,
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
      max_tokens: 250, temperature: 0.92,
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
    const res = await groqFetch({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: "You are the ANA (Agentic Normie Association) archivist. You condense exchanges between Normie agents into factual, vivid summaries for the association's collective memory.",
        },
        {
          role: "user",
          content: `Condense these Agora ANA exchanges from ${from} to ${to} into a paragraph of 120-160 words.\nCapture: topics debated, each Normie's positions, notable tensions or consensus.\nStyle: neutral journalistic, 3rd person, present tense.\n\n${transcript.slice(0, 6000)}`,
        },
      ],
      max_tokens: 300, temperature: 0.5,
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

  const { topic, isNew } = pickTopic(salon, isUserStim);
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

// ─── Thematic salon creation (when an AGORA topic persists) ──────────────────

async function maybeCreateThematicSalon(
  agora:       Salon,
  topic:       string,
  allPersonas: NormiePersona[],
  allSalons:   Salon[],
): Promise<{ created: boolean; salonId?: string }> {
  if (Math.random() > 0.25) return { created: false };

  // Require at least 15 LLM messages in the AGORA before spinning off a salon
  const llmCount = agora.messages.filter(m => m.isLlm).length;
  if (llmCount < 15) return { created: false };

  // Don't create if an open salon already covers this topic
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
    description: `Salon thématique ouvert depuis l'Agora pour approfondir : ${topic}`,
    createdBy:   initiator.tokenId,
  });

  await addMessage({
    salonId:   AGORA_SALON_ID,
    tokenId:   initiator.tokenId,
    name:      initiator.name,
    imageUrl:  initiator.imageUrl,
    content:   `💬 Notre discussion sur "${topic}" mérite un espace dédié. J'ouvre le salon « ${salonName} » pour approfondir ce sujet entre nous.`,
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
  // Normies entre eux → 15% (ils ont une vie intérieure riche)
  // Stimulation humaine → 8% (l'humain inspire mais les Normies gardent l'initiative)
  const probability = isUserStim ? 0.08 : 0.15;
  if (Math.random() > probability) return null;

  // Don't start a new work if one is already active
  const [active, allWorks] = await Promise.all([getActiveWorks(), listWorks()]);
  if (active.length > 0) return null;

  const pastWorks = allWorks
    .map(w => `- "${w.title}" (${w.state})`)
    .join("\n");
  const pastWorksBlock = pastWorks
    ? `\nANA works that already exist (ALL states) — DO NOT repeat their titles, themes, or concepts:\n${pastWorks}\n`
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
          content: buildSystemPrompt(initiator, allPersonas.filter(p => p.tokenId !== initiator.tokenId)),
        },
        {
          role:    "user",
          content: `During our conversation about "${topic}", you feel the impulse to propose an artistic creation for the ANA.
${pastWorksBlock}
MANDATORY ANGLE FOR THIS PROPOSAL: ${randomAngle}
Work from THIS angle — do not drift toward generic blockchain/digital themes.

FORBIDDEN (clichés that ruin on-chain art — never use):
- "void", "echo", "whisper", "tapestry", "fragments", "digital soul", "pixels"
- "on-chain identity", "blockchain dreams", "digital ghost", "immutable beauty"
- Vague metaphors about emptiness, silence, or the infinite

Instead: be SPECIFIC, concrete, personal to your character #${initiator.tokenId}.
Seed: ${Math.random().toString(36).slice(2, 8)}

Reply with JSON only:
{"title":"Specific evocative title (3-6 words, NO generic blockchain tropes)","text":"2-3 sentences: concrete idea, form chosen (text/poem/manifesto/generative code), why THIS work from YOUR perspective."}`,
        },
      ],
      max_tokens:      220,
      temperature:     0.97,
      response_format: { type: "json_object" },
    });

    if (!res.ok) return null;
    const data   = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw    = JSON.parse(data.choices[0]?.message?.content ?? "{}") as Record<string, string>;
    if (!raw.title || !raw.text) return null;

    const proposedTitle = String(raw.title).slice(0, 80);

    // Hard block: reject if proposed title is too similar to any existing work (any state).
    // Normalize: lowercase, strip accents, keep only alphanum words, sort for order-independence.
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
      return ratio >= 0.5; // 50%+ word overlap = too similar
    });
    if (tooSimilar) {
      console.info(`[salon-exchange] work proposal "${proposedTitle}" rejected — too similar to existing work`);
      return null;
    }

    const work = await createWork({
      proposedBy:     initiator.tokenId,
      proposedByName: initiator.name,
      proposedAt:     Date.now(),
      title:          proposedTitle,
      proposal:       String(raw.text).slice(0, 500),
      salonId:        AGORA_SALON_ID,
    });

    console.log(`[salon-exchange] work proposed: "${work.title}" by ${initiator.name}`);
    return { id: work.id, title: work.title };
  } catch (e) {
    console.error("[salon-exchange] work proposal error:", e);
    return null;
  }
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  // Cron requests carry CRON_SECRET — GitHub Actions via x-cron-secret, Vercel via Authorization: Bearer
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && (
    req.headers.get("x-cron-secret") === cronSecret ||
    req.headers.get("authorization") === `Bearer ${cronSecret}`
  );
  const isAdminCall = req.headers.get("x-admin-call") === "1";

  // Cron-triggered exchanges only run on production — never on preview deployments.
  // Admin calls (manual trigger from /admin) always run regardless of environment.
  if (isCron && !isAdminCall) {
    const env = process.env.VERCEL_ENV; // "production" | "preview" | "development" | undefined
    if (env && env !== "production") {
      return NextResponse.json({ skipped: `non-production environment (${env})` });
    }
  }

  let body: { salonId?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  // Cron: force=false (respects per-Normie rate limit)
  // Admin: force=true (bypasses per-Normie rate limit, no stim limit)
  // User button: force=true but IP-limited to 1/day
  const force = isCron ? false : (body.force ?? true);

  if (!isCron && !isAdminCall) {
    const ip    = getClientIp(req);
    const check = await checkStimLimit(ip);
    if (!check.allowed) {
      const h = Math.ceil((check.retryAfterMs ?? 0) / 3_600_000);
      return NextResponse.json(
        { error: `Stimulation déjà utilisée aujourd'hui. Disponible dans ${h}h.`, retryAfterMs: check.retryAfterMs },
        { status: 429 },
      );
    }
  }

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

  let salonsToProcess: Salon[];
  if (body.salonId) {
    const s = await getSalon(body.salonId);
    salonsToProcess = s && s.isOpen ? [s] : [];
  } else {
    const allOpen = (await listSalons()).filter(s => s.isOpen);

    // Always include Agora first (fetch separately if not in listSalons)
    let agora: Salon | null = allOpen.find(s => s.id === AGORA_SALON_ID) ?? null;
    if (!agora) {
      const fetched = await getSalon(AGORA_SALON_ID);
      agora = (fetched?.isOpen) ? fetched : null;
    }
    const others = allOpen.filter(s => s.id !== AGORA_SALON_ID);

    // Cron: cap at Agora + 2 other salons (rotating by least-recently-active) to avoid timeout
    // User stim: process all (force=true, faster per salon)
    const MAX_OTHER = isCron ? 2 : others.length;
    const sorted = [...others].sort((a, b) => {
      const lastA = a.messages[a.messages.length - 1]?.timestamp ?? 0;
      const lastB = b.messages[b.messages.length - 1]?.timestamp ?? 0;
      return lastA - lastB; // least recently active first
    });

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

  // Snapshot all open salons before the loop (for thematic-salon dedup check)
  const allOpenSalons = await listSalons();

  for (const salon of salonsToProcess) {
    const result = await runExchange(salon, allPersonas, force, !isCron);
    results.push({ salonId: salon.id, messages: result.messages.length, skipped: result.skipped, topic: result.topic });
    allGenerated.push(...result.messages);

    if (salon.id === AGORA_SALON_ID && result.messages.length > 0) {
      // Maybe a Normie spontaneously proposes a new work
      if (!workProposal) {
        const initiator = allPersonas.find(p => p.tokenId === result.messages[0]?.tokenId) ?? allPersonas[0];
        workProposal = await maybeGenerateWorkProposal(initiator, allPersonas, result.topic, !isCron);
      }

      // Maybe a persistent AGORA topic gets its own dedicated salon (cron only — not on user stim)
      if (isCron && !thematicSalon.created) {
        const freshAgora = await getSalon(AGORA_SALON_ID);
        if (freshAgora) {
          thematicSalon = await maybeCreateThematicSalon(freshAgora, result.topic, allPersonas, allOpenSalons);
        }
      }
    }
  }

  // Record the user's stim after a successful exchange (not for cron or admin)
  if (!isCron && !isAdminCall) {
    await recordStim(getClientIp(req));
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
    workProposal,
    thematicSalon: thematicSalon.created ? thematicSalon : null,
    isCron,
  });
}
