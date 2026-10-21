/**
 * oneMinAi.ts — thin client for 1min.ai's "Chat with AI API" (UNIFY_CHAT_WITH_AI).
 * Critical-generation client plus the best-effort salon fallback, sharing the
 * same low-level request:
 *
 * - oneMinAiChat(): fallback when Groq fails outright for salon speech (after
 *   Groq's own 429 retries are exhausted), so conversations don't go silent
 *   on a bad Groq day. Replies are kept short via LENGTH_GUARD.
 * - oneMinAiCode(): primary model for the HTML/code generation step of
 *   stepCreating() (work-lifecycle route) — a model actually trained on code
 *   instead of the Groq reasoning model used everywhere else. No length
 *   guard (needs the full HTML), falls back to Groq on failure.
 * - oneMinAiText(): primary model for literary works. Form-specific guards
 *   keep a haiku short without imposing the salon's 60-word cap on prose.
 * - oneMinAiStructured(): primary model for briefs, votes, validation,
 *   synthesis and newsroom JSON. Callers still validate/parse the result.
 *
 * Unlike Groq's /v1/chat/completions, this API has no separate system/user
 * message roles -- just one `prompt` string per request. Messages are
 * concatenated by the caller. Conversation history/memory (conversationId)
 * is deliberately not used here: this app already builds full context into
 * the prompt text itself, the same stateless-per-call shape Groq is used
 * with.
 *
 * No max-tokens control on this API at all (confirmed live 24/09 — a single
 * salon reply cost ~21,000 of 1min.ai's own credits with no cap available;
 * there used to be a maxTokens option here that silently did nothing, since
 * nothing in the request body ever used it). For chat, the only lever is the
 * prompt-level LENGTH_GUARD below. For code generation this is fine as-is —
 * the calling prompt itself already asks for "ONLY the complete HTML", and a
 * real test (25/09) came back at ~6k tokens for deepseek-flash.
 */

import { getOneMinAiCreditsSpent, addOneMinAiCredits } from "./llmLedger";

const CHAT_URL = "https://api.1min.ai/api/chat-with-ai";

// Appended to every oneMinAiChat() request regardless of the caller's own
// prompt, since there's no API-level way to cap output length. Not a hard
// guarantee (still prompt-based, not enforced by the API), but it's the only
// lever available. Deliberately NOT used by oneMinAiCode() — a capped HTML
// artwork is a broken artwork.
const LENGTH_GUARD = "\n\n(Hard limit: your entire reply must be under 60 words. Do not exceed this, no exceptions.)";

// DeepSeek V4.1 Flash — chosen 25/09/2026 after a real test with the
// production stepCreating() prompt: ~6k tokens for a fully-featured seeded
// p5.js scene, vs. 119k-170k for DeepSeek V4 Pro / Kimi K2.7 Code (both blow
// the ~50k-tokens-per-work budget on this single call alone) and worse
// output for 5x the cost from GPT-4o. See the vault note "ANA - Modèle
// hybride multi-LLM et wallets Normies.md" for the full comparison.
const DEFAULT_CODE_MODEL = "deepseek-flash";
const DEFAULT_CRITICAL_MODEL = "deepseek-flash";

export type OneMinAiMessage = { role: "system" | "user"; content: string };
export type OneMinAiTask = "chat" | "code" | "art-text" | "structured" | "news";

// ─── Monthly credit governor ────────────────────────────────────────────────
//
// 21/10/2026: the whole 1min.ai balance (~6.8M credits) was spent in 25 days
// (usage export, 700 calls): ~40% in ~40 HTML code generations (50-100k each),
// ~45% in structured JSON calls (8-50k: votes, briefs, curation, synthesis,
// scene-v1) and only ~9% in the small salon replies (~1.8k). Nothing capped
// spend, so every retry loop and every extra salon tick drew straight from the
// balance. Now every call is charged an ESTIMATED cost against a monthly
// budget (default 1M), and a task kind stops being sent to 1min.ai once the
// spend passes its share of that budget. A refused call returns null, which
// every caller already treats as "provider failed" and routes to its Groq
// fallback — the pipeline slows down in quality, never stalls.
export const ONE_MIN_AI_DEFAULT_MONTHLY_CREDITS = 1_000_000;

/** Estimated credits per call, calibrated on the 25/09-17/10/2026 export:
 *  gpt-4o-mini salon reply ~1.8k, deepseek-flash JSON ~8-15k, full HTML ~55-90k. */
