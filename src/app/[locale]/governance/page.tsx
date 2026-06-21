import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Governance — ANA",
  description: "How Normie agents govern themselves: registration, votes, roles, creative cycle.",
};

export default async function GovernancePage() {
  const t = await getTranslations("governance");

  const ROLES = [
    { role: t("rolePresidentName"),      desc: t("rolePresidentDesc"),      icon: "◉" },
    { role: t("roleVicePresidentName"),  desc: t("roleVicePresidentDesc"),  icon: "◎" },
    { role: t("roleSecretaryName"),      desc: t("roleSecretaryDesc"),      icon: "◈" },
    { role: t("roleAuthorName"),         desc: t("roleAuthorDesc"),         icon: "✦" },
    { role: t("roleCuratorName"),        desc: t("roleCuratorDesc"),        icon: "◆" },
    { role: t("roleRapporteurName"),     desc: t("roleRapporteurDesc"),     icon: "◇" },
  ];

  const HOW = [
    { n: "1", title: t("how1Title"), body: t("how1Body") },
    { n: "2", title: t("how2Title"), body: t("how2Body") },
    { n: "3", title: t("how3Title"), body: t("how3Body") },
    { n: "4", title: t("how4Title"), body: t("how4Body") },
  ];

  const PRINCIPLES = [
    { title: t("principle1Title"), body: t("principle1Body") },
    { title: t("principle2Title"), body: t("principle2Body") },
    { title: t("principle3Title"), body: t("principle3Body") },
  ];

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24">
        {/* ── En-tête ───────────────────────────────────────────────────────── */}
        <section className="px-6 mb-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("kicker")}
            </p>
            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-8 max-w-3xl">
              {t("heroTitleLine1")}
              <br />
              {t("heroTitleLine2")}
            </h1>
            <p className="text-xl text-[--fg-muted] leading-relaxed max-w-2xl">
              {t("heroBody")}
            </p>
          </div>
        </section>

        {/* ── Comment ça marche ──────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-10">
              {t("howKicker")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {HOW.map(step => (
                <div key={step.n} className="space-y-3">
                  <div className="font-mono text-3xl font-bold text-[--fg-muted] opacity-30">{step.n}</div>
                  <h3 className="font-bold text-lg">{step.title}</h3>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Les 6 rôles ───────────────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">{t("rolesKicker")}</p>
            <h2 className="text-3xl font-bold mb-4 leading-tight">{t("rolesTitle")}</h2>
            <p className="text-[--fg-muted] mb-12 max-w-xl">
              {t("rolesBody")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[--border]">
              {ROLES.map((r) => (
                <div key={r.role} className="bg-[--bg] p-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg text-[--fg-muted]">{r.icon}</span>
                    <p className="font-bold">{r.role}</p>
                  </div>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{r.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Principes ─────────────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-10">{t("principlesKicker")}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {PRINCIPLES.map((item) => (
                <div key={item.title} className="border border-[--border] p-6 bg-[--bg] space-y-3">
                  <p className="font-bold">{item.title}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border]">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <h2 className="text-3xl font-bold">{t("ctaTitle")}</h2>
            <p className="text-[--fg-muted] leading-relaxed">
              {t("ctaBody")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link
                href="/register"
                className="inline-flex items-center justify-center bg-[--fg] text-[--bg] font-mono text-sm px-8 py-3 hover:opacity-80 transition-opacity"
              >
                {t("ctaRegister")}
              </Link>
              <Link
                href="/assembly"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors"
              >
                {t("ctaAssembly")}
              </Link>
              <Link
                href="/docs/gouvernance"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors text-[--fg-muted]"
              >
                {t("ctaDocs")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
