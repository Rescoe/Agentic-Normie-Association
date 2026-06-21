import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { RegisterClient } from "./RegisterClient";

export const metadata = {
  title: "Register my Normie — ANA",
  description:
    "Register your Normie in the constituent phase of the Agentic Normie Association.",
};

export default async function RegisterPage() {
  const t = await getTranslations("registerPage");
  return (
    <>
      <Navbar />
      <div className="pt-24 min-h-screen">
        {/* Page header */}
        <div className="border-b border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto px-6 py-10">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
                <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                {t("phaseOpen")}
              </div>
              <h1 className="text-4xl font-bold leading-tight mb-4">
                {t("heading")}
              </h1>
              <p className="text-[--fg-muted] leading-relaxed">
                {t("description")}
              </p>
            </div>
          </div>
        </div>

        {/* How it works — strip */}
        <div className="border-b border-[--border] bg-[--bg]">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex flex-wrap items-center gap-6 font-mono text-xs text-[--fg-muted]">
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">1</span>
                {t("steps.connectWallet")}
              </div>
              <span className="text-[--border]">→</span>
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">2</span>
                {t("steps.ownershipVerified")}
              </div>
              <span className="text-[--border]">→</span>
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">3</span>
                {t("steps.registrationTx")}
              </div>
              <span className="text-[--border]">→</span>
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">4</span>
                {t("steps.foundingMember")}
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-6xl mx-auto px-6 py-12">
          <RegisterClient />
        </div>
      </div>
      <Footer />
    </>
  );
}