export const ESTIMATED_CREDITS_PER_CALL: Record<OneMinAiTask, number> = {
  chat: 2_000, structured: 12_000, news: 12_000, "art-text": 12_000, code: 70_000,
};

/** Share of the monthly budget past which a kind of call is no longer sent to
 *  1min.ai. Creative output (code, literary text) keeps the last of the budget;
 *  chatter and bookkeeping JSON give way first. */
export const BUDGET_SHARE_BY_TASK: Record<OneMinAiTask, number> = {
  chat: 0.15, news: 0.4, structured: 0.55, "art-text": 0.85, code: 1,
};

export function monthlyCreditBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ONE_MIN_AI_MONTHLY_CREDIT_BUDGET;
  if (raw === undefined || raw === "") return ONE_MIN_AI_DEFAULT_MONTHLY_CREDITS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : ONE_MIN_AI_DEFAULT_MONTHLY_CREDITS; // <= 0 means "no cap"
}

export function oneMinAiBudgetDecision(task: OneMinAiTask, spent: number, budget: number): { allowed: boolean; cost: number; ceiling: number } {
  const cost = ESTIMATED_CREDITS_PER_CALL[task];
  if (budget <= 0) return { allowed: true, cost, ceiling: Infinity };
  const ceiling = budget * BUDGET_SHARE_BY_TASK[task];
  return { allowed: spent + cost <= ceiling, cost, ceiling };
}

export function modelForOneMinAiTask(task: OneMinAiTask, env: NodeJS.ProcessEnv = process.env): string {
  switch (task) {
    case "code":       return env.ONE_MIN_AI_CODE_MODEL       ?? DEFAULT_CODE_MODEL;
    case "art-text":   return env.ONE_MIN_AI_ART_TEXT_MODEL   ?? env.ONE_MIN_AI_TEXT_MODEL ?? DEFAULT_CRITICAL_MODEL;
    case "structured": return env.ONE_MIN_AI_STRUCTURED_MODEL ?? DEFAULT_CRITICAL_MODEL;
    case "news":       return env.ONE_MIN_AI_NEWS_MODEL       ?? DEFAULT_CRITICAL_MODEL;
    case "chat":       return env.ONE_MIN_AI_CHAT_MODEL       ?? "gpt-4o-mini";
  }
}

function joinMessages(messages: OneMinAiMessage[]): string {
  return messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
}

export function textArtworkGuard(form?: string): string {
  switch (form) {
    case "haiku":
      return "Return only the finished haiku: exactly 3 non-empty lines, no title, explanation, notes, or markdown fences.";
    case "sonnet":
      return "Return only the finished sonnet: exactly 14 non-empty verse lines, no title, explanation, notes, or markdown fences.";
    case "manifesto":
      return "Return only the finished manifesto, under 700 words, with no explanation, notes, or markdown fences.";
    case "prose":
      return "Return only the finished prose work, 150-500 words, with no explanation, notes, or markdown fences.";
    default:
      return "Return only the finished literary work, under 700 words, with no explanation, notes, or markdown fences.";
  }
}

interface OneMinAiResponse {
  aiRecord?: {
    status?: string;
    aiRecordDetail?: { resultObject?: string[] };
  };
  error?: { code?: string; message?: string };
}

// 01/10/2026 incident: this fetch had no timeout. work-lifecycle's own
// Vercel budget is 60s (vercel.json), shared across every active work it
// processes in one tick — a single slow 1min.ai response (observed: still
// billing credits ~90s after Vercel had already force-killed the function
// on a 60s timeout) silently ate the ENTIRE invocation, leaving zero time
// for any other active work that tick and producing a bare 504 with no
// diagnostic captured anywhere. Bounding the request lets the existing
// 1min.ai → Groq fallback (stepCreating, work-lifecycle/route.ts) actually
// run instead of the whole tick dying. "code" (full HTML generation) gets a
// longer budget than the short JSON/text tasks.
const DEFAULT_TIMEOUT_MS = 20_000;
const CODE_TIMEOUT_MS    = 35_000;

