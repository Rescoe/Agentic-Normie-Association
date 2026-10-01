import { describe, it, expect, vi, beforeEach } from "vitest";

// 01/10/2026 incident: two overlapping work-lifecycle invocations both
// reached the on-chain publishing steps for the same work, racing the
// relayer wallet's nonce (observed live: "replacement transaction
// underpriced", then a different submission rejected once the nonce no
// longer matched). publishLock.ts's atomic INSERT ... ON CONFLICT ... WHERE
// is what prevents this — these tests lock down its three outcomes.

let mockRows: Array<{ key: string }> = [];
const sqlTag = vi.fn(async (..._args: unknown[]) => mockRows);

vi.mock("@/lib/db", () => ({
  USE_NEON: true,
  sql: () => sqlTag,
}));

describe("publishLock — atomic per-work lock", () => {
  beforeEach(() => {
    mockRows = [];
    sqlTag.mockClear();
  });

  it("acquires the lock when free (INSERT/UPDATE returns the row)", async () => {
    mockRows = [{ key: "publish-lock:w1" }];
    const { tryAcquirePublishLock } = await import("../src/lib/publishLock");
    expect(await tryAcquirePublishLock("w1")).toBe(true);
    expect(sqlTag).toHaveBeenCalledTimes(1);
  });

  it("refuses to acquire when another holder's lock is still fresh (no row returned)", async () => {
    mockRows = [];
    const { tryAcquirePublishLock } = await import("../src/lib/publishLock");
    expect(await tryAcquirePublishLock("w1")).toBe(false);
  });

  it("fails open (acquires) if the lock query itself throws — a DB hiccup must never wedge publishing", async () => {
    sqlTag.mockImplementationOnce(() => { throw new Error("db unavailable"); });
    const { tryAcquirePublishLock } = await import("../src/lib/publishLock");
    expect(await tryAcquirePublishLock("w1")).toBe(true);
  });

  it("release is a safe no-op even if the delete query throws", async () => {
    sqlTag.mockImplementationOnce(() => { throw new Error("db unavailable"); });
    const { releasePublishLock } = await import("../src/lib/publishLock");
    await expect(releasePublishLock("w1")).resolves.toBeUndefined();
  });
});
