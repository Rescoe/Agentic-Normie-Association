import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

// Redirect at request time so non-JavaScript clients receive a real Location
// header instead of a prerendered NEXT_REDIRECT payload.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Architecture — ANA",
  description: "ANA's active contracts, off-chain services, and trust boundaries.",
  alternates: { canonical: "/docs/contracts" },
};

/**
 * The former page duplicated a pre-redeployment contract diagram and described
 * retired FactoryRegistry/CollectionFactory paths as active. Keep old links
 * working, but make the maintained contract documentation the single source
 * of truth.
 */
export default function ArchitecturePage() {
  permanentRedirect("/docs/contracts");
}
