import { describe, it, expect, vi, afterEach } from "vitest";

// 01/10/2026 incident: neither groqFetch nor callOneMinAi had a request
// timeout — a single slow provider response could silently consume the
// entire 60s Vercel budget for work-lifecycle, leaving zero time for any
// other active work that tick (observed: a 1min.ai call still billing
// credits ~90s after Vercel had already force-killed the function). These
// tests assert the fix's actual contract: a request that never resolves
// still produces a safe, non-throwing result within a bounded time, so the
// existing fallback logic gets a chance to run.

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; vi.unstubAllGlobals(); });

/** A fetch mock that honors the AbortSignal passed to it — matching real
 * fetch() behavior — but otherwise never resolves on its own, simulating a
 * provider that simply never responds. */
function neverRespondingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal) {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }
    // deliberately never resolves otherwise
  }));
}

describe("groqFetch — bounded request timeout", () => {
  it("never hangs indefinitely and never throws — degrades to a non-ok Response", async () => {
    global.fetch = neverRespondingFetch() as unknown as typeof fetch;
    const { groqFetch } = await import("../src/lib/groq");

    const res = await groqFetch({ model: "m", messages: [{ role: "user", content: "hi" }] }, 0, 50);
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("passes an AbortSignal to fetch so a real network layer can actually cancel the request", async () => {
    const mock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });
    global.fetch = mock as unknown as typeof fetch;
    const { groqFetch } = await import("../src/lib/groq");
    const res = await groqFetch({ model: "m", messages: [] });
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("callOneMinAi — bounded request timeout", () => {
  it("never hangs indefinitely and never throws — resolves to null", async () => {
    global.fetch = neverRespondingFetch() as unknown as typeof fetch;
    vi.stubEnv("ONE_MIN_AI_API_KEY", "test-key");
    const { callOneMinAi } = await import("../src/lib/oneMinAi");

    const result = await callOneMinAi("prompt", "deepseek-flash", 50);
    expect(result).toBeNull();
  });

  it("passes an AbortSignal to fetch", async () => {
    const mock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ aiRecord: { status: "SUCCESS", aiRecordDetail: { resultObject: ["hi"] } } }), { status: 200 });
    });
    global.fetch = mock as unknown as typeof fetch;
    vi.stubEnv("ONE_MIN_AI_API_KEY", "test-key");
    const { callOneMinAi } = await import("../src/lib/oneMinAi");
    const result = await callOneMinAi("prompt", "deepseek-flash");
    expect(result).toBe("hi");
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
