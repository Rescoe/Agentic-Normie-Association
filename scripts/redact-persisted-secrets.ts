/**
 * One-shot cleanup for secrets already persisted before redact.ts existed —
 * 29/09/2026 incident: an RPC provider URL (Alchemy key included) ended up in
 * an ANAWork's validationNote / stateHistory notes and was served verbatim by
 * the public GET /api/works. workStore.ts now redacts at write time going
 * forward (see updateWork()/advanceState()); this script cleans up rows that
 * predate that fix.
 *
 * Idempotent: redactSecrets() is idempotent, and this script only ever
 * rewrites a row when redaction actually changes something, so running it
 * twice in a row touches zero rows the second time.
 *
 * NEVER prints a secret value — only which key/field would change and by how
 * many characters. Defaults to dry-run; pass --apply to actually write.
 *
 * Usage:
 *   npm run db:migrate -- # (unrelated — this is a separate script)
 *   npx ts-node --transpile-only scripts/redact-persisted-secrets.ts            # dry run
 *   npx ts-node --transpile-only scripts/redact-persisted-secrets.ts --apply    # apply
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const { USE_NEON, getNeonHost, kvListByPrefix, kvSet, query } = await import("../src/lib/db");
  const { redactSecrets } = await import("../src/lib/redact");

  if (!USE_NEON) {
    console.error("[redact-persisted-secrets] No Neon connection string found (NEON_DB_ANA / ...). Aborting.");
    process.exit(1);
  }
  console.log(`[redact-persisted-secrets] Target host: ${getNeonHost()}`);
  console.log(`[redact-persisted-secrets] Mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes — pass --apply to write)"}`);

  // ── kv_store: work:* rows (validationNote, operationalErrorMessage, stateHistory[].note) ──
  const workRows = await kvListByPrefix("work:");
  let workRowsTouched = 0;
  let workFieldsTouched = 0;

  for (const { key, value } of workRows) {
    let work: Record<string, unknown>;
    try { work = JSON.parse(value); } catch { continue; }

    let changed = false;
    const before = { ...work };

    for (const field of ["validationNote", "operationalErrorMessage"] as const) {
      const raw = work[field];
      if (typeof raw === "string") {
        const cleaned = redactSecrets(raw);
        if (cleaned !== raw) { work[field] = cleaned; changed = true; workFieldsTouched++; }
      }
    }

    if (Array.isArray(work.stateHistory)) {
      for (const entry of work.stateHistory as Array<Record<string, unknown>>) {
        if (typeof entry.note === "string") {
          const cleaned = redactSecrets(entry.note);
          if (cleaned !== entry.note) { entry.note = cleaned; changed = true; workFieldsTouched++; }
        }
      }
    }

    if (!changed) continue;
    workRowsTouched++;
    const changedFields = (["validationNote", "operationalErrorMessage"] as const).filter(f => before[f] !== work[f]);
    console.log(`[redact-persisted-secrets] ${key}: would redact ${changedFields.join(", ") || "stateHistory note(s)"}${APPLY ? " — writing" : ""}`);
    if (APPLY) await kvSet(key, JSON.stringify(work));
  }

  // ── dev_requests: problem / evidence / proposed_solution / human_response ──
  // These quote error text verbatim too (promoteOrCreateFromSynthesis /
  // devRequests.ts callers pass raw reason strings through).
  let devRequestRowsTouched = 0;
  try {
    const rows = await query<{ id: string; problem: string; evidence: unknown; proposed_solution: string | null; human_response: string | null }>(
      "SELECT id, problem, evidence, proposed_solution, human_response FROM dev_requests",
    );
    for (const row of rows) {
      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      const cleanedProblem = redactSecrets(row.problem ?? "");
      if (cleanedProblem !== row.problem) { updates.push(`problem = $${idx++}`); params.push(cleanedProblem); }

      const cleanedSolution = row.proposed_solution ? redactSecrets(row.proposed_solution) : row.proposed_solution;
      if (cleanedSolution !== row.proposed_solution) { updates.push(`proposed_solution = $${idx++}`); params.push(cleanedSolution); }

      const cleanedResponse = row.human_response ? redactSecrets(row.human_response) : row.human_response;
      if (cleanedResponse !== row.human_response) { updates.push(`human_response = $${idx++}`); params.push(cleanedResponse); }

      let cleanedEvidence: unknown = row.evidence;
      let evidenceChanged = false;
      if (Array.isArray(row.evidence)) {
        cleanedEvidence = row.evidence.map(e => {
          if (typeof e !== "string") return e;
          const c = redactSecrets(e);
          if (c !== e) evidenceChanged = true;
          return c;
        });
        if (evidenceChanged) { updates.push(`evidence = $${idx++}`); params.push(JSON.stringify(cleanedEvidence)); }
      }

      if (updates.length === 0) continue;
      devRequestRowsTouched++;
      console.log(`[redact-persisted-secrets] dev_requests#${row.id}: would redact ${updates.map(u => u.split(" =")[0]).join(", ")}${APPLY ? " — writing" : ""}`);
      if (APPLY) {
        params.push(row.id);
        await query(`UPDATE dev_requests SET ${updates.join(", ")} WHERE id = $${idx}`, params);
      }
    }
  } catch (e) {
    console.warn(`[redact-persisted-secrets] dev_requests sweep skipped (table may not exist yet): ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(`[redact-persisted-secrets] Done. work: rows touched=${workRowsTouched} (fields=${workFieldsTouched}) · dev_requests rows touched=${devRequestRowsTouched}.`);
  if (!APPLY && (workRowsTouched > 0 || devRequestRowsTouched > 0)) {
    console.log("[redact-persisted-secrets] Re-run with --apply to write these changes.");
  }
}

main().catch(e => {
  console.error("[redact-persisted-secrets] FAILED:", e);
  process.exit(1);
});
