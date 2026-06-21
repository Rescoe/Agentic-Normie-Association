import { defineRouting } from "next-intl/routing";

// English is the primary audience (~75%) and keeps today's URLs unprefixed
// (localePrefix: "as-needed") so nothing that's already indexed or linked
// on-chain (certificates reference external_url) breaks. Adding French later
// is just: push "fr" here + commit messages/fr.json — no routing changes.
export const routing = defineRouting({
  locales:       ["en"],
  defaultLocale: "en",
  localePrefix:  "as-needed",
});
