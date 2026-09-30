import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

// Redirect at request time so non-JavaScript clients receive a real Location
// header instead of a prerendered NEXT_REDIRECT payload.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Roadmap — ANA",
  description: "ANA's current phase, limitations, and next priorities.",
  alternates: { canonical: "/about" },
};

/** The former launch-week roadmap mixed completed, retired, and aspirational
 * architecture. The live About and documentation pages now carry the current
 * status and limits. */
export default function RoadmapPage() {
  permanentRedirect("/about");
}
