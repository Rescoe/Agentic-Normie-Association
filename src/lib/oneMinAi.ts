/**
 * oneMinAi.ts — thin client for 1min.ai's "Chat with AI API" (UNIFY_CHAT_WITH_AI).
 * Two call sites, two different needs, sharing the same low-level request:
 *
 * - oneMinAiChat(): fallback when Groq fails outright for salon speech (after
 *   Groq's own 429 retries are exhausted), so conversations don't go silent
 *   on a bad Groq day. Replies are kept short via LENGTH_GUARD.
 * - oneMinAiCode(): primary model for the HTML/code generation step of
 *   stepCreating() (work-lifecycle route) — a model actually trained on code
 *   instead of the Groq reasoning model used everywhere else. No length
 *   guard (needs the full HTML), falls back to Groq on failure.
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

interface OneMinAiResponse {
  aiRecord?: {
    status?: string;
    aiRecordDetail?: { resultObject?: string[] };
  };
  error?: { code?: string; message?: string };
}

async function callOneMinAi(prompt: string, model: string): Promise<string | null> {
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
    console.error("[1minAI] request failed:", e);
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
  const model = opts.model ?? process.env.ONE_MIN_AI_CHAT_MODEL ?? "gpt-4o-mini";
  return callOneMinAi(`${systemPrompt}\n\n${userPrompt}${LENGTH_GUARD}`, model);
}

/**
 * Same client, aimed at the code-generation step instead of salon speech: no
 * length guard, and defaults to a model actually trained on code
 * (deepseek-flash) rather than the general-purpose gpt-4o-mini used for chat
 * fallback. Returns null if unconfigured/failed -- callers fall back to Groq.
 */
export async function oneMinAiCode(
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<string | null> {
  const model  = process.env.ONE_MIN_AI_CODE_MODEL ?? DEFAULT_CODE_MODEL;
  const prompt = messages.map(m => m.content).join("\n\n");
  return callOneMinAi(prompt, model);
}
