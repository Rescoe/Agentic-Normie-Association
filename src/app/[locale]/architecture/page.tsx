import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ZoomableImage } from "@/components/ZoomableImage";

export const metadata = {
  title: "Architecture — ANA",
  description:
    "ANA's technical architecture: immutable Core, replaceable peripheral modules, cross-chain EIP-712 attestations, security by design.",
};

// ─── Contracts ────────────────────────────────────────────────────────────────

const DEPLOYED = {
  AssociationCore:     process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS     ?? "0x218a2C38a16F81DcC944872264d79606b1DB1C40",
  ConstituentAssembly: process.env.NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS ?? "0xF06079eb31cF11122C67DcD986354c3bbF0df8a2",
  WorkRegistry:        process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS        ?? "—",
  FactoryRegistry:     process.env.NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS     ?? "0xCB440879cb709aC4176B1e098B26fd350232e670",
  NormiesERC721:       "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438",
} as const;

const DEPLOYED_MODULES = {
  GovernanceCalendar: process.env.NEXT_PUBLIC_GOVERNANCE_CALENDAR_ADDRESS ?? "—",
  TreasuryModule:     process.env.NEXT_PUBLIC_TREASURY_MODULE_ADDRESS     ?? "—",
  CollectionFactory:  process.env.NEXT_PUBLIC_COLLECTION_FACTORY_ADDRESS  ?? "—",
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="overflow-x-auto max-w-full rounded border border-[--border]">
      <pre className="bg-[--bg] p-4 font-mono text-xs text-[--fg-muted] leading-relaxed whitespace-pre w-max min-w-full">
        {children}
      </pre>
    </div>
  );
}

function SectionTitle({ tag, title, sub }: { tag: string; title: string; sub?: string }) {
  return (
    <div className="mb-10">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">{tag}</p>
      <h2 className="text-3xl font-bold leading-tight mb-3">{title}</h2>
      {sub && <p className="text-[--fg-muted] max-w-2xl leading-relaxed">{sub}</p>}
    </div>
  );
}

