import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

// Redirect at request time so non-JavaScript clients receive a real Location
// header instead of a prerendered NEXT_REDIRECT payload.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API & Data — ANA",
  description: "ANA's public API, on-chain records, and off-chain operational data.",
  alternates: { canonical: "/docs/api" },
};

/** The old page claimed that ANA had no private database. The maintained API
 * documentation now explains the real on-chain/off-chain boundary. */
export default function DataPage() {
  permanentRedirect("/docs/api");
}
