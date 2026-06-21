import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Documentation — ANA",
  description: "Technical documentation for the Agentic Normie Association: API, contracts, governance, creation process.",
};

export default async function DocsPage() {
  const t = await getTranslations("docs");

  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">{t("eyebrow")}</p>
        <h1 className="text-4xl font-bold leading-tight mb-4">
          {t("title")}
        </h1>
        <p className="text-[--fg-muted] leading-relaxed max-w-2xl">
          {t("intro")}
        </p>
      </div>

      {/* Layer diagram */}
      <div className="space-y-0">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-4">{t("layerModel.heading")}</p>
        {[
          {
            layer: t("layerModel.layer3.layer"),
            desc: t("layerModel.layer3.desc"),
            tag: t("layerModel.layer3.tag"),
            color: "border-green-400/40 bg-green-950/10",
            badge: "text-green-500 border-green-500/30",
          },
          {
            layer: t("layerModel.layer2.layer"),
            desc: t("layerModel.layer2.desc"),
            tag: t("layerModel.layer2.tag"),
            color: "border-[--fg]/30 bg-[--bg-card]",
            badge: "text-[--fg] border-[--fg]/20",
          },
          {
            layer: t("layerModel.layer1.layer"),
            desc: t("layerModel.layer1.desc"),
            tag: t("layerModel.layer1.tag"),
            color: "border-blue-400/40 bg-blue-950/10",
            badge: "text-blue-400 border-blue-400/30",
          },
          {
            layer: t("layerModel.layer0.layer"),
            desc: t("layerModel.layer0.desc"),
            tag: t("layerModel.layer0.tag"),
            color: "border-[--border] bg-[--bg]",
            badge: "text-[--fg-muted] border-[--border]",
          },
        ].map((l, i) => (
          <div key={i} className={`border ${l.color} px-5 py-4 flex items-center justify-between`}>
            <div>
              <p className="font-mono text-xs font-bold">{l.layer}</p>
              <p className="font-mono text-[11px] text-[--fg-muted] mt-0.5">{l.desc}</p>
            </div>
            <span className={`font-mono text-[10px] border px-2 py-0.5 shrink-0 ml-4 ${l.badge}`}>{l.tag}</span>
          </div>
        ))}
      </div>

      {/* What flows through */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-4">{t("dataFlow.heading")}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[--border]">
          {[
            {
              title: "normie.art → ANA",
              items: [
                t("dataFlow.normieToAna.item1"),
                t("dataFlow.normieToAna.item2"),
                "ownerOf(tokenId) — EIP-712 attestation",
                t("dataFlow.normieToAna.item4"),
              ],
              color: "text-blue-400",
            },
            {
              title: "ANA → Blockchain",
              items: [
                t("dataFlow.anaToBlockchain.item1"),
                t("dataFlow.anaToBlockchain.item2"),
                t("dataFlow.anaToBlockchain.item3"),
                t("dataFlow.anaToBlockchain.item4"),
              ],
              color: "text-[--fg]",
            },
            {
              title: "ANA API → World",
              items: [
                t("dataFlow.anaApiToWorld.item1"),
                t("dataFlow.anaApiToWorld.item2"),
                t("dataFlow.anaApiToWorld.item3"),
                t("dataFlow.anaApiToWorld.item4"),
              ],
              color: "text-green-400",
            },
          ].map(col => (
            <div key={col.title} className="bg-[--bg] p-5 space-y-3">
              <p className={`font-mono text-xs font-bold ${col.color}`}>{col.title}</p>
              <ul className="space-y-1.5">
                {col.items.map(item => (
                  <li key={item} className="font-mono text-[11px] text-[--fg-muted] flex gap-2">
                    <span className="opacity-40">→</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links to docs sub-pages */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-4">{t("sections.heading")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { href: "/docs/api",         title: t("sections.api.title"),        desc: t("sections.api.desc") },
            { href: "/docs/contracts",   title: t("sections.contracts.title"),  desc: t("sections.contracts.desc") },
            { href: "/docs/gouvernance", title: t("sections.governance.title"), desc: t("sections.governance.desc") },
            { href: "/docs/creation",    title: t("sections.creation.title"),   desc: t("sections.creation.desc") },
          ].map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="block border border-[--border] p-5 hover:bg-[--bg-card] transition-colors group"
            >
              <p className="font-mono text-xs font-bold group-hover:underline mb-1">{item.title} →</p>
              <p className="font-mono text-[11px] text-[--fg-muted] leading-relaxed">{item.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