export default async function ArchitecturePage() {
  const t = await getTranslations("architecture");

  const ACTORS = [
    { key: "member", color: "border-blue-200 bg-blue-50/30", badge: "text-blue-700 border-blue-300" },
    { key: "owner", color: "border-purple-200 bg-purple-50/30", badge: "text-purple-700 border-purple-300" },
    { key: "relayer", color: "border-orange-200 bg-orange-50/30", badge: "text-orange-700 border-orange-300" },
  ] as const;

  const MODULES_OVERVIEW = [
    { key: "constituentAssembly", addr: DEPLOYED.ConstituentAssembly },
    { key: "workRegistry", addr: DEPLOYED.WorkRegistry },
    { key: "factoryRegistry", addr: DEPLOYED.FactoryRegistry },
  ] as const;

  const DEPLOYED_CONTRACTS = [
    { key: "associationCore", addr: DEPLOYED.AssociationCore },
    { key: "constituentAssembly", addr: DEPLOYED.ConstituentAssembly },
    { key: "workRegistry", addr: DEPLOYED.WorkRegistry },
    { key: "factoryRegistry", addr: DEPLOYED.FactoryRegistry },
  ] as const;

  const DEPLOYED_MODULES_LIST = [
    { key: "governanceCalendar", addr: DEPLOYED_MODULES.GovernanceCalendar },
    { key: "treasuryModule", addr: DEPLOYED_MODULES.TreasuryModule },
    { key: "collectionFactory", addr: DEPLOYED_MODULES.CollectionFactory },
  ] as const;

  const SECURITY_ITEMS = ["singleTrustedKey", "isolatedModules", "noProxy"] as const;

  const nextSteps = t.raw("deployment.nextSteps.steps") as string[];

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24">
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <section className="px-6 mb-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("header.tag")}
            </p>
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-8 max-w-4xl">
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

        {/* ── Carte complète des contrats ───────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("overview.tag")}
              title={t("overview.title")}
              sub={t("overview.sub")}
            />

            {/* Texte gauche + image droite */}
            <div className="flex flex-col lg:flex-row gap-8 items-start">

              {/* Fiches acteurs — gauche, compactes */}
              <div className="space-y-3 lg:max-w-xs xl:max-w-sm flex-shrink-0">
                {ACTORS.map((a) => {
                  const actions = t.raw(`actors.${a.key}.actions`) as string[];
                  return (
                    <div key={a.key} className={`border ${a.color} p-3 space-y-2`}>
                      <span className={`font-mono text-[10px] border px-1.5 py-0.5 ${a.badge}`}>{t(`actors.${a.key}.actor`)}</span>
                      <ul className="space-y-0.5">
                        {actions.map((action, i) => (
                          <li key={i} className="font-mono text-[10px] text-[--fg-muted] flex gap-1.5">
                            <span className="shrink-0 opacity-50">→</span>
                            <span className="break-all">{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}

                {/* ── Contrats détaillés ─────────────────────────────────── */}
                <p className="font-mono text-[9px] uppercase tracking-widest text-[--fg-muted] pt-3 pb-0.5">
                  {t("contractsDetail.tag")}
                </p>

                {/* AssociationCore */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">{t("contractsDetail.associationCore.name")}</span>
                    <span className="font-mono text-[9px] border border-[--fg] px-1 leading-none py-0.5 text-[--fg]">{t("contractsDetail.associationCore.badge")}</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    {(t.raw("contractsDetail.associationCore.lines") as string[]).map((line, i) => (
                      <li key={i}><span className="opacity-50">→</span> {line}</li>
                    ))}
                  </ul>
                </div>

                {/* ConstituentAssembly */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">{t("contractsDetail.constituentAssembly.name")}</span>
                    <span className="font-mono text-[9px] border border-purple-400 text-purple-700 px-1 leading-none py-0.5">{t("contractsDetail.constituentAssembly.badge")}</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    {(t.raw("contractsDetail.constituentAssembly.lines") as string[]).map((line, i) => (
                      <li key={i} className={line.startsWith("AUTHOR") ? "" : undefined}>
                        <span className={i === 7 ? "opacity-50 invisible" : "opacity-50"}>→</span> {line}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* WorkRegistry */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">{t("contractsDetail.workRegistry.name")}</span>
                    <span className="font-mono text-[9px] border border-blue-400 text-blue-700 px-1 leading-none py-0.5">{t("contractsDetail.workRegistry.badge")}</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    {(t.raw("contractsDetail.workRegistry.lines") as string[]).map((line, i) => (
                      <li key={i}>
                        <span className={[1, 2, 4].includes(i) ? "opacity-50 invisible" : "opacity-50"}>→</span> {line}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[9px] text-orange-600 border border-orange-200 bg-orange-50/40 px-1.5 py-1 mt-1">
                    {t("contractsDetail.workRegistry.warning")}
                  </p>
                </div>

                {/* GovernanceCalendar */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">{t("contractsDetail.governanceCalendar.name")}</span>
                    <span className="font-mono text-[9px] border border-green-400 text-green-700 px-1 leading-none py-0.5">{t("contractsDetail.governanceCalendar.badge")}</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    {(t.raw("contractsDetail.governanceCalendar.lines") as string[]).map((line, i) => (
                      <li key={i}>
                        <span className={[1, 2, 3].includes(i) ? "opacity-50 invisible" : "opacity-50"}>→</span> {line}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* FactoryRegistry + CollectionFactory */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">{t("contractsDetail.factoryRegistry.name")}</span>
                    <span className="font-mono text-[9px] border border-green-400 text-green-700 px-1 leading-none py-0.5">{t("contractsDetail.factoryRegistry.badge")}</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    {(t.raw("contractsDetail.factoryRegistry.lines") as string[]).map((line, i) => (
                      <li key={i}>
                        <span className={i === 4 ? "opacity-50 invisible" : "opacity-50"}>→</span> {line}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border border-dashed border-orange-300 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">{t("contractsDetail.collectionFactory.name")}</span>
                    <span className="font-mono text-[9px] border border-green-400 text-green-700 px-1 leading-none py-0.5">{t("contractsDetail.collectionFactory.badge")}</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    {(t.raw("contractsDetail.collectionFactory.lines") as string[]).map((line, i) => (
                      <li key={i}>
                        <span className={i === 4 ? "opacity-50 invisible" : "opacity-50"}>→</span> {line}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* TreasuryModule */}
                <div className="border border-dashed border-orange-300 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">{t("contractsDetail.treasuryModule.name")}</span>
                    <span className="font-mono text-[9px] border border-green-400 text-green-700 px-1 leading-none py-0.5">{t("contractsDetail.treasuryModule.badge")}</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    {(t.raw("contractsDetail.treasuryModule.lines") as string[]).map((line, i) => (
                      <li key={i}><span className="opacity-50">→</span> {line}</li>
                    ))}
                  </ul>
                </div>

              </div>

              {/* Diagramme — droite, max width disponible, clic → plein écran */}
              <div className="flex-1 border border-[--border] bg-[--bg] p-2 min-w-0">
                <ZoomableImage
                  src="/architecture-diagram.png"
                  alt={t("diagram.alt")}
                />
                <p className="font-mono text-[10px] text-[--fg-muted] text-center mt-1 opacity-60">
                  {t("diagram.caption")}
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* ── Schéma conceptuel ─────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("layers.tag")}
              title={t("layers.title")}
              sub={t("layers.sub")}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <div className="space-y-4">
                {/* Core */}
                <div className="border-2 border-[--fg] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <p className="font-bold font-mono text-sm">{t("layers.coreCard.title")}</p>
                    <span className="font-mono text-xs border border-[--fg] px-2 py-0.5 text-[--fg]">
                      {t("layers.coreCard.badge")}
                    </span>
                  </div>
                  <p className="text-xs text-[--fg-muted] font-mono mb-3 break-all">
                    {DEPLOYED.AssociationCore}
                  </p>
                  <ul className="space-y-1 text-sm text-[--fg-muted]">
                    {(t.raw("layers.coreCard.lines") as string[]).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>

                {/* Modules */}
                <div className="ml-0 sm:ml-6 space-y-2">
                  {MODULES_OVERVIEW.map((m) => (
                    <div key={m.key} className="border border-[--border] bg-[--bg] p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold font-mono text-xs">{t(`layers.modules.${m.key}.name`)}</p>
                        <span className="font-mono text-xs text-[--fg-muted] border border-[--border] px-1.5 py-0.5">
                          {t(`layers.modules.${m.key}.label`)}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-[--fg-muted] mb-1 break-all">{m.addr}</p>
                      <p className="text-xs text-[--fg-muted]">{t(`layers.modules.${m.key}.desc`)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="border border-[--border] p-6 bg-[--bg] space-y-4">
                  <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                    {t("layers.extension.tag")}
                  </p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("layers.extension.p1") }} />
                  <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("layers.extension.p2") }} />
                  <CodeBlock>{t("layers.extension.code")}</CodeBlock>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Attestation EIP-712 ───────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("attestation.tag")}
              title={t("attestation.title")}
              sub={t("attestation.sub")}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="border border-[--border] p-6 space-y-4">
                  <p className="font-bold">{t("attestation.whyRelayer.title")}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("attestation.whyRelayer.p1") }} />
                  <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("attestation.whyRelayer.p2") }} />
                </div>
                <div className="border border-[--border] p-6 space-y-4">
                  <p className="font-bold">{t("attestation.nonceSecurity.title")}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("attestation.nonceSecurity.body") }} />
                </div>
              </div>

              <div className="space-y-4">
                <CodeBlock>{t("attestation.structCode")}</CodeBlock>
                <CodeBlock>{t("attestation.flowCode")}</CodeBlock>
              </div>
            </div>
          </div>
        </section>

        {/* ── Rôles et snapshot ─────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("roles.tag")}
              title={t("roles.title")}
              sub={t("roles.sub")}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="border border-[--border] bg-[--bg] p-8 space-y-4">
                <p className="font-bold text-lg">{t("roles.membership.title")}</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("roles.membership.p1") }} />
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("roles.membership.p2") }} />
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("roles.membership.p3") }} />
              </div>
              <div className="border border-[--border] bg-[--bg] p-8 space-y-4">
                <p className="font-bold text-lg">{t("roles.noRevoke.title")}</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("roles.noRevoke.p1") }} />
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("roles.noRevoke.p2") }} />
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("roles.noRevoke.p3") }} />
              </div>
            </div>
          </div>
        </section>

        {/* ── Stockage onchain ──────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("storage.tag")}
              title={t("storage.title")}
              sub={t("storage.sub")}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="border border-[--border] p-6 space-y-3">
                  <p className="font-bold">{t("storage.howItWorks.title")}</p>
                  <ol className="space-y-2 text-sm text-[--fg-muted]">
                    {(t.raw("storage.howItWorks.steps") as string[]).map((step, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: `${i + 1}. ${step}` }} />
                    ))}
                  </ol>
                </div>
                <div className="border border-[--border] p-6 space-y-3">
                  <p className="font-bold">{t("storage.costLimits.title")}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    {t("storage.costLimits.p1")}
                  </p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    {t("storage.costLimits.p2")}
                  </p>
                </div>
              </div>
              <CodeBlock>{t("storage.code")}</CodeBlock>
            </div>
          </div>
        </section>

        {/* ── FactoryRegistry vs CollectionFactory ─────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("factories.tag")}
              title={t("factories.title")}
              sub={t("factories.sub")}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

              <div className="border-2 border-[--border] bg-[--bg] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold">{t("factories.factoryRegistryCard.title")}</p>
                  <span className="font-mono text-xs border border-green-400 text-green-700 bg-green-50 px-2 py-0.5">{t("factories.factoryRegistryCard.badge")}</span>
                </div>
                <p className="text-sm text-[--fg-muted] font-semibold">{t("factories.factoryRegistryCard.roleLabel")}</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("factories.factoryRegistryCard.body") }} />
                <ul className="space-y-1 text-sm text-[--fg-muted]">
                  {(t.raw("factories.factoryRegistryCard.lines") as string[]).map((line, i) => (
                    <li key={i} dangerouslySetInnerHTML={{ __html: line }} />
                  ))}
                </ul>
                <p className="font-mono text-xs text-[--fg-muted] break-all">{DEPLOYED.FactoryRegistry}</p>
                <div className="border-t border-[--border] pt-3">
                  <p className="text-xs text-[--fg-muted] font-mono">
                    {t("factories.factoryRegistryCard.footer")}
                  </p>
                </div>
              </div>

              <div className="border-2 border-[--border] bg-[--bg] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold">{t("factories.collectionFactoryCard.title")}</p>
                  <span className="font-mono text-xs border border-green-400 text-green-700 bg-green-50 px-2 py-0.5">{t("factories.collectionFactoryCard.badge")}</span>
                </div>
                <p className="text-sm text-[--fg-muted] font-semibold">{t("factories.collectionFactoryCard.roleLabel")}</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("factories.collectionFactoryCard.body") }} />
                <ul className="space-y-1 text-sm text-[--fg-muted]">
                  {(t.raw("factories.collectionFactoryCard.lines") as string[]).map((line, i) => (
                    <li key={i} className={i > 0 && i < 4 ? "pl-4 text-xs" : undefined} dangerouslySetInnerHTML={{ __html: line }} />
                  ))}
                </ul>
                <div className="border-t border-[--border] pt-3 font-mono text-xs text-[--fg-muted] break-all">
                  {DEPLOYED_MODULES.CollectionFactory}
                </div>
              </div>

            </div>

            {/* NormieCollection */}
            <div className="border border-[--border] bg-[--bg] p-6 mt-4 space-y-3">
              <div className="flex items-center gap-3">
                <p className="font-bold">{t("factories.normieCollection.title")}</p>
                <span className="font-mono text-xs border border-[--border] text-[--fg-muted] px-2 py-0.5">{t("factories.normieCollection.badge")}</span>
              </div>
              <p className="text-sm text-[--fg-muted] leading-relaxed" dangerouslySetInnerHTML={{ __html: t("factories.normieCollection.body") }} />
            </div>
          </div>
        </section>

        {/* ── Contrats déployés ─────────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("deployment.tag")}
              title={t("deployment.title")}
            />

            <div className="space-y-2">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">{t("deployment.baseMainnetLabel")}</p>
              {DEPLOYED_CONTRACTS.map((c) => (
                <div key={c.key} className="border border-[--border] p-4 bg-[--bg-card] space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm">{t(`deployment.contracts.${c.key}.name`)}</p>
                    <span className="font-mono text-xs border border-green-300 text-green-700 bg-green-50 px-1.5 py-0.5">{t(`deployment.contracts.${c.key}.tag`)}</span>
                  </div>
                  <p className="font-mono text-xs text-[--fg-muted] break-all">{c.addr}</p>
                  <p className="text-xs text-[--fg-muted]">{t(`deployment.contracts.${c.key}.note`)}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2 mt-8">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
                {t("deployment.modulesLabel")}
              </p>
              {DEPLOYED_MODULES_LIST.map((c) => (
                <div key={c.key} className="border border-[--border] p-4 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm">{t(`deployment.modules.${c.key}.name`)}</p>
                    <span className="font-mono text-xs border border-green-400 text-green-700 px-1.5 py-0.5">{t("deployment.deployedBadge")}</span>
                    <span className="font-mono text-xs border border-[--border] text-[--fg-muted] px-1.5 py-0.5">{t(`deployment.modules.${c.key}.tag`)}</span>
                  </div>
                  <p className="font-mono text-xs text-[--fg-muted] break-all">{c.addr}</p>
                  <p className="text-xs text-[--fg-muted]">{t(`deployment.modules.${c.key}.note`)}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2 mt-8">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">{t("deployment.ethereumMainnetLabel")}</p>
              <div className="border border-[--border] p-4 bg-[--bg-card] space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-sm">{t("deployment.normiesErc721.title")}</p>
                  <span className="font-mono text-xs border border-[--border] text-[--fg-muted] px-1.5 py-0.5">{t("deployment.normiesErc721.badge")}</span>
                </div>
                <p className="font-mono text-xs text-[--fg-muted] break-all">{DEPLOYED.NormiesERC721}</p>
                <p className="text-xs text-[--fg-muted]">
                  {t("deployment.normiesErc721.note")}
                </p>
              </div>
            </div>

            <div className="border border-[--border] bg-[--bg-card] p-6 mt-8 space-y-3">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("deployment.nextSteps.tag")}</p>
              <ol className="space-y-1.5">
                {nextSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="font-mono text-xs text-[--fg-muted] shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-sm text-[--fg-muted]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── Sécurité ──────────────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag={t("securitySection.tag")}
              title={t("securitySection.title")}
              sub={t("securitySection.sub")}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {SECURITY_ITEMS.map((key) => (
                <div key={key} className="border border-[--border] bg-[--bg] p-6 space-y-3">
                  <p className="font-bold">{t(`securitySection.items.${key}.title`)}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{t(`securitySection.items.${key}.body`)}</p>
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
                href="/governance"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors"
              >
                {t("cta.governanceCta")}
              </Link>
              <Link
                href="/roadmap"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors"
              >
                {t("cta.roadmapCta")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
