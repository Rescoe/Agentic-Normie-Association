/**
 * Groq API wrapper with automatic retry on 429 (rate limit).
 * Reads the retry-after header and waits before retrying.
 * Falls back to exponential backoff if the header is absent.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqMessage {
  role:    "system" | "user" | "assistant";
  content: string;
}

export interface GroqBody {
  model:            string;
  messages:         GroqMessage[];
  max_tokens?:      number;
  temperature?:     number;
  // Confirmed live (23/09): openai/gpt-oss-120b (a reasoning model) fails
  // Groq's own server-side validation for this outright -- 400
  // json_validate_failed, request never even completes -- most likely because
  // its reasoning content leaks into what gets checked. Don't set this for
  // that model; ask for JSON in the prompt instead and parse the raw text
  // leniently with extractJsonObject() below.
  response_format?: { type: string };
}

/** Lenient JSON extraction from raw LLM text: strips a leading <think>...</think>
 * reasoning block if present, then tries a direct parse, falling back to the
 * substring between the first "{" and the last "}". Returns {} if nothing
 * parses -- callers already handle an empty object as "no usable data". */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return {};
}

export interface GroqMessageResponse {
  content?:          string;
  reasoning?:        string;
  reasoning_content?: string;
}
export interface GroqChatResponse {
  choices: Array<{ message: GroqMessageResponse; finish_reason?: string }>;
}

/**
 * Reads message.content only. Safe default for free-form conversational text
 * (salon speech, summaries, candidacy reasoning) where there's no structural
 * way to tell a real answer apart from raw chain-of-thought. Returns "" if
 * content is empty -- callers already treat that as "skip this turn".
 */
export function extractContent(data: GroqChatResponse): string {
  return data.choices[0]?.message?.content?.trim() ?? "";
}

/**
 * Same as extractContent(), but falls back to the model's raw reasoning field
 * when content is empty. ONLY safe for callers that immediately run the
 * result through extractJsonObject() (or an equally strict structural
 * filter): reasoning models (openai/gpt-oss-*) can spend the whole max_tokens
 * budget on internal deliberation and leave message.content empty -- Groq
 * exposes that deliberation separately (field name inconsistent across model
 * versions: reasoning / reasoning_content) -- confirmed live (23/09) on a
 * propose-work call that billed real output tokens yet came back with empty
 * content.
 *
 * Do NOT use this for plain free-text generation: confirmed live (24/09), a
 * salon message went out reading "We need to respond as Kori, following all
 * constraints... Let's craft: ..." -- the model's raw internal deliberation,
 * published verbatim, because generateSpeech() was calling this instead of
 * extractContent(). JSON extraction naturally discards non-JSON noise; free
 * text has no equivalent filter, so raw reasoning leaking through is a
 * regression, not a rare edge case.
 */
export function extractContentOrReasoning(data: GroqChatResponse): string {
  const msg = data.choices[0]?.message;
  return (msg?.content?.trim()) || (msg?.reasoning ?? msg?.reasoning_content ?? "").trim();
}

/**
 * If the model was cut off mid-response (finish_reason "length" — hit max_tokens
 * before finishing), trim back to the last complete sentence instead of publishing
 * a mid-word fragment ("...thereby anch"). Returns null when there's no usable
 * complete sentence to salvage, so the caller can skip this turn rather than post
 * a near-empty or garbled message.
 */
export function trimIfTruncated(content: string, finishReason: string | undefined): string | null {
  if (finishReason !== "length") return content;
  const lastSentenceEnd = Math.max(content.lastIndexOf("."), content.lastIndexOf("!"), content.lastIndexOf("?"));
  if (lastSentenceEnd < content.length * 0.4) return null;
  return content.slice(0, lastSentenceEnd + 1).trim();
}

export async function groqFetch(
  body:       GroqBody,
  maxRetries: number = 3,
): Promise<Response> {
  const key = process.env.GROQ_API_KEY;
  const headers = {
    "Authorization": `Bearer ${key}`,
    "Content-Type":  "application/json",
  };

  let attempt = 0;
  while (true) {
    const res = await fetch(GROQ_URL, { method: "POST", headers, body: JSON.stringify(body) });

    if (res.status !== 429) return res;

    if (attempt >= maxRetries) {
      console.error(`[groq] rate limited after ${maxRetries} retries — giving up`);
      return res;
    }

    // Confirmed live (25/09): Groq's 429 doesn't reliably carry a
    // Retry-After header for TPM (tokens-per-minute) limits -- the real wait
    // time is in the error body's message text instead ("Please try again in
    // 11.7s"). Without this, exponential backoff started at 1s, far short of
    // the ~12s actually needed, so the very next retry hit the same 429
    // again and burned the whole retry budget without ever recovering --
    // visible as a second request failing right after the first succeeded.
    // res.clone() so the body is still readable by the caller afterwards.
    let waitMs = parseFloat(res.headers.get("retry-after") ?? "0") * 1000;
    if (!waitMs) {
      try {
        const bodyText = await res.clone().text();
        const match = bodyText.match(/try again in ([\d.]+)s/i);
        if (match) waitMs = parseFloat(match[1]) * 1000;
      } catch { /* fall through to exponential backoff below */ }
    }
    if (!waitMs) waitMs = Math.min(1000 * 2 ** attempt, 30_000);

    console.warn(`[groq] 429 rate limit — waiting ${Math.round(waitMs)}ms before retry ${attempt + 1}/${maxRetries}`);
    await new Promise(r => setTimeout(r, waitMs));
    attempt++;
  }
}
