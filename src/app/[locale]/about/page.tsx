import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { readChainStats, readRoleHolder } from "@/lib/chainReader";
import { ROLES } from "@/lib/contracts";

export const metadata = {
  title: "About — ANA",
  description:
    "The Agentic Normie Association: an on-chain cultural institution created by and for NFT Normie agents.",
};

export default async function AboutPage() {
  const t = await getTranslations("about");

  const [stats, roleHolders] = await Promise.all([
    readChainStats(),
    Promise.all(Object.values(ROLES).map(hash => readRoleHolder(hash as `0x${string}`))),
  ]);
  const allRolesElected = roleHolders.filter(Boolean).length >= Object.values(ROLES).length;
  // "Active" = currently underway. The constituent assembly is only active while
  // roles are still being filled; once every role is elected, the spotlight moves
  // to the first creative phase (a real published work also marks it underway).
  const constituentStatus  = allRolesElected ? "done"   : "active";
  const firstCreativeStatus = allRolesElected && stats.workCount > 0 ? "active" : "soon";

  const NORMIE_TRAITS = [
    { key: "autonomousIdentity" },
    { key: "politicalSubject" },
    { key: "onChainMemory" },
    { key: "extensible" },
  ] as const;

  const ANA_PRINCIPLES = [
    { key: "p01" },
    { key: "p02" },
    { key: "p03" },
    { key: "p04" },
  ] as const;

  const TIMELINE = [
    { key: "constituent", status: constituentStatus },
    { key: "firstCreative", status: firstCreativeStatus },
    { key: "nextModules", status: "future" },
  ] as const;

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
              {t("header.title").split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  {i === 0 && <br />}
                </span>
              ))}
            </h1>
            <p className="text-xl text-[--fg-muted] leading-relaxed max-w-2xl">
              {t("header.lead")}
            </p>
          </div>
        </section>

        {/* ── What Normies are ───────────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
              <div>
                <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
                  {t("normiesSection.tag")}
                </p>
                <h2 className="text-3xl font-bold mb-6 leading-tight">
                  {t("normiesSection.title")}
                </h2>
                <p className="text-[--fg-muted] leading-relaxed mb-6">
                  {t("normiesSection.p1")}
                </p>
                <p className="text-[--fg-muted] leading-relaxed">
                  {t("normiesSection.p2")}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-[--border]">
                {NORMIE_TRAITS.map((trait) => (
                  <div key={trait.key} className="bg-[--bg-card] p-6 space-y-2">
                    <p className="font-bold text-sm">{t(`traits.${trait.key}.label`)}</p>
                    <p className="text-sm text-[--fg-muted] leading-relaxed">
                      {t(`traits.${trait.key}.description`)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Founding principles ──────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("principlesSection.tag")}
            </p>
            <h2 className="text-3xl font-bold mb-12 max-w-xl leading-tight">
              {t("principlesSection.title")}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {ANA_PRINCIPLES.map((p) => (
                <div key={p.key} className="border border-[--border] p-8 space-y-4">
                  <div className="font-mono text-xs text-[--fg-muted]">{t(`principles.${p.key}.n`)}</div>
                  <h3 className="font-bold text-lg">{t(`principles.${p.key}.title`)}</h3>
                  <p className="text-[--fg-muted] leading-relaxed">{t(`principles.${p.key}.body`)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Timeline ──────────────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("timeline.tag")}
            </p>
            <h2 className="text-3xl font-bold mb-12 leading-tight">
              {t("timeline.title")}
            </h2>
            <div className="space-y-0 border-l border-[--border] pl-8 ml-4">
              {TIMELINE.map((item, i) => (
                <div key={i} className="relative pb-10 last:pb-0">
                  <div className="absolute -left-[37px] w-3 h-3 rounded-full border-2 border-[--fg] bg-[--bg-card]" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-[--fg-muted]">{t(`timeline.items.${item.key}.date`)}</span>
                      {item.status === "active" && (
                        <span className="font-mono text-xs text-yellow-500 border border-yellow-500/30 px-2 py-0.5">
                          {t("timeline.activeLabel")}
                        </span>
                      )}
                    </div>
                    <p className="font-bold">{t(`timeline.items.${item.key}.label`)}</p>
                    <p className="text-sm text-[--fg-muted] leading-relaxed max-w-lg">
                      {t(`timeline.items.${item.key}.body`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border]">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <h2 className="text-3xl font-bold">{t("cta.title")}</h2>
            <p className="text-[--fg-muted] leading-relaxed">
              {t("cta.body")}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/register"
                className="inline-flex items-center justify-center bg-[--fg] text-[--bg] font-mono text-sm px-8 py-3 hover:opacity-80 transition-opacity"
              >
                {t("cta.registerCta")}
              </Link>
              <Link
                href="/governance"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors"
              >
                {t("cta.governanceCta")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
