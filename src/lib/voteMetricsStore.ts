/**
 * voteMetricsStore.ts — persistence for the per-vote metrics computed by
 * voting.ts's computeVoteMetrics(). Kept separate from voting.ts itself so
 * the actual tally/quorum/parsing logic stays a pure, DB-free module that's
 * trivial to unit test (see tests/voting.test.ts).
 */
import { query, USE_NEON } from "./db";
import type { VoteMetrics } from "./voting";

const local: Array<VoteMetrics & { workId: string; recordedAt: number }> = [];

export async function recordVoteMetrics(workId: string, metrics: VoteMetrics): Promise<void> {
  const recordedAt = Date.now();
  if (USE_NEON) {
    await query(
      `INSERT INTO vote_metrics (work_id, eligible, valid_votes, yes, no, abstain, invalid_outputs, provider_errors, retries, quorum_met, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (work_id) DO UPDATE SET
         eligible=$2, valid_votes=$3, yes=$4, no=$5, abstain=$6, invalid_outputs=$7, provider_errors=$8, retries=$9, quorum_met=$10, recorded_at=$11`,
      [workId, metrics.eligible, metrics.validVotes, metrics.yes, metrics.no, metrics.abstain,
       metrics.invalidOutputs, metrics.providerErrors, metrics.retries, metrics.quorumMet, recordedAt],
    );
  } else {
    const idx = local.findIndex(m => m.workId === workId);
    const row = { ...metrics, workId, recordedAt };
    if (idx >= 0) local[idx] = row; else local.push(row);
  }
}

export async function listRecentVoteMetrics(limit = 20): Promise<Array<VoteMetrics & { workId: string; recordedAt: number }>> {
  if (USE_NEON) {
    const rows = await query<{
      work_id: string; eligible: number; valid_votes: number; yes: number; no: number; abstain: number;
      invalid_outputs: number; provider_errors: number; retries: number; quorum_met: boolean; recorded_at: string;
    }>("SELECT * FROM vote_metrics ORDER BY recorded_at DESC LIMIT $1", [limit]);
    return rows.map(r => ({
      workId: r.work_id, eligible: r.eligible, validVotes: r.valid_votes, yes: r.yes, no: r.no, abstain: r.abstain,
      invalidOutputs: r.invalid_outputs, providerErrors: r.provider_errors, retries: r.retries,
      turnoutRatio: r.eligible > 0 ? (r.yes + r.no) / r.eligible : 0, quorumMet: r.quorum_met,
      passed: r.yes === r.no ? false : r.yes > r.no, recordedAt: Number(r.recorded_at),
    }));
  }
  return [...local].sort((a, b) => b.recordedAt - a.recordedAt).slice(0, limit);
}

/** Alert condition from the pérennité study: abstention rate > 50% or invalid-output rate > 10% across the last few votes. */
export async function checkVoteHealthAlerts(): Promise<{ highAbstention: boolean; highInvalidRate: boolean }> {
  const recent = await listRecentVoteMetrics(3);
  if (recent.length === 0) return { highAbstention: false, highInvalidRate: false };
  const avgAbstainRatio = recent.reduce((sum, m) => sum + (m.eligible > 0 ? m.abstain / m.eligible : 0), 0) / recent.length;
  const totalAttempts = recent.reduce((sum, m) => sum + m.validVotes + m.invalidOutputs, 0);
  const totalInvalid = recent.reduce((sum, m) => sum + m.invalidOutputs, 0);
  const invalidRate = totalAttempts > 0 ? totalInvalid / totalAttempts : 0;
  return { highAbstention: avgAbstainRatio > 0.5, highInvalidRate: invalidRate > 0.1 };
}
