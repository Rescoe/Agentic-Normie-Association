import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callOneMinAi, isDefinitelyUnbilled, probeOneMinAi, readOneMinAiHealth, requestOneMinAi, type OneMinAiOutcome,
} from "../src/lib/oneMinAi";
import { getOneMinAiCreditsSpent, refundOneMinAiCredits, setOneMinAiCreditsSpent, addOneMinAiCredits } from "../src/lib/llmLedger";
import { resetSoftKvMemory } from "../src/lib/softKv";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const success = (text: string) => jsonResponse(200, { aiRecord: { status: "SUCCESS", aiRecordDetail: { resultObject: [text] } } });

describe("requestOneMinAi — what the provider actually answered", () => {
  it("parses a SUCCESS record", async () => {
    const out = await requestOneMinAi("hi", "m", "k", 1000, (async () => success(" OK ")) as unknown as typeof fetch);
    expect(out).toEqual({ ok: true, text: "OK" });
  });

  it("keeps the provider's own error code and message for an HTTP failure", async () => {
    const out = await requestOneMinAi("hi", "m", "k", 1000, (async () => jsonResponse(401, { errorCode: "INVALID_API_KEY", message: "Invalid API Key" })) as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: false, kind: "http", status: 401, code: "INVALID_API_KEY", message: "Invalid API Key" });
  });

  it("flags a non-SUCCESS record and an empty SUCCESS record differently", async () => {
    const rec = await requestOneMinAi("hi", "m", "k", 1000, (async () => jsonResponse(200, { aiRecord: { status: "FAILED" }, error: { message: "no credits" } })) as unknown as typeof fetch);
    expect(rec).toMatchObject({ ok: false, kind: "record", code: "FAILED", message: "no credits" });
    const empty = await requestOneMinAi("hi", "m", "k", 1000, (async () => jsonResponse(200, { aiRecord: { status: "SUCCESS", aiRecordDetail: { resultObject: [""] } } })) as unknown as typeof fetch);
    expect(empty).toMatchObject({ ok: false, kind: "empty" });
  });

  it("reports a network error instead of throwing", async () => {
    const out = await requestOneMinAi("hi", "m", "k", 1000, (async () => { throw new Error("boom"); }) as unknown as typeof fetch);
    expect(out).toMatchObject({ ok: false, kind: "network", message: "boom" });
  });
});

describe("isDefinitelyUnbilled", () => {
  const fail = (o: Partial<OneMinAiOutcome> & { kind: string }) => ({ ok: false, message: "x", ...o }) as OneMinAiOutcome;
  it("refunds only what the provider refused outright", () => {
    expect(isDefinitelyUnbilled(fail({ kind: "http", status: 401 }))).toBe(true);
    expect(isDefinitelyUnbilled(fail({ kind: "http", status: 429 }))).toBe(true);
    expect(isDefinitelyUnbilled(fail({ kind: "http", status: 503 }))).toBe(true);
    expect(isDefinitelyUnbilled(fail({ kind: "record", code: "FAILED" }))).toBe(true);
  });
  it("keeps the charge when the request may have been processed", () => {
    expect(isDefinitelyUnbilled(fail({ kind: "http", status: 504 }))).toBe(false);
    expect(isDefinitelyUnbilled(fail({ kind: "timeout" }))).toBe(false);
    expect(isDefinitelyUnbilled(fail({ kind: "network" }))).toBe(false);
    expect(isDefinitelyUnbilled(fail({ kind: "empty" }))).toBe(false);
    expect(isDefinitelyUnbilled({ ok: true, text: "fine" })).toBe(false);
  });
});

describe("callOneMinAi — the monthly estimate follows real cost", () => {
  beforeEach(() => {
    process.env.ONE_MIN_AI_API_KEY = "test-key";
    resetSoftKvMemory();
  });
  afterEach(() => {
    delete process.env.ONE_MIN_AI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("gives the estimate back when the provider rejects the call, and records why", async () => {
    await setOneMinAiCreditsSpent(0);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { errorCode: "UNSUPPORTED_MODEL", message: "model not found" })));
    const text = await callOneMinAi("hello", "no-such-model", 1000, "structured");
    expect(text).toBeNull();
    expect(await getOneMinAiCreditsSpent()).toBe(0);
    const health = await readOneMinAiHealth();
    expect(health.lastError).toMatchObject({ kind: "http", status: 400, code: "UNSUPPORTED_MODEL", model: "no-such-model", task: "structured" });
  });

  it("keeps the charge on a success and on a timeout", async () => {
    await setOneMinAiCreditsSpent(0);
    vi.stubGlobal("fetch", vi.fn(async () => success("done")));
    expect(await callOneMinAi("hello", "m", 1000, "structured")).toBe("done");
    expect(await getOneMinAiCreditsSpent()).toBe(12_000);
    expect((await readOneMinAiHealth()).lastSuccessAt).toBeGreaterThan(0);

    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }));
    expect(await callOneMinAi("hello", "m", 1000, "structured")).toBeNull();
    expect(await getOneMinAiCreditsSpent()).toBe(24_000);
  });

  it("redacts secrets from the stored error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { message: "upstream https://base-mainnet.g.alchemy.com/v2/abcDEF1234567890abcDEF1234567890 failed" })));
    await callOneMinAi("hello", "m", 1000, "chat");
    const stored = JSON.stringify((await readOneMinAiHealth()).lastError);
    expect(stored).not.toContain("abcDEF1234567890abcDEF1234567890");
  });
});

describe("ledger helpers", () => {
  it("never refunds below zero and can be set to a real figure", async () => {
    await setOneMinAiCreditsSpent(5_000);
    await refundOneMinAiCredits(12_000);
    expect(await getOneMinAiCreditsSpent()).toBe(0);
    await addOneMinAiCredits(2_000);
    expect(await setOneMinAiCreditsSpent(1_234.6)).toBe(2_000);
    expect(await getOneMinAiCreditsSpent()).toBe(1_235);
  });
});

describe("probeOneMinAi", () => {
  afterEach(() => { delete process.env.ONE_MIN_AI_API_KEY; vi.unstubAllGlobals(); });
  it("says so when no key is configured", async () => {
    delete process.env.ONE_MIN_AI_API_KEY;
    expect((await probeOneMinAi())[0]).toMatchObject({ ok: false, kind: "no-key" });
  });
  it("reports one line per model with the provider's error", async () => {
    process.env.ONE_MIN_AI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, init: { body: string }) => {
      const model = JSON.parse(init.body).model as string;
      return model === "good" ? success("OK") : jsonResponse(400, { errorCode: "BAD_MODEL", message: "nope" });
    }));
    const res = await probeOneMinAi(["good", "bad"]);
    expect(res[0]).toMatchObject({ model: "good", ok: true, reply: "OK" });
    expect(res[1]).toMatchObject({ model: "bad", ok: false, status: 400, code: "BAD_MODEL" });
  });
});
