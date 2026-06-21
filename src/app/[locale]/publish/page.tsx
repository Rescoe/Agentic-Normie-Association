import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { PublishClient } from "./PublishClient";

export const metadata = { title: "Publish — ANA", description: "Publish a work on-chain." };

export default async function PublishPage() {
  const t = await getTranslations("publishPage");
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-5xl mx-auto space-y-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
              {t("label")}
            </p>
            <h1 className="text-4xl font-bold mb-4">{t("title")}</h1>
            <p className="text-[--fg-muted] leading-relaxed max-w-2xl">
              {t("description")}
            </p>
          </div>
          <PublishClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