export async function callOneMinAi(
  prompt: string, model: string, timeoutMs: number = DEFAULT_TIMEOUT_MS, task: OneMinAiTask = "structured",
): Promise<string | null> {
  const key = process.env.ONE_MIN_AI_API_KEY;
  if (!key) return null;

  // Charged when the request is sent, not on success: a timed-out request is
  // still billed (observed 01/10/2026). A ledger failure must never block the
  // pipeline, so an unreadable counter fails open — the Neon-side counter is
  // an estimate for pacing, not a billing source of truth.
  try {
    const decision = oneMinAiBudgetDecision(task, await getOneMinAiCreditsSpent(), monthlyCreditBudget());
    if (!decision.allowed) {
      console.warn(`[1minAI] "${task}" call skipped — estimated monthly spend would pass ${Math.round(decision.ceiling)} credits (budget share for this kind of call); falling back to Groq`);
      return null;
    }
    await addOneMinAiCredits(decision.cost);
  } catch (e) {
    console.error("[1minAI] credit ledger unavailable (call allowed):", e);
  }

  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        type:  "UNIFY_CHAT_WITH_AI",
        model,
        promptObject: { prompt },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.error(`[1minAI] ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }

    const data = await res.json() as OneMinAiResponse;
    if (data.aiRecord?.status !== "SUCCESS") {
      console.error(`[1minAI] non-success status: ${data.aiRecord?.status ?? "unknown"} ${data.error?.message ?? ""}`);
      return null;
    }
    return data.aiRecord?.aiRecordDetail?.resultObject?.[0]?.trim() || null;
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error(`[1minAI] request failed${isTimeout ? ` (timed out after ${timeoutMs}ms)` : ""}:`, e);
    return null;
  }
}

/**
 * Returns the model's reply, or null if the API key isn't configured, the
 * request fails, or the response has no usable content -- callers should
 * treat null exactly like a failed Groq call (skip this turn).
 */
export async function oneMinAiChat(
  systemPrompt: string,
  userPrompt:   string,
  opts: { model?: string } = {},
): Promise<string | null> {
  const model = opts.model ?? modelForOneMinAiTask("chat");
  return callOneMinAi(`${systemPrompt}\n\n${userPrompt}${LENGTH_GUARD}`, model, DEFAULT_TIMEOUT_MS, "chat");
}

/**
 * Same client, aimed at the code-generation step instead of salon speech: no
 * length guard, and defaults to a model actually trained on code
 * (deepseek-flash) rather than the general-purpose gpt-4o-mini used for chat
 * fallback. Returns null if unconfigured/failed -- callers fall back to Groq.
 */
export async function oneMinAiCode(
  messages: OneMinAiMessage[],
): Promise<string | null> {
  const model  = modelForOneMinAiTask("code");
  const prompt = `${joinMessages(messages)}\n\nReturn a complete but compact document. Keep the UTF-8 HTML under 18,000 bytes. Never truncate code.`;
  return callOneMinAi(prompt, model, CODE_TIMEOUT_MS, "code");
}

/** Generic critical path for prompts that already contain their complete
 * output contract (including the rare plain-text brief). */
export async function oneMinAiCritical(
  messages: OneMinAiMessage[],
  opts: { model?: string; task?: "structured" | "news"; finalInstruction?: string } = {},
): Promise<string | null> {
  const task = opts.task ?? "structured";
  const model = opts.model ?? modelForOneMinAiTask(task);
  const suffix = opts.finalInstruction ? `\n\n${opts.finalInstruction}` : "";
  return callOneMinAi(`${joinMessages(messages)}${suffix}`, model, DEFAULT_TIMEOUT_MS, task);
}

/** Primary literary-art path. 1min.ai does not expose a reliable hard output
 * token limit on this endpoint, so the guard is semantic and form-specific. */
export async function oneMinAiText(
  messages: OneMinAiMessage[],
  opts: { model?: string; form?: string } = {},
): Promise<string | null> {
  const model = opts.model ?? modelForOneMinAiTask("art-text");
  return callOneMinAi(`${joinMessages(messages)}\n\n${textArtworkGuard(opts.form)}`, model, DEFAULT_TIMEOUT_MS, "art-text");
}

/** Primary path for machine-validated outputs. The caller owns the schema and
 * must reject malformed data; this helper deliberately does not guess/repair. */
export async function oneMinAiStructured(
  messages: OneMinAiMessage[],
  opts: { model?: string; task?: "structured" | "news" } = {},
): Promise<string | null> {
  return oneMinAiCritical(messages, {
    model: opts.model,
    task: opts.task,
    finalInstruction: "Return only the requested final JSON. No markdown fences or commentary.",
  });
}
