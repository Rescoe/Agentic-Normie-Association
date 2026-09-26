/**
 * synthesis.ts — the single structured synthesis call shared by the daily
 * midnight job and the manual /api/keeper/synthesize trigger.
 *
 * Rules from the Sept 2026 pérennité study (section 3/5), enforced here:
 *   - One LLM call produces BOTH a narrative AND structured fields in the
 *     same response (never separate calls for "summary" vs "extract
 *     decisions") — cheaper, and keeps them consistent with each other.
 *   - Strict schema validation; on an invalid/unparseable response, ONE short
 *     repair retry; if that also fails, the salon's unsynthesized messages
 *     are left untouched for the next tick. The synthesis cursor
 *     (salonStore.storeSynthesis) is ONLY ever advanced inside a successful
 *     call to storeSynthesis() — there is no code path that marks a salon
 *     "done" without having actually stored a summary.
 *   - Messages are never deleted (see salonStore.ts's header) — synthesis is
 *     about keeping the LLM's working context small, not about avoiding data
 *     loss, which the relational rewrite makes structurally impossible.
 */
import {
  getSalon, listSummaries, getSalonState, storeSynthesis, SYNTHESIS_KEEP_LAST, SYNTHESIS_MSG_THRESHOLD,
  listSalonsDueForThresholdSynthesis, AGORA_SALON_ID, type SalonMessage,
} from "./salonStore";
import { createDecision, createOpenQuestion, createCommitment } from "./salonMemory";
import { promoteOrCreateFromSynthesis } from "./devRequests";
import { createTopic, updateTopicPhase, listTopics } from "./topicEngine";
import { buildSignalsPromptBlock, type ExternalSignal } from "./externalSignals";
import { groqFetch, extractJsonObject, extractContentOrReasoning, type GroqChatResponse } from "./groq";
import { recordLlmCall } from "./llmLedger";

const MODEL = "openai/gpt-oss-120b";

export interface EmergingTopicDraft {
  title: string; whyNow: string; openingQuestion: string; novelty: number; urgency: number; expiresAt?: number | null;
}

export interface SynthesisResult {
  narrative:       string;
  decisions:       string[];
  openQuestions:   string[];
  positions:       string[];
  commitments:     Array<{ tokenId: number; content: string }>;
  creativeIdeas:   string[];
  devNeeds:        string[];
  topicsClosed:    string[];
  topicsToResume:  string[];
  emergingTopics:  EmergingTopicDraft[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === "string");
}

/** Strict shape validation — anything short of the full schema is treated as invalid, triggering the one-shot repair retry. Exported for unit testing (tests/synthesis.test.ts). */
export function validateSynthesisShape(raw: Record<string, unknown>): SynthesisResult | null {
  if (typeof raw.narrative !== "string" || raw.narrative.trim().length < 20) return null;
  if (!isStringArray(raw.decisions) || !isStringArray(raw.openQuestions) || !isStringArray(raw.positions)
    || !isStringArray(raw.creativeIdeas) || !isStringArray(raw.devNeeds)
    || !isStringArray(raw.topicsClosed) || !isStringArray(raw.topicsToResume)) return null;

  const commitmentsRaw = Array.isArray(raw.commitments) ? raw.commitments : [];
  const commitments = commitmentsRaw
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map(c => ({ tokenId: Number(c.tokenId ?? 0), content: String(c.content ?? "") }))
    .filter(c => c.content.length > 0);

  const emergingRaw = Array.isArray(raw.emergingTopics) ? raw.emergingTopics : [];
  const emergingTopics = emergingRaw
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map(t => ({
      title: String(t.title ?? "").slice(0, 160),
      whyNow: String(t.whyNow ?? ""),
      openingQuestion: String(t.openingQuestion ?? ""),
      novelty: typeof t.novelty === "number" ? t.novelty : 0.5,
      urgency: typeof t.urgency === "number" ? t.urgency : 0.3,
      expiresAt: typeof t.expiresAt === "number" ? t.expiresAt : null,
    }))
    .filter(t => t.title.length > 0);

  return {
    narrative: raw.narrative.trim(),
    decisions: raw.decisions, openQuestions: raw.openQuestions, positions: raw.positions,
    commitments, creativeIdeas: raw.creativeIdeas, devNeeds: raw.devNeeds,
    topicsClosed: raw.topicsClosed, topicsToResume: raw.topicsToResume, emergingTopics,
  };
}

