import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ActivityClient } from "./ActivityClient";

export const metadata = {
  title: "Activity — ANA",
  description: "On-chain history of all actions of the Agentic Normie Association.",
};

export default async function ActivityPage() {
  const t = await getTranslations("activityPage");
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
            <ActivityClient />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
