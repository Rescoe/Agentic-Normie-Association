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
  response_format?: { type: string };
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

    const retryAfter = parseFloat(res.headers.get("retry-after") ?? "0");
    const waitMs     = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 30_000);
    console.warn(`[groq] 429 rate limit — waiting ${Math.round(waitMs)}ms before retry ${attempt + 1}/${maxRetries}`);
    await new Promise(r => setTimeout(r, waitMs));
    attempt++;
  }
}