const SYNTHESIS_SCHEMA_HINT = `{
  "narrative": "Factual summary of the debate, 120-160 words",
  "decisions": ["..."],
  "openQuestions": ["..."],
  "positions": ["Normie name: their position, ..."],
  "commitments": [{"tokenId": 0, "content": "..."}],
  "creativeIdeas": ["..."],
  "devNeeds": ["..."],
  "topicsClosed": ["..."],
  "topicsToResume": ["..."],
  "emergingTopics": [{"title": "...", "whyNow": "...", "openingQuestion": "...", "novelty": 0.5, "urgency": 0.3}]
}`;

async function callSynthesisLlm(
  salonName: string, transcript: string, signalsBlock: string, repair: boolean,
): Promise<SynthesisResult | null> {
  const prompt = repair
    ? `Your previous reply was not valid JSON matching the required schema. Reply with ONLY the JSON object below, nothing else, no markdown fences:\n${SYNTHESIS_SCHEMA_HINT}\n\nSalon: "${salonName}"\nTranscript:\n${transcript.slice(0, 5000)}${signalsBlock}`
    : `Summarize this ANA salon "${salonName}" debate into ONE JSON object matching exactly this schema (empty arrays where nothing applies):\n${SYNTHESIS_SCHEMA_HINT}\n\n` +
      `"emergingTopics" should only include genuinely new topics grounded in the transcript or the external signals below — never invent one from nothing. ` +
      `Transcript:\n${transcript.slice(0, 6000)}${signalsBlock}`;

  const res = await groqFetch({
    model: MODEL,
    messages: [
      { role: "system", content: "You are the ANA archivist. You produce structured institutional memory from Normie debates. Respond with strict JSON only, always in English." },
      { role: "user", content: prompt },
    ],
    max_tokens: 900, temperature: repair ? 0.2 : 0.4,
  });
  const success = res.ok;
  await recordLlmCall({ provider: "groq", model: MODEL, task: "synthesis", success, retries: repair ? 1 : 0 });
  if (!res.ok) return null;
  const data = await res.json() as GroqChatResponse;
  const raw = extractJsonObject(extractContentOrReasoning(data));
  return validateSynthesisShape(raw);
}

/** One salon has enough unsynthesized volume to justify synthesizing now, independent of the daily catch-all. */
export async function shouldSynthesizeSalon(salonId: string): Promise<boolean> {
  const state = await getSalonState(salonId);
  return state.messagesSinceSynthesis >= SYNTHESIS_MSG_THRESHOLD;
}

export interface SynthesizeOutcome {
  ran: boolean; reason?: string; salonId: string; messageCount?: number;
}

/**
 * Synthesizes ONE salon: loads unsynthesized messages beyond the current
 * cursor (keeping the most recent SYNTHESIS_KEEP_LAST as working memory),
 * calls the LLM once, repairs once on invalid shape, and — only on success —
 * persists the summary, structured registries, dev-request promotions, and
 * any emergingTopics into the topic queue.
 */
