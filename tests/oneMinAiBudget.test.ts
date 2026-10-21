import { describe, it, expect } from "vitest";
import {
  oneMinAiBudgetDecision, monthlyCreditBudget, ESTIMATED_CREDITS_PER_CALL,
  ONE_MIN_AI_DEFAULT_MONTHLY_CREDITS,
} from "../src/lib/oneMinAi";
import { addOneMinAiCredits, getOneMinAiCreditsSpent } from "../src/lib/llmLedger";

describe("1min.ai monthly credit governor", () => {
  it("defaults to a 1M-credit month and honors the env override", () => {
    expect(monthlyCreditBudget({} as NodeJS.ProcessEnv)).toBe(ONE_MIN_AI_DEFAULT_MONTHLY_CREDITS);
    expect(monthlyCreditBudget({ ONE_MIN_AI_MONTHLY_CREDIT_BUDGET: "250000" } as unknown as NodeJS.ProcessEnv)).toBe(250_000);
    expect(monthlyCreditBudget({ ONE_MIN_AI_MONTHLY_CREDIT_BUDGET: "abc" } as unknown as NodeJS.ProcessEnv)).toBe(ONE_MIN_AI_DEFAULT_MONTHLY_CREDITS);
  });

  it("allows everything on a fresh month", () => {
    for (const task of Object.keys(ESTIMATED_CREDITS_PER_CALL) as Array<keyof typeof ESTIMATED_CREDITS_PER_CALL>) {
      expect(oneMinAiBudgetDecision(task, 0, 1_000_000).allowed).toBe(true);
    }
  });

  it("drops chatter first, bookkeeping JSON next, and keeps the last credits for code", () => {
    const budget = 1_000_000;
    expect(oneMinAiBudgetDecision("chat", 150_000, budget).allowed).toBe(false);
    expect(oneMinAiBudgetDecision("structured", 150_000, budget).allowed).toBe(true);
    expect(oneMinAiBudgetDecision("structured", 545_000, budget).allowed).toBe(false);
    expect(oneMinAiBudgetDecision("art-text", 545_000, budget).allowed).toBe(true);
    expect(oneMinAiBudgetDecision("code", 900_000, budget).allowed).toBe(true);
    expect(oneMinAiBudgetDecision("code", 935_000, budget).allowed).toBe(false);
  });

  it("never lets spend cross the budget, whatever the kind of call", () => {
    for (const task of Object.keys(ESTIMATED_CREDITS_PER_CALL) as Array<keyof typeof ESTIMATED_CREDITS_PER_CALL>) {
      expect(oneMinAiBudgetDecision(task, 1_000_000, 1_000_000).allowed).toBe(false);
    }
  });

  it("treats a non-positive budget as uncapped", () => {
    expect(oneMinAiBudgetDecision("code", 50_000_000, 0).allowed).toBe(true);
  });

  it("accumulates estimated credits in the ledger", async () => {
    const before = await getOneMinAiCreditsSpent();
    await addOneMinAiCredits(12_000);
    await addOneMinAiCredits(2_000);
    expect(await getOneMinAiCreditsSpent()).toBe(before + 14_000);
  });
});
