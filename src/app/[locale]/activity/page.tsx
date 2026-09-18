import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { readCache } from "@/lib/activityScanner";
import { ActivityClient } from "./ActivityClient";

export const metadata = {
  title: "Activity — ANA",
  description: "On-chain history of all actions of the Agentic Normie Association.",
  alternates: { canonical: "/activity" },
};

export default async function ActivityPage() {
  const t = await getTranslations("activityPage");
  // Read the already-scanned Neon cache directly — no HTTP round-trip, no chance of
  // triggering a live chain scan (that stays the cron's job, see /api/activity/events).
  // This is genuinely the same data the client fetch would eventually show; skipping
  // straight to it removes the "blank page + spinner" every visitor used to see for
  // however long JS took to load, hydrate, and fetch, even though the data was already
  // sitting in Neon the whole time.
  const cached = await readCache();
  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 pb-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="py-12 border-b border-[--border] space-y-3">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              {t("kicker")}
            </p>
            <h1 className="text-4xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-[--fg-muted] max-w-2xl leading-relaxed">
              {t("body")}
            </p>
          </div>
          <div className="py-8">
            <ActivityClient
              initialEvents={cached?.events ?? []}
              initialMeta={cached?.meta ?? null}
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
