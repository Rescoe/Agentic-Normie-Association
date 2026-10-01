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

export async function callOneMinAi(prompt: string, model: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string | null> {
  const key = process.env.ONE_MIN_AI_API_KEY;
  if (!key) return null;

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
  return callOneMinAi(`${systemPrompt}\n\n${userPrompt}${LENGTH_GUARD}`, model);
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
  return callOneMinAi(prompt, model, CODE_TIMEOUT_MS);
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
  return callOneMinAi(`${joinMessages(messages)}${suffix}`, model);
}

/** Primary literary-art path. 1min.ai does not expose a reliable hard output
 * token limit on this endpoint, so the guard is semantic and form-specific. */
export async function oneMinAiText(
  messages: OneMinAiMessage[],
  opts: { model?: string; form?: string } = {},
): Promise<string | null> {
  const model = opts.model ?? modelForOneMinAiTask("art-text");
  return callOneMinAi(`${joinMessages(messages)}\n\n${textArtworkGuard(opts.form)}`, model);
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