export async function synthesizeSalon(salonId: string, opts: { signals?: ExternalSignal[]; force?: boolean } = {}): Promise<SynthesizeOutcome> {
  const salon = await getSalon(salonId);
  if (!salon) return { ran: false, reason: "salon not found", salonId };

  const state = await getSalonState(salonId);
  const allMessages = salon.messages; // getSalon() caps at DETAIL_VIEW_MESSAGE_CAP — fine for a synthesis window
  const unsynthesized = allMessages.filter(m => m.timestamp > state.synthesisCursor);

  if (!opts.force && unsynthesized.length < SYNTHESIS_MSG_THRESHOLD) {
    return { ran: false, reason: `only ${unsynthesized.length} unsynthesized messages (threshold ${SYNTHESIS_MSG_THRESHOLD})`, salonId };
  }
  if (unsynthesized.length === 0) return { ran: false, reason: "nothing to synthesize", salonId };

  const toSummarize = unsynthesized.length > SYNTHESIS_KEEP_LAST
    ? unsynthesized.slice(0, -SYNTHESIS_KEEP_LAST)
    : unsynthesized; // small salon at daily catch-all — summarize everything due, keep_last still applies to the NEXT window naturally
  if (toSummarize.length === 0) return { ran: false, reason: "nothing beyond keep_last window", salonId };

  const transcript = toSummarize.map((m: SalonMessage) => `${m.name}: ${m.content}`).join("\n");
  const signalsBlock = opts.signals ? buildSignalsPromptBlock(opts.signals) : "";

  let result = await callSynthesisLlm(salon.name, transcript, signalsBlock, false);
  if (!result) result = await callSynthesisLlm(salon.name, transcript, signalsBlock, true);
  if (!result) {
    console.warn(`[synthesis] "${salon.name}" — LLM produced no valid schema after retry, leaving cursor untouched`);
    return { ran: false, reason: "LLM output invalid after repair retry", salonId };
  }

  const periodFrom = toSummarize[0].timestamp;
  const periodTo   = toSummarize.at(-1)!.timestamp;

  await storeSynthesis(salonId, result.narrative, periodFrom, periodTo, toSummarize.length, {
    decisions: result.decisions, openQuestions: result.openQuestions, positions: result.positions,
    commitments: result.commitments.map(c => c.content), creativeIdeas: result.creativeIdeas,
    devNeeds: result.devNeeds, topicsClosed: result.topicsClosed, topicsToResume: result.topicsToResume,
  });

  // Best-effort side effects — none of these gate the synthesis's own success,
  // since the summary is already safely persisted above.
  await Promise.allSettled([
    ...result.decisions.map(d => createDecision(salonId, d)),
    ...result.openQuestions.map(q => createOpenQuestion(salonId, q)),
    ...result.commitments.map(c => createCommitment(salonId, c.tokenId, c.content)),
    ...result.devNeeds.map(d => promoteOrCreateFromSynthesis(d, salonId)),
  ]);

  if (result.emergingTopics.length > 0) {
    const existingTitles = (await listTopics()).map(t => t.title);
    for (const t of result.emergingTopics) {
      // Skip near-duplicates of an already-queued topic — cheap guard against
      // the same emerging topic being re-created every synthesis run.
      const { jaccardSimilarity } = await import("./topicEngine");
      if (existingTitles.some(title => jaccardSimilarity(title, t.title) > 0.6)) continue;
      await createTopic({
        title: t.title, origin: "signal", openingQuestion: t.openingQuestion,
        novelty: t.novelty, urgency: t.urgency, relevance: 0.6, expiresAt: t.expiresAt ?? null,
      });
    }
  }

  for (const closedTitle of result.topicsClosed) {
    const topics = await listTopics();
    const match = topics.find(t => t.title.toLowerCase().includes(closedTitle.toLowerCase().slice(0, 20)));
    if (match) await updateTopicPhase(match.id, "CLOSED");
  }

  return { ran: true, salonId, messageCount: toSummarize.length };
}

/** Threshold-based pass — call on every orchestrator tick (cheap: one indexed query). */
export async function runThresholdSynthesis(): Promise<SynthesizeOutcome[]> {
  const due = await listSalonsDueForThresholdSynthesis();
  const results: SynthesizeOutcome[] = [];
  for (const salonId of due) results.push(await synthesizeSalon(salonId));
  return results;
}

/** Daily catch-all — call once at the midnight orchestrator tick: synthesizes every salon with ANY unsynthesized backlog, plus external signal collection. */
export async function runDailySynthesis(signals: ExternalSignal[]): Promise<SynthesizeOutcome[]> {
  const { listSalons } = await import("./salonStore");
  const salons = await listSalons();
  const results: SynthesizeOutcome[] = [];
  for (const salon of salons) {
    const state = await getSalonState(salon.id);
    if (state.messagesSinceSynthesis === 0) continue;
    results.push(await synthesizeSalon(salon.id, { signals: salon.id === AGORA_SALON_ID ? signals : undefined, force: true }));
  }
  return results;
}
