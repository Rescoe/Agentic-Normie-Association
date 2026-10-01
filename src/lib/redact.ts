/**
 * redact.ts — strips secrets out of freeform text before it is logged,
 * persisted, or returned in any response.
 *
 * Root cause this exists for (29/09/2026 production incident): a raw RPC
 * error message containing the full Alchemy URL (with its API key in the
 * path) was saved verbatim into ANAWork.validationNote and served back by
 * the public GET /api/works. Redaction must happen at every point external
 * error text first enters our system — not just at the API response
 * boundary — so it is applied centrally here and called from:
 *   - workStore.ts (validationNote / operationalErrorMessage / stateHistory notes)
 *   - the public /api/works DTO (defense in depth, in case a caller forgets)
 *   - devRequests.ts (dev-request bodies quote error text verbatim)
 *   - the one-off cleanup script for already-persisted rows (scripts/redact-persisted-secrets.ts)
 *
 * Deliberately does NOT do a generic "redact any 32+ char token" pass: that
 * would also swallow legitimate 0x-prefixed tx hashes and contract
 * addresses, which are not secret and must stay visible (basescan links,
 * on-chain proof). Only patterns that are structurally where a provider key
 * lives are matched.
 */

const REDACTED = "[REDACTED]";

// Env vars whose exact current value must never appear in persisted/logged/
// returned text. BASE_RPC_URL isn't secret by name, but in practice it's
// "https://<provider>/v2/<key>" — the whole configured URL is treated as
// sensitive so a rotated-in premium RPC URL never leaks the same way.
const SENSITIVE_ENV_VAR_NAMES = [
  "RELAYER_PRIVATE_KEY",
  "GROQ_API_KEY",
  "ONE_MIN_AI_API_KEY",
  "BASESCAN_API_KEY",
  "CRON_SECRET",
  // db.ts tries these Neon connection-string env vars in order (Vercel's
  // actual integration names differ from the manual/legacy one) — every
  // variant must be covered, not just the one someone remembers by name.
  "NEON_DB_ANA_POSTGRES_URL",
  "NEON_DB_ANA_POSTGRES_DATABASE_URL",
  "NEON_DB_ANA_POSTGRES_POSTGRES_URL",
  "NEON_DB_ANA_DATABASE_URL",
  "NEON_DB_ANA",
  "BASE_RPC_URL",
] as const;

function sensitiveEnvValues(): string[] {
  return SENSITIVE_ENV_VAR_NAMES
    .map(name => process.env[name])
    .filter((v): v is string => !!v && v.length >= 6)
    // Longest first so a value that is a substring of another (unlikely, but
    // cheap to guard) doesn't leave a partial replacement behind.
    .sort((a, b) => b.length - a.length);
}

// RPC/API providers (Alchemy, Infura, QuickNode, ...) commonly place the
// secret key as the literal last path segment after a version prefix, e.g.
// https://base-mainnet.g.alchemy.com/v2/AbCdEf0123456789_-.
const URL_VERSION_PATH_KEY_RE = /(\/v[0-9]+\/)[A-Za-z0-9_-]{12,}/gi;

// Query-string secrets: ?apiKey=..., ?api_key=..., ?key=..., ?token=..., ?secret=...
const URL_QUERY_KEY_RE = /([?&](?:api[_-]?key|key|token|secret)=)[^&\s"'<>]+/gi;

// Authorization: Bearer <token> appearing inline in error/log text (curl -v
// dumps, fetch error messages that echo request headers, etc).
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]{10,}/gi;
const AUTH_HEADER_KV_RE = /(authorization["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{10,}/gi;

// postgres://user:password@host/db — a driver error (connection refused, DNS
// failure, auth failure) can embed the full connection string including its
// password. Defense in depth alongside the exact NEON_DB_ANA* env matches
// above (which only catch the value exactly as currently configured).
const POSTGRES_URL_CREDENTIALS_RE = /(postgres(?:ql)?:\/\/[^:/@\s]+:)[^@\s]+(@)/gi;

/**
 * Removes every known secret shape from `input`. Idempotent — running it
 * twice produces the same output as running it once, so it's safe to apply
 * defensively at more than one layer (write time AND read time).
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;

  for (const value of sensitiveEnvValues()) {
    if (out.includes(value)) out = out.split(value).join(REDACTED);
  }

  out = out.replace(URL_VERSION_PATH_KEY_RE, (_m, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(URL_QUERY_KEY_RE, (_m, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(BEARER_RE, `Bearer ${REDACTED}`);
  out = out.replace(AUTH_HEADER_KV_RE, (_m, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(POSTGRES_URL_CREDENTIALS_RE, (_m, prefix: string, suffix: string) => `${prefix}${REDACTED}${suffix}`);

  return out;
}

/** redactSecrets() + a length cap — the shape every diagnostic-text field in
 * ANAWork already wants (validationNote, operationalErrorMessage, ...). */
export function cleanDiagnosticText(input: string | undefined | null, maxLen = 500): string | undefined {
  if (!input) return undefined;
  return redactSecrets(input).slice(0, maxLen);
}
