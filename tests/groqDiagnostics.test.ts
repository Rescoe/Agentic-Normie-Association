import { describe, it, expect } from "vitest";
import { diagnoseGroqResult, isTransientGroqError, classifyGroqHttpFailure } from "../src/lib/groqDiagnostics";
import type { GroqChatResponse } from "../src/lib/groq";

function response(message: Partial<GroqChatResponse["choices"][number]["message"]>, finish_reason?: string): GroqChatResponse {
  return { choices: [{ message, finish_reason }] };
}

describe("diagnoseGroqResult — 29/09/2026 'Unburned Roots' Reverie' incident fix", () => {
  it("regression test #5: finish_reason=length with empty content produces a precise code, never a bare false", () => {
    const data = response({ content: "" }, "length");
    const outcome = diagnoseGroqResult(data, { expectJson: false });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("TOKEN_LIMIT_REACHED");
      expect(outcome.finishReason).toBe("length");
    }
  });

  it("a genuinely empty response with a normal finish reason is EMPTY_CONTENT, not TOKEN_LIMIT_REACHED", () => {
    const data = response({ content: "" }, "stop");
    const outcome = diagnoseGroqResult(data, { expectJson: false });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("EMPTY_CONTENT");
  });

  it("regression test #6: a free-text (expectJson:false) caller NEVER falls back to raw reasoning, even if content is empty and reasoning is present", () => {
    // This is exactly the earlier confirmed-live regression (24/09/2026) this
    // module's doc comment references: a reasoning model's internal
    // deliberation must never be published as if it were the actual haiku/poem.
    const data = response({ content: "", reasoning: "We need to craft a haiku about..." }, "stop");
    const outcome = diagnoseGroqResult(data, { expectJson: false });
    expect(outcome.ok).toBe(false); // never "ok" with the raw reasoning as content
  });

  it("a JSON-expecting caller MAY use the reasoning fallback (existing, intentional behavior for vote/curator calls)", () => {
    const data = response({ content: "", reasoning: '{"vote":"yes","reason":"solid piece"}' }, "length");
    const outcome = diagnoseGroqResult(data, { expectJson: true });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.content).toContain('"vote":"yes"');
  });

  it("real content always wins regardless of expectJson", () => {
    const data = response({ content: "autumn wind / the empty nest still / holds a feather" }, "stop");
    const outcome = diagnoseGroqResult(data, { expectJson: false });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.content).toBe("autumn wind / the empty nest still / holds a feather");
  });
});

describe("isTransientGroqError / classifyGroqHttpFailure", () => {
  it("rate limit and provider error are transient (worth one retry)", () => {
    expect(isTransientGroqError("RATE_LIMITED")).toBe(true);
    expect(isTransientGroqError("PROVIDER_ERROR")).toBe(true);
  });

  it("empty content / token limit / parse error are NOT transient (retrying would just reproduce them)", () => {
    expect(isTransientGroqError("EMPTY_CONTENT")).toBe(false);
    expect(isTransientGroqError("TOKEN_LIMIT_REACHED")).toBe(false);
    expect(isTransientGroqError("PARSE_ERROR")).toBe(false);
  });

  it("classifies HTTP 429 as RATE_LIMITED and anything else as PROVIDER_ERROR", () => {
    expect(classifyGroqHttpFailure(429)).toBe("RATE_LIMITED");
    expect(classifyGroqHttpFailure(500)).toBe("PROVIDER_ERROR");
    expect(classifyGroqHttpFailure(503)).toBe("PROVIDER_ERROR");
  });
});
