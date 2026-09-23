import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BurnsClient } from "@/app/[locale]/burns/BurnsClient";

export const metadata: Metadata = {
  title: "Burns — ANA | Live burn tracking",
  description: "Every Normie burn, tracked live from api.normies.art — search a burned Normie to request its memorial, or browse the most recently burned.",
  openGraph: {
    title: "ANA Burns — Live burn tracking",
    description: "Every burned Normie, counted and remembered.",
  },
  alternates: { canonical: "/burns" },
};

export default async function BurnsPage() {
  const t = await getTranslations("burns");
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 min-h-screen">

        <section className="px-6 mb-8">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("header.label")}
            </p>
            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-6 max-w-3xl">
              {t("header.title")}
            </h1>
            <p className="text-lg text-[--fg-muted] leading-relaxed max-w-2xl">
              {t("header.description")}
            </p>
          </div>
        </section>

        <section className="px-6">
          <div className="max-w-6xl mx-auto">
            <BurnsClient />
          </div>
        </section>

      </main>
      <Footer />
    </>
  );
}
