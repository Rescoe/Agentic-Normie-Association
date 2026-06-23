import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GallerySubNav } from "@/components/GallerySubNav";
import { CelebrationsClient } from "@/app/[locale]/galerie/celebrations/CelebrationsClient";

export const metadata: Metadata = {
  title: "Célébrations — ANA | Burns memorial",
  description: "A live memorial for every Normie burned on-chain — tracked daily and honored by the Agentic Normie Association.",
  openGraph: {
    title: "ANA Célébrations — Burns memorial",
    description: "Every burned Normie, counted and remembered.",
  },
};

export default async function CelebrationsPage() {
  const t = await getTranslations("celebrations");
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

        <GallerySubNav />

        <section className="px-6">
          <div className="max-w-6xl mx-auto">
            <CelebrationsClient />
          </div>
        </section>

      </main>
      <Footer />
    </>
  );
}
