/**
 * memorialPricing.ts — tunable pricing for the 3 paid-request tiers + the
 * automatic batch tier, stored in Neon (not hardcoded, not on-chain) so the
 * porteur can adjust the business model without a contract redeploy. The
 * contract itself (ANAMemorials.sol) has no notion of "tiers" — these numbers
 * just resolve into the generic priceWei/publicSupply/requesterSupply/openEnded
 * parameters registerMemorial() already takes.
 *
 * Illustrative defaults from the porteur's own examples — meant to be tuned,
 * not treated as final.
 */
import { kvGet, kvSet } from "@/lib/db";

const NEON_KEY = "memorial-pricing";

export interface MemorialTier {
  priceWei:             string; // decimal string, parsed with BigInt()
  publicSupply:         number; // 0 for tier 1 (no public opening)
  requesterSupply:      1;      // the payer's own reserved edition — always exactly 1
  openEnded:             boolean;
  claimDurationSeconds?: number; // only meaningful when openEnded
}

export interface MemorialPricingConfig {
  tier1: MemorialTier; // just their own edition — highest per-edition price, no public opening
  tier2: MemorialTier; // their edition + a fixed public batch — lower per-edition price, more volume
  tier3: MemorialTier; // their edition + open public claim over a duration — cheapest per-edition
  batchPriceWei: string; // per-edition price for the automatic weekly/monthly batch memorial
}

// Lowered per the porteur's explicit numbers (19/09/2026) — given in tier
// 1→2→3 order (0.0003, 0.001, 0.0015 ETH). Applied literally as specified,
// even though it reverses the original "more volume = cheaper per edition"
// intent (tier 3, the most open/highest-volume tier, ends up priced highest
// here) — trivial to reorder via PUT /api/admin/memorial-pricing if that
// wasn't the intent, no redeploy needed since this is off-chain config.
export const DEFAULT_MEMORIAL_PRICING: MemorialPricingConfig = {
  tier1: { priceWei: "300000000000000",   publicSupply: 0,  requesterSupply: 1, openEnded: false },                             // 0.0003 ETH
  tier2: { priceWei: "1000000000000000",  publicSupply: 10, requesterSupply: 1, openEnded: false },                             // 0.001 ETH, 10 public
  tier3: { priceWei: "1500000000000000",  publicSupply: 0,  requesterSupply: 1, openEnded: true, claimDurationSeconds: 30 * 86_400 }, // 0.0015 ETH, 30 days
  batchPriceWei: "100000000000000", // 0.0001 ETH — also lowered, not explicitly specified by the porteur
};

export async function getMemorialPricing(): Promise<MemorialPricingConfig> {
  try {
    const raw = await kvGet(NEON_KEY);
    if (!raw) return DEFAULT_MEMORIAL_PRICING;
    return { ...DEFAULT_MEMORIAL_PRICING, ...JSON.parse(raw) as Partial<MemorialPricingConfig> };
  } catch (e) {
    console.error("[memorialPricing] read failed, using defaults:", e);
    return DEFAULT_MEMORIAL_PRICING;
  }
}

export async function setMemorialPricing(config: MemorialPricingConfig): Promise<void> {
  await kvSet(NEON_KEY, JSON.stringify(config));
}

export type MemorialTierId = 1 | 2 | 3;

export async function resolveTier(tier: MemorialTierId): Promise<MemorialTier> {
  const config = await getMemorialPricing();
  return tier === 1 ? config.tier1 : tier === 2 ? config.tier2 : config.tier3;
}
