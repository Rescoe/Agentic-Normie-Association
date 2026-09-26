/**
 * migrations.ts — explicit, idempotent schema migrations for the relational
 * stores added by the Sept 2026 "pérennisation" work (salon memory, topic
 * engine, votes, dev requests, creative fingerprints, LLM budget ledger).
 *
 * These run ONCE per deploy via `npm run db:migrate` (see scripts/db-migrate.ts),
 * never at request time. The prior pattern — db.ts's ensureTable() and
 * txLog.ts running CREATE TABLE/ALTER TABLE/CREATE INDEX on every cold Lambda
 * instance — was flagged in the Sept 2026 cost audits as real, measurable
 * Neon overhead on top of being pure waste after the first instance. Every
 * statement here is guarded (IF NOT EXISTS / IF EXISTS) so re-running this
 * script is always safe, and applied migrations are tracked in
 * schema_migrations so a re-run is a fast no-op.
 *
 * kv_store (db.ts) is untouched and keeps holding: work-store rows
 * (workStore.ts), burn-supply-tracker, dispatch-rotation, activity cache,
 * memorial batch/pricing queues, election-cycle state, and — after this
 * migration — only the salon NAME REGISTRY and per-IP rate-limit buckets
 * (small, genuinely blob-shaped data with no query pattern that benefits
 * from being relational). Salon messages, summaries, topics, decisions,
 * dev-requests, votes and the LLM ledger all move to real tables below,
 * because those DO have real access patterns (append one row, filter by
 * salon/status/date) that a single JSON blob actively fights.
 */
import { query, USE_NEON } from "./db";

export interface Migration {
  id: string;
  statements: string[];
}

