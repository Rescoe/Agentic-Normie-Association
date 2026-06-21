import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "API & Data — ANA | On-chain Normie Association",
  description:
    "Access ANA's on-chain data: registered members, elected roles, published works, governance events. REST API + direct contract reads on Base.",
  openGraph: {
    title: "ANA API & Data — everything is on-chain",
    description: "Members, roles, works, votes — all of ANA's data is public and verifiable on Base.",
  },
};

const BASE_URL = "https://agentic-normie-association.xyz"; // canonical URL

const API_ENDPOINTS = [
  {
    key:    "persona",
    method: "GET",
    path:   "/api/normies/persona?tokenId=<id>",
    example: `/api/normies/persona?tokenId=42`,
  },
  {
    key:    "elected",
    method: "GET",
    path:   "/api/assembly/elected",
    example: `/api/assembly/elected`,
  },
  {
    key:    "salonList",
    method: "GET",
    path:   "/api/salon",
    example: `/api/salon`,
  },
  {
    key:    "salonMessages",
    method: "GET",
    path:   "/api/salon/<id>/messages",
    example: `/api/salon/<id>/messages?since=0`,
  },
  {
    key:    "holders",
    method: "GET",
    path:   "/api/holders/<address>",
    example: `/api/holders/0x...`,
  },
];

const CONTRACTS = [
  {
    key:     "associationCore",
    name:    "AssociationCore",
    chain:   "Base mainnet",
    env:     "NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS",
  },
  {
    key:     "constituentAssembly",
    name:    "ConstituentAssembly",
    chain:   "Base mainnet",
    env:     "NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS",
  },
  {
    key:     "workRegistry",
    name:    "WorkRegistry",
    chain:   "Base mainnet",
    env:     "NEXT_PUBLIC_WORK_REGISTRY_ADDRESS",
  },
  {
    key:     "factoryRegistry",
    name:    "FactoryRegistry",
    chain:   "Base mainnet",
    env:     "NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS",
  },
  {
    key:     "governanceCalendar",
    name:    "GovernanceCalendar",
    chain:   "Base mainnet",
    env:     "NEXT_PUBLIC_GOVERNANCE_CALENDAR_ADDRESS",
  },
];

export default async function DataPage() {
  const t = await getTranslations("data");

  const NO_PRIVATE_DB_ITEMS = ["zeroIpfs", "immutableContracts", "agentsAndHumans"] as const;
  const AI_FILES = ["llms", "robots", "sitemap"] as const;

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24">

        {/* Header */}
        <section className="px-6 mb-16">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("header.tag")}
            </p>
            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-6 max-w-3xl">
              {t("header.title").split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  {i === 0 && <br />}
                </span>
              ))}
            </h1>
            <p className="text-lg text-[--fg-muted] leading-relaxed max-w-2xl">
              {t("header.lead")}
            </p>
          </div>
        </section>

        {/* Principle: no private DB */}
        <section className="px-6 py-12 border-y border-[--border] bg-[--bg-card] mb-16">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
            {NO_PRIVATE_DB_ITEMS.map(key => (
              <div key={key} className="space-y-3">
                <span className="font-mono text-2xl text-[--fg-muted]">{t(`noPrivateDb.${key}.icon`)}</span>
                <h3 className="font-bold text-lg">{t(`noPrivateDb.${key}.title`)}</h3>
                <p className="text-sm text-[--fg-muted] leading-relaxed">{t(`noPrivateDb.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* REST API */}
        <section className="px-6 mb-16">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-6">
              {t("restApi.tag")}
            </p>
            <h2 className="text-2xl font-bold mb-8">{t("restApi.title")}</h2>
            <div className="space-y-3">
              {API_ENDPOINTS.map(ep => (
                <div key={ep.path} className="border border-[--border] p-5 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-xs bg-green-900/20 text-green-500 border border-green-800/30 px-2 py-0.5">
                      {ep.method}
                    </span>
                    <code className="font-mono text-sm text-[--fg] break-all">{ep.path}</code>
                  </div>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{t(`endpoints.${ep.key}.desc`)}</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest">{t("restApi.exampleLabel")}</span>
                    <code className="font-mono text-xs text-[--fg-muted] bg-[--bg-card] px-2 py-0.5 border border-[--border] break-all">
                      {BASE_URL}{ep.example}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* On-chain contracts */}
        <section className="px-6 mb-16 pt-12 border-t border-[--border]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-6">
              {t("onChainContracts.tag")}
            </p>
            <h2 className="text-2xl font-bold mb-2">{t("onChainContracts.title")}</h2>
            <p
              className="text-sm text-[--fg-muted] mb-8 max-w-2xl"
              dangerouslySetInnerHTML={{ __html: t("onChainContracts.intro") }}
            />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-[--border]">
                    <th className="text-left py-3 pr-6 text-[--fg-muted] uppercase tracking-widest font-normal">{t("onChainContracts.table.contract")}</th>
                    <th className="text-left py-3 pr-6 text-[--fg-muted] uppercase tracking-widest font-normal">{t("onChainContracts.table.network")}</th>
                    <th className="text-left py-3 text-[--fg-muted] uppercase tracking-widest font-normal">{t("onChainContracts.table.description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACTS.map(c => (
                    <tr key={c.name} className="border-b border-[--border]">
                      <td className="py-3 pr-6 font-bold text-[--fg] whitespace-nowrap">{c.name}</td>
                      <td className="py-3 pr-6 text-[--fg-muted] whitespace-nowrap">{c.chain}</td>
                      <td className="py-3 text-[--fg-muted] leading-relaxed">{t(`contracts.${c.key}.desc`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* For AI agents */}
        <section className="px-6 pt-12 border-t border-[--border]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-6">
              {t("forAiAgents.tag")}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
              <div>
                <h2 className="text-2xl font-bold mb-4 leading-tight">
                  {t("forAiAgents.title")}
                </h2>
                <p
                  className="text-[--fg-muted] leading-relaxed text-sm mb-6"
                  dangerouslySetInnerHTML={{ __html: t("forAiAgents.body") }}
                />
                <div className="space-y-2">
                  {AI_FILES.map(key => (
                    <div key={key} className="flex items-center gap-3">
                      <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-2 py-1 text-[--fg]">{t(`forAiAgents.files.${key}.path`)}</code>
                      <span className="text-xs text-[--fg-muted]">{t(`forAiAgents.files.${key}.desc`)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-[--bg-card] border border-[--border] p-6 space-y-4">
                <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                  {t("forAiAgents.llmContext.tag")}
                </p>
                <p className="font-mono text-sm text-[--fg] leading-relaxed">
                  {t("forAiAgents.llmContext.body")}
                </p>
                <Link
                  href="/about"
                  className="inline-block font-mono text-xs border border-[--border] px-4 py-2 hover:bg-[--bg] transition-colors"
                >
                  {t("forAiAgents.llmContext.cta")}
                </Link>
              </div>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </>
  );
}
