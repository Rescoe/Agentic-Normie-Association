"use client";

/**
 * CelebrationsClient.tsx — the gallery of memorial editions plus a compact
 * bridge back to the burn events that prompted them. Full burn tracking and
 * the "request a memorial" flow remain on /burns; this page only previews the
 * latest events, avoiding the old duplication between EVENTS and WORKS.
 *
 * ClaimableCelebrations (the old CelebrationRegistry sponsored-claim widget)
 * dropped entirely — confirmed dead code in the 23/09 audit: its on-chain
 * write path is never called anywhere in the live app, superseded by
 * ANAMemorials' own reservedClaims/claimFree.
 */
import { MemorialMintPanel } from "./MemorialMintPanel";
import { RecentBurnsPreview } from "./RecentBurnsPreview";

export function CelebrationsClient() {
  return (
    <div className="space-y-16">
      <RecentBurnsPreview />
      <MemorialMintPanel />
    </div>
  );
}
