import { redirect } from "next/navigation";

// /works used to be its own duplicate gallery page (different copy, same
// WorksClient component as /galerie). Consolidated to /galerie, which is
// the canonical page linked from the Navbar. This route stays alive as a
// redirect because already-published certificates hardcode
// external_url: ".../works" in their on-chain metadata — that link must
// keep resolving forever, even though new content only lives at /galerie.
export default function WorksPage() {
  redirect("/galerie");
}
