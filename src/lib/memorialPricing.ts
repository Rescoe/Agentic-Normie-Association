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
  publicSupply:         number; // 0 for tier 1 (no public opening); tier 2 has an enforced floor of 10 (see MIN_TIER2_PUBLIC_SUPPLY in request-memorial/route.ts) — a "fixed edition" option with fewer than that loses its distinct meaning from tier 1
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

// Corrected 20/09/2026 (porteur caught a mistake in the previous ordering):
// price scales INVERSELY with quantity — tier 1 (least quantity, a single
// edition) is the MOST expensive, tier 3 (most quantity — open-ended public
// claim) is the CHEAPEST, tier 2 sits in between. Same 3 numbers as before,
// reassigned to the tiers they actually belong to.
export const DEFAULT_MEMORIAL_PRICING: MemorialPricingConfig = {
  tier1: { priceWei: "1500000000000000",  publicSupply: 0,  requesterSupply: 1, openEnded: false },                             // 0.0015 ETH — least quantity (1), priciest
  tier2: { priceWei: "1000000000000000",  publicSupply: 10, requesterSupply: 1, openEnded: false },                             // 0.001 ETH — fixed batch, minimum 10 (below that it's indistinguishable from tier 1)
  tier3: { priceWei: "300000000000000",   publicSupply: 0,  requesterSupply: 1, openEnded: true, claimDurationSeconds: 30 * 86_400 }, // 0.0003 ETH — open-ended, most potential quantity, cheapest
  batchPriceWei: "100000000000000", // 0.0001 ETH — automatic batch memorial, not part of this tier system
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