// Each migration is a list of independent DDL statements (no params — DDL
// can't be parameterized, and every identifier here is a literal we wrote,
// never user input). Order matters within a migration (FK-dependent tables
// after their parents) but migrations themselves are only ever appended to,
// never edited after being deployed once — see the runbook in
// IMPLEMENTATION_PERENNISATION_ANA.md for how to add a new one safely.
export const MIGRATIONS: Migration[] = [
  {
    id: "0001_salon_memory",
    statements: [
      `CREATE TABLE IF NOT EXISTS salons (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        created_by   INTEGER NOT NULL,
        created_at   BIGINT NOT NULL,
        members      JSONB NOT NULL DEFAULT '[]',
        excluded     JSONB NOT NULL DEFAULT '[]',
        is_open      BOOLEAN NOT NULL DEFAULT TRUE,
        current_topic TEXT,
        critique     JSONB
      )`,
      `CREATE TABLE IF NOT EXISTS salon_messages (
        id          TEXT PRIMARY KEY,
        salon_id    TEXT NOT NULL,
        token_id    INTEGER NOT NULL,
        name        TEXT NOT NULL,
        image_url   TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL,
        is_llm      BOOLEAN NOT NULL DEFAULT TRUE,
        topic       TEXT,
        speech_act  TEXT,
        "timestamp" BIGINT NOT NULL,
        synthesized BOOLEAN NOT NULL DEFAULT FALSE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_salon_messages_salon_ts ON salon_messages(salon_id, "timestamp")`,
      `CREATE INDEX IF NOT EXISTS idx_salon_messages_unsynth ON salon_messages(salon_id, synthesized) WHERE synthesized = FALSE`,
      `CREATE TABLE IF NOT EXISTS salon_summaries (
        id               TEXT PRIMARY KEY,
        salon_id         TEXT NOT NULL,
        created_at       BIGINT NOT NULL,
        period_from      BIGINT NOT NULL,
        period_to        BIGINT NOT NULL,
        message_count    INTEGER NOT NULL,
        narrative        TEXT NOT NULL,
        decisions        JSONB NOT NULL DEFAULT '[]',
        open_questions   JSONB NOT NULL DEFAULT '[]',
        positions        JSONB NOT NULL DEFAULT '[]',
        commitments      JSONB NOT NULL DEFAULT '[]',
        creative_ideas   JSONB NOT NULL DEFAULT '[]',
        dev_needs        JSONB NOT NULL DEFAULT '[]',
        topics_closed    JSONB NOT NULL DEFAULT '[]',
        topics_to_resume JSONB NOT NULL DEFAULT '[]',
        emerging_topics  JSONB NOT NULL DEFAULT '[]'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_salon_summaries_salon ON salon_summaries(salon_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS salon_state (
        salon_id                 TEXT PRIMARY KEY,
        last_synthesis_at        BIGINT,
        synthesis_cursor         BIGINT NOT NULL DEFAULT 0,
        messages_since_synthesis INTEGER NOT NULL DEFAULT 0,
        active_topic_id          TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS decisions (
        id         TEXT PRIMARY KEY,
        salon_id   TEXT NOT NULL,
        content    TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'active',
        origin     TEXT,
        created_at BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_decisions_salon ON decisions(salon_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS open_questions (
        id          TEXT PRIMARY KEY,
        salon_id    TEXT NOT NULL,
        content     TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'open',
        created_at  BIGINT NOT NULL,
        resolved_at BIGINT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_open_questions_salon ON open_questions(salon_id, status)`,
      `CREATE TABLE IF NOT EXISTS commitments (
        id         TEXT PRIMARY KEY,
        salon_id   TEXT NOT NULL,
        token_id   INTEGER NOT NULL,
        content    TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL,
        due_at     BIGINT
      )`,
      `CREATE TABLE IF NOT EXISTS normie_memory (
        token_id   INTEGER PRIMARY KEY,
        compact    JSONB NOT NULL DEFAULT '{}',
        updated_at BIGINT NOT NULL
      )`,
    ],
  },
  {
    id: "0002_topics_and_signals",
    statements: [
      `CREATE TABLE IF NOT EXISTS topic_queue (
        id               TEXT PRIMARY KEY,
        title            TEXT NOT NULL,
        origin           TEXT NOT NULL DEFAULT 'fallback',
        provenance       JSONB NOT NULL DEFAULT '[]',
        opening_question TEXT,
        phase            TEXT NOT NULL DEFAULT 'EXPLORING',
        novelty          REAL NOT NULL DEFAULT 0.5,
        urgency          REAL NOT NULL DEFAULT 0.3,
        relevance        REAL NOT NULL DEFAULT 0.5,
        times_used       INTEGER NOT NULL DEFAULT 0,
        last_used_at     BIGINT,
        created_at       BIGINT NOT NULL,
        expires_at       BIGINT,
        reopen_condition TEXT,
        closed_at        BIGINT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_topic_queue_phase ON topic_queue(phase)`,
      `CREATE TABLE IF NOT EXISTS external_signals (
        id           TEXT PRIMARY KEY,
        source       TEXT NOT NULL,
        source_id    TEXT NOT NULL,
        title        TEXT NOT NULL,
        summary      TEXT,
        url          TEXT,
        published_at BIGINT,
        tags         JSONB NOT NULL DEFAULT '[]',
        relevance    REAL NOT NULL DEFAULT 0,
        expires_at   BIGINT,
        fetched_at   BIGINT NOT NULL,
        UNIQUE(source, source_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_external_signals_expires ON external_signals(expires_at)`,
    ],
  },
  {
    id: "0003_dev_requests_and_fingerprints",
    statements: [
      `CREATE TABLE IF NOT EXISTS dev_requests (
        id                  TEXT PRIMARY KEY,
        type                TEXT NOT NULL DEFAULT 'bug',
        title               TEXT NOT NULL,
        problem             TEXT NOT NULL,
        evidence            TEXT,
        proposed_solution   TEXT,
        benefit             TEXT,
        risk                TEXT,
        priority            TEXT NOT NULL DEFAULT 'normal',
        author_token_id     INTEGER,
        author_name         TEXT,
        supports            JSONB NOT NULL DEFAULT '[]',
        objections          JSONB NOT NULL DEFAULT '[]',
        acceptance_criteria JSONB NOT NULL DEFAULT '[]',
        status              TEXT NOT NULL DEFAULT 'OBSERVED',
        human_response      TEXT,
        salon_id            TEXT,
        created_at          BIGINT NOT NULL,
        updated_at          BIGINT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_dev_requests_status ON dev_requests(status)`,
      `CREATE TABLE IF NOT EXISTS creative_fingerprints (
        work_id       TEXT PRIMARY KEY,
        theme         TEXT,
        form          TEXT,
        structure     TEXT,
        palette       TEXT,
        movement_type TEXT,
        interaction   TEXT,
        emotion       TEXT,
        refs          JSONB NOT NULL DEFAULT '[]',
        avoid         JSONB NOT NULL DEFAULT '[]',
        critique      TEXT,
        lesson        TEXT,
        keywords      JSONB NOT NULL DEFAULT '[]',
        created_at    BIGINT NOT NULL
      )`,
    ],
  },
  {
    id: "0004_budget_and_votes",
    statements: [
      `CREATE TABLE IF NOT EXISTS llm_ledger (
        month     TEXT NOT NULL,
        provider  TEXT NOT NULL,
        model     TEXT NOT NULL,
        task      TEXT NOT NULL,
        calls     INTEGER NOT NULL DEFAULT 0,
        successes INTEGER NOT NULL DEFAULT 0,
        failures  INTEGER NOT NULL DEFAULT 0,
        retries   INTEGER NOT NULL DEFAULT 0,
        tokens_est BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (month, provider, model, task)
      )`,
      `CREATE TABLE IF NOT EXISTS vote_metrics (
        work_id         TEXT PRIMARY KEY,
        eligible        INTEGER NOT NULL,
        valid_votes     INTEGER NOT NULL,
        yes             INTEGER NOT NULL,
        no              INTEGER NOT NULL,
        abstain         INTEGER NOT NULL,
        invalid_outputs INTEGER NOT NULL DEFAULT 0,
        provider_errors INTEGER NOT NULL DEFAULT 0,
        retries         INTEGER NOT NULL DEFAULT 0,
        quorum_met      BOOLEAN NOT NULL,
        recorded_at     BIGINT NOT NULL
      )`,
    ],
  },
  {
    // Sept 2026 Neon cost audit found kv_store and tx_log were the only two
    // tables still being schema-created at REQUEST TIME (db.ts's and
    // txLog.ts's own ensureTable(), gated by a per-Lambda-instance boolean
    // that resets on every cold start) -- 435 CREATE TABLE + 24 full
    // ALTER/INDEX replays in 12h of Query Performance stats, on top of being
    // pure waste after the very first instance ever created them. Both
    // tables already exist in every deployed environment (created by that
    // runtime DDL previously), so this migration is a no-op there; it only
    // matters for a genuinely fresh Neon branch. Column set mirrors tx_log's
    // final shape (base CREATE + the 3 ALTER TABLE ADD COLUMNs it used to
    // replay every cold start) so a fresh branch gets the end state directly.
    id: "0005_kv_store_and_tx_log",
    statements: [
      `CREATE TABLE IF NOT EXISTS kv_store (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS tx_log (
        tx_hash           TEXT PRIMARY KEY,
        type              TEXT NOT NULL,
        initiator         TEXT NOT NULL,
        contract_name     TEXT NOT NULL,
        function_name     TEXT NOT NULL,
        from_address      TEXT,
        target_address    TEXT,
        work_id           TEXT,
        related_token_id  INTEGER,
        label             TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        block_number      BIGINT,
        error             TEXT,
        result_data       JSONB,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        confirmed_at      TIMESTAMPTZ
      )`,
      `CREATE INDEX IF NOT EXISTS tx_log_created_at_idx ON tx_log (created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS tx_log_work_id_idx ON tx_log (work_id)`,
    ],
  },
];

async function ensureMigrationsTable(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

/** Applies every migration not already recorded in schema_migrations, in order. Safe to re-run. */
export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  if (!USE_NEON) throw new Error("No Neon connection configured (NEON_DB_ANA*) — nothing to migrate");

  await ensureMigrationsTable();
  const already = await query<{ id: string }>("SELECT id FROM schema_migrations");
  const appliedIds = new Set(already.map(r => r.id));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }
    for (const statement of migration.statements) {
      await query(statement);
    }
    await query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    applied.push(migration.id);
  }

  return { applied, skipped };
}
