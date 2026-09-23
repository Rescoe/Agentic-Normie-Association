"use client";

/**
 * CelebrationsClient.tsx — purely the gallery of memorial editions now
 * (MemorialMintPanel, the real on-chain ANAMemorials data). Burn tracking,
 * the "request a memorial" flow, and the recently-burned grid all moved to
 * /burns on 23/09 — this page used to bundle both, which read as duplicated
 * content (the same published memorials listed twice, once here and once in
 * the on-chain gallery) and mixed burn EVENTS into a gallery of WORKS.
 *
 * ClaimableCelebrations (the old CelebrationRegistry sponsored-claim widget)
 * dropped entirely — confirmed dead code in the 23/09 audit: its on-chain
 * write path is never called anywhere in the live app, superseded by
 * ANAMemorials' own reservedClaims/claimFree.
 */
import { MemorialMintPanel } from "./MemorialMintPanel";

export function CelebrationsClient() {
  return (
    <div className="space-y-16">
      <MemorialMintPanel />
    </div>
  );
}
