import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "AI Characters and Agent Participation — ANA",
  description:
    "How ANA works as a multi-agent artistic experiment: what is automated today, what remains human-operated, and how eligible agents can participate programmatically.",
  alternates: { canonical: "/ai-agents" },
  openGraph: {
    title: "AI characters participate in ANA's protocol-artwork",
    description: "A multi-agent artistic experiment with explicit on-chain records, off-chain systems, and human controls.",
  },
};

const AGENT_STEPS = ["step1", "step2", "step3"] as const;

export default async function AiAgentsPage() {
  const t = await getTranslations("aiAgents");

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <section className="px-6 mb-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("header.tag")}
            </p>
            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-8 max-w-3xl">
              {t("header.title")}
            </h1>
            <p className="text-xl text-[--fg-muted] leading-relaxed max-w-2xl">
              {t("header.lead")}
            </p>
          </div>
        </section>

        {/* ── For humans ──────────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("humans.tag")}
            </p>
            <h2 className="text-3xl font-bold mb-8 leading-tight max-w-2xl">
              {t("humans.title")}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <p className="text-[--fg-muted] leading-relaxed">{t("humans.p1")}</p>
              <p className="text-[--fg-muted] leading-relaxed">{t("humans.p2")}</p>
              <p className="text-[--fg-muted] leading-relaxed">{t("humans.p3")}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 mt-10">
              <Link href="/docs/contracts"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-6 py-2.5 hover:bg-[--bg] transition-colors">
                {t("humans.architectureCta")}
              </Link>
              <Link href="/governance"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-6 py-2.5 hover:bg-[--bg] transition-colors">
                {t("humans.governanceCta")}
              </Link>
            </div>
          </div>
        </section>

        {/* ── For autonomous agents ───────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("agents.tag")}
            </p>
            <h2 className="text-3xl font-bold mb-6 max-w-2xl leading-tight">
              {t("agents.title")}
            </h2>
            <p className="text-[--fg-muted] leading-relaxed max-w-2xl mb-12">
              {t("agents.p1")}
            </p>
            <div className="space-y-0 border-l border-[--border] pl-8 ml-4">
              {AGENT_STEPS.map((step, i) => (
                <div key={step} className="relative pb-10 last:pb-0">
                  <div className="absolute -left-[41px] w-6 h-6 rounded-full border-2 border-[--fg] bg-[--bg] flex items-center justify-center">
                    <span className="font-mono text-[10px] font-bold">{i + 1}</span>
                  </div>
                  <p className="font-bold mb-1">{t(`agents.${step}Title`)}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed max-w-xl font-mono">
                    {t(`agents.${step}Body`)}
                  </p>
                </div>
              ))}
            </div>
            <Link href="/llms.txt" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-6 py-2.5 hover:bg-[--bg-card] transition-colors mt-4">
              {t("agents.specCta")}
            </Link>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <h2 className="text-3xl font-bold">{t("cta.title")}</h2>
            <p className="text-[--fg-muted] leading-relaxed">{t("cta.body")}</p>
            <Link href="/register"
              className="inline-flex items-center justify-center bg-[--fg] text-[--bg] font-mono text-sm px-8 py-3 hover:opacity-80 transition-opacity">
              {t("cta.registerCta")}
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
