/**
 * groqDiagnostics.ts — typed classification of a Groq chat-completion result,
 * so a caller can tell "the provider is rate-limited", "the model ran out of
 * tokens mid-reasoning", "the response came back genuinely empty" and "the
 * request itself failed" apart, instead of collapsing all four into a bare
 * `false`.
 *
 * Root cause this exists for (29/09/2026 incident review — "Unburned Roots'
 * Reverie"): work-lifecycle's local groq() helper returned `string | null`,
 * and stepCreating() turned a null into a bare `false`. Four Groq outages of
 * completely different shapes (empty content after a reasoning model burned
 * its whole token budget deliberating, a real rate limit, a provider 5xx, a
 * malformed response) all produced the exact same generic message by the
 * time they reached NEEDS_RETHINK/BLOCKED_TECHNICAL: "step returned false —
 * likely a transient LLM/data issue". This module is what lets the caller
 * keep the real cause instead.
 *
 * Kept separate from src/lib/groq.ts (which owns the raw fetch/retry-on-429
 * transport) so it can be unit-tested against plain response-shaped objects
 * with no network involved.
 */

import type { GroqChatResponse } from "@/lib/groq";

export type GroqErrorCode =
  | "EMPTY_CONTENT"        // finished normally (finish_reason "stop"/other) but content is still empty — a genuine provider glitch, not a budget issue
  | "TOKEN_LIMIT_REACHED"  // finish_reason "length" — cut off before producing usable output (the classic reasoning-model-burns-its-budget case)
  | "RATE_LIMITED"         // HTTP 429
  | "PROVIDER_ERROR"       // any other non-2xx HTTP status, or the request/fetch itself threw
  | "PARSE_ERROR";         // content came back non-empty but failed the caller's own structural parse (e.g. JSON expected)

export type GroqCallOutcome =
  | { ok: true;  content: string; finishReason?: string }
  | { ok: false; code: GroqErrorCode; finishReason?: string; providerStatus?: number };

/**
 * Classifies an already-parsed Groq response body. Mirrors extractContent()/
 * extractContentOrReasoning() in groq.ts: a free-text caller (expectJson:
 * false) NEVER falls back to the model's raw reasoning field — publishing
 * that verbatim as an artwork/salon message is the exact regression
 * groq.ts's extractContentOrReasoning() doc comment already warns about.
 */
export function diagnoseGroqResult(data: GroqChatResponse, opts: { expectJson: boolean }): GroqCallOutcome {
  const choice       = data.choices?.[0];
  const finishReason = choice?.finish_reason;
  const message      = choice?.message;
  const content      = (message?.content ?? "").trim();
  const reasoning    = (message?.reasoning ?? message?.reasoning_content ?? "").trim();

  const usable = opts.expectJson ? (content || reasoning) : content;
  if (usable) return { ok: true, content: usable, finishReason };

  if (finishReason === "length") return { ok: false, code: "TOKEN_LIMIT_REACHED", finishReason };
  return { ok: false, code: "EMPTY_CONTENT", finishReason };
}

/** RATE_LIMITED and PROVIDER_ERROR are worth one immediate bounded retry —
 * TOKEN_LIMIT_REACHED/EMPTY_CONTENT/PARSE_ERROR would almost certainly
 * reproduce identically on an immediate retry with the same prompt/budget. */
export function isTransientGroqError(code: GroqErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "PROVIDER_ERROR";
}

/** Maps an HTTP failure (non-2xx response, never reached JSON parsing) to a code. */
export function classifyGroqHttpFailure(status: number): GroqErrorCode {
  return status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
}
