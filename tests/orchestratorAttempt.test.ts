import { describe, it, expect } from "vitest";
import { classifyOrchestratorAttempt } from "../src/lib/orchestratorAttempt";

describe("classifyOrchestratorAttempt — mirrors orchestrator.yml's retry decision", () => {
  it("HTTP 200 with ok:true is success", () => {
    expect(classifyOrchestratorAttempt(200, true)).toBe("success");
  });

  it("HTTP 207 (partial failure) is a hard fail, even though it's a well-formed 2xx-adjacent response — never retried, never treated as success", () => {
    expect(classifyOrchestratorAttempt(207, false)).toBe("hard-fail");
    // Even a malformed body that somehow reports ok:true on a 207 must not
    // slip through as success — the orchestrator itself only ever sends
    // ok:true with HTTP 200 (see src/app/api/keeper/orchestrator/route.ts).
    expect(classifyOrchestratorAttempt(207, true)).toBe("hard-fail");
  });

  it("a transport failure (curl itself failed → status 0) is retried", () => {
    expect(classifyOrchestratorAttempt(0, undefined)).toBe("retry");
  });

  it("an unexpected 5xx (platform-level failure, never sent deliberately by the route) is retried", () => {
    expect(classifyOrchestratorAttempt(504, undefined)).toBe("retry");
  });

  it("HTTP 200 but a body that didn't parse as JSON (ok undefined) is retried, not treated as success", () => {
    expect(classifyOrchestratorAttempt(200, undefined)).toBe("retry");
  });
});
