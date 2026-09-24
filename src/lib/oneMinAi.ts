/**
 * oneMinAi.ts — thin client for 1min.ai's "Chat with AI API" (UNIFY_CHAT_WITH_AI),
 * used as a fallback when Groq fails outright (after Groq's own 429 retries are
 * exhausted) so salon conversations don't just go silent on a bad Groq day.
 *
 * Unlike Groq's /v1/chat/completions, this API has no separate system/user
 * message roles -- just one `prompt` string per request. System + user prompts
 * are concatenated by the caller. Conversation history/memory (conversationId)
 * is deliberately not used here: this app already builds full context into the
 * prompt text itself (recent messages, summaries — see salon-exchange.ts), the
 * same stateless-per-call shape Groq is already used with.
 */

const CHAT_URL = "https://api.1min.ai/api/chat-with-ai";

interface OneMinAiResponse {
  aiRecord?: {
    status?: string;
    aiRecordDetail?: { resultObject?: string[] };
  };
  error?: { code?: string; message?: string };
}

/**
 * Returns the model's reply, or null if the API key isn't configured, the
 * request fails, or the response has no usable content -- callers should
 * treat null exactly like a failed Groq call (skip this turn).
 */
export async function oneMinAiChat(
  systemPrompt: string,
  userPrompt:   string,
  opts: { model?: string; maxTokens?: number } = {},
): Promise<string | null> {
  const key = process.env.ONE_MIN_AI_API_KEY;
  if (!key) return null;

  const model = opts.model ?? process.env.ONE_MIN_AI_CHAT_MODEL ?? "gpt-4o-mini";

  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        type:  "UNIFY_CHAT_WITH_AI",
        model,
        promptObject: {
          // No system/user split in this API -- concatenated into one prompt.
          prompt: `${systemPrompt}\n\n${userPrompt}`,
        },
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
