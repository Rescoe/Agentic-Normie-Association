import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake for @/lib/db's kv_store surface — the orchestrator route
// only needs kvGet/kvSet from it. Mocked so this test never touches Neon and
// never needs NEON_DB_ANA set.
const store = new Map<string, string>();
vi.mock("@/lib/db", () => ({
  kvGet: vi.fn(async (key: string) => store.get(key) ?? null),
  kvSet: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
}));

import { isTaskDue } from "../src/lib/orchestratorTasks";

describe("orchestrator isTaskDue — per-task lastSuccess tracking (29/09/2026 fix)", () => {
  beforeEach(() => store.clear());

  it("is due immediately when the task has never succeeded", async () => {
    expect(await isTaskDue("election-cycle", 6 * 60 * 60 * 1000, Date.now())).toBe(true);
  });

  it("is NOT due right after a recorded success, within the interval", async () => {
    const now = Date.now();
    store.set("orchestrator:lastSuccess:election-cycle", String(now));
    expect(await isTaskDue("election-cycle", 6 * 60 * 60 * 1000, now + 1000)).toBe(false);
  });

  it("becomes due again once the interval has elapsed since the last success", async () => {
    const now = Date.now();
    store.set("orchestrator:lastSuccess:election-cycle", String(now));
    const sixHoursLater = now + 6 * 60 * 60 * 1000 + 1;
    expect(await isTaskDue("election-cycle", 6 * 60 * 60 * 1000, sixHoursLater)).toBe(true);
  });

  it("a task that only ever ATTEMPTED (never succeeded) stays due on the very next tick — no waiting out the nominal interval", async () => {
    // This is the actual regression this fix targets: the old design wrote a
    // shared per-bucket "lastRun" BEFORE the tasks in it even ran, so a
    // failure still looked "recently run" for the group's full interval.
    // Per-task lastSuccess-only tracking means a failed task's key is simply
    // never written, so it's due again immediately.
    const now = Date.now();
    store.set("orchestrator:lastAttempt:election-cycle", String(now)); // attempted, but did NOT succeed
    expect(await isTaskDue("election-cycle", 6 * 60 * 60 * 1000, now + 1000)).toBe(true);
  });

  it("every-tick tasks (intervalMs = 0) are always due regardless of history", async () => {
    const now = Date.now();
    store.set("orchestrator:lastSuccess:activity-catchup", String(now));
    expect(await isTaskDue("activity-catchup", 0, now + 1)).toBe(true);
  });
});
