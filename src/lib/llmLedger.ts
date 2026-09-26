/**
 * llmLedger.ts — a small internal ledger of LLM calls (provider, model, task,
 * success/failure/retry counts), independent of any provider's own billing
 * dashboard. Section 11/9 of the pérennisation study: "ne prétends pas
 * mesurer exactement les CU-h Neon sans API officielle" applies just as much
 * to LLM spend — this is a cheap, best-effort internal counter, not a source
 * of truth for what Groq/1min.ai actually billed.
 *
 * One row per (month, provider, model, task), incremented in place — this is
 * intentionally the same "small dedicated row, not a growing blob" shape as
 * burn-supply-tracker in workStore.ts, for the same cost reason: a call
 * counter must never cost more to update than the thing it's counting.
 *
 * Storage: relational (llm_ledger table, see migrations.ts) in Neon mode;
 * an in-memory Map in local dev (no Neon configured) — never persisted, which
 * is fine since local dev has no real budget to track.
 */
import { query, USE_NEON } from "./db";

export type LlmProvider = "groq" | "1minai";
export type LlmTask =
  | "salon-speech" | "vote" | "candidacy" | "propose-work" | "brief"
  | "creating" | "curation" | "synthesis" | "critique" | "fingerprint" | "other";

export interface LlmCallOutcome {
  provider:  LlmProvider;
  model:     string;
  task:      LlmTask;
  success:   boolean;
  retries?:  number;
  tokensEst?: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

const localLedger = new Map<string, { calls: number; successes: number; failures: number; retries: number; tokensEst: number }>();

function localKey(month: string, provider: string, model: string, task: string): string {
  return `${month}:${provider}:${model}:${task}`;
}

/** Records one LLM call attempt. Never throws — a ledger write failing must never break the caller's actual work. */
export async function recordLlmCall(outcome: LlmCallOutcome): Promise<void> {
  const month = currentMonth();
  const retries = outcome.retries ?? 0;
  const tokensEst = outcome.tokensEst ?? 0;

  try {
    if (USE_NEON) {
      await query(
        `INSERT INTO llm_ledger (month, provider, model, task, calls, successes, failures, retries, tokens_est)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8)
         ON CONFLICT (month, provider, model, task) DO UPDATE SET
           calls      = llm_ledger.calls + 1,
           successes  = llm_ledger.successes + $5,
           failures   = llm_ledger.failures + $6,
           retries    = llm_ledger.retries + $7,
           tokens_est = llm_ledger.tokens_est + $8`,
        [month, outcome.provider, outcome.model, outcome.task, outcome.success ? 1 : 0, outcome.success ? 0 : 1, retries, tokensEst],
      );
    } else {
      const key = localKey(month, outcome.provider, outcome.model, outcome.task);
      const cur = localLedger.get(key) ?? { calls: 0, successes: 0, failures: 0, retries: 0, tokensEst: 0 };
      cur.calls++;
      if (outcome.success) cur.successes++; else cur.failures++;
      cur.retries += retries;
      cur.tokensEst += tokensEst;
      localLedger.set(key, cur);
    }
  } catch (e) {
    console.error("[llmLedger] recordLlmCall failed (non-fatal):", e);
  }
}

export interface LedgerRow {
  month: string; provider: string; model: string; task: string;
  calls: number; successes: number; failures: number; retries: number; tokensEst: number;
}

export async function getLedgerForMonth(month: string = currentMonth()): Promise<LedgerRow[]> {
  if (USE_NEON) {
    const rows = await query<{
      month: string; provider: string; model: string; task: string;
      calls: number; successes: number; failures: number; retries: number; tokens_est: number;
    }>("SELECT * FROM llm_ledger WHERE month = $1 ORDER BY provider, model, task", [month]);
    return rows.map(r => ({ ...r, tokensEst: Number(r.tokens_est) }));
  }
  return [...localLedger.entries()]
    .filter(([k]) => k.startsWith(month + ":"))
    .map(([k, v]) => {
      const [, provider, model, task] = k.split(":");
      return { month, provider, model, task, ...v };
    });
}

// ─── Provider budget / economy-mode ────────────────────────────────────────
//
// Monthly caps are configured via env (no hardcoded provider prices — the
// audits are explicit that pricing must never be a silent hardcoded guess).
// When unset, budget checks are always "under budget" — i.e. this degrades to
// a no-op unless the operator has actually set a cap.

function monthlyCap(envVar: string): number | null {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Returns the fraction of the configured monthly call budget for `provider`
 * that's already been used this month (0 if no cap is configured — i.e.
 * "not over budget" by construction). Counts CALLS, not real cost, since no
 * verified per-provider price is available without an operator-supplied cap
 * — see this file's header and section 11 of the pérennité study.
 */
export async function providerBudgetUsedRatio(provider: LlmProvider): Promise<number> {
  const capEnvVar = provider === "groq" ? "ANA_GROQ_MONTHLY_CALL_CAP" : "ANA_ONEMINAI_MONTHLY_CALL_CAP";
  const cap = monthlyCap(capEnvVar);
  if (cap == null) return 0;
  const rows = await getLedgerForMonth().catch(() => [] as LedgerRow[]);
  const used = rows.filter(r => r.provider === provider).reduce((sum, r) => sum + r.calls, 0);
  return used / cap;
}

/**
 * True once 1min.ai's configured monthly budget crosses 70% — callers (salon
 * exchange's responder provider pick, stepCreating's code-model choice)
 * should prefer Groq instead once this is true, per the pérennité study's
 * "bascule automatique vers Groq à 70% puis 90%". Silent no-op (always
 * false) if no cap is configured.
 */
export async function shouldPreferEconomyProvider(): Promise<boolean> {
  const ratio = await providerBudgetUsedRatio("1minai");
  return ratio >= 0.7;
}
