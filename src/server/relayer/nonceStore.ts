/**
 * nonceStore.ts
 *
 * Generates and tracks one-time nonces for attestation requests.
 *
 * Security model:
 *   - Nonces are 256-bit random values (crypto.randomBytes)
 *   - A nonce is "issued" when the relayer signs an attestation
 *   - The on-chain contract marks nonces as used after first successful register()
 *   - This in-memory store prevents replaying a signed attestation before it
 *     hits the chain (double-request within the TTL window)
 *
 * For production: replace the in-memory Map with Redis or a DB table.
 * The current implementation is fine for a hackathon / single-instance deploy.
 */

import { randomBytes } from "crypto";

interface NonceEntry {
  tokenId: number;
  issuedAt: number;
  usedAt: number | null;
}

// In-memory store: nonce (hex string) → entry
const store = new Map<string, NonceEntry>();

// Nonces expire after 10 minutes if not used on-chain
const NONCE_TTL_MS = 10 * 60 * 1000;

// Cleanup old nonces every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of store.entries()) {
    if (now - entry.issuedAt > NONCE_TTL_MS) {
      store.delete(nonce);
    }
  }
}, 5 * 60 * 1000);

/**
 * Generate a fresh nonce for a given tokenId.
 * Returns a bigint (easy to pass to viem signTypedData).
 */
export function generateNonce(tokenId: number): bigint {
  const bytes = randomBytes(32);
  const hex = bytes.toString("hex");
  const nonceBigInt = BigInt("0x" + hex);

  store.set(hex, {
    tokenId,
    issuedAt: Date.now(),
    usedAt: null,
  });

  return nonceBigInt;
}

/**
 * Mark a nonce as used (call after successful on-chain tx, or just let it expire).
 * Returns false if nonce was already used or not found.
 */
export function markNonceUsed(nonce: bigint): boolean {
  const hex = nonce.toString(16).padStart(64, "0");
  const entry = store.get(hex);
  if (!entry || entry.usedAt !== null) return false;
  entry.usedAt = Date.now();
  return true;
}

/**
 * Check if a nonce is valid (issued, not expired, not used).
 */
export function isNonceValid(nonce: bigint): boolean {
  const hex = nonce.toString(16).padStart(64, "0");
  const entry = store.get(hex);
  if (!entry) return false;
  if (entry.usedAt !== null) return false;
  if (Date.now() - entry.issuedAt > NONCE_TTL_MS) return false;
  return true;
}
