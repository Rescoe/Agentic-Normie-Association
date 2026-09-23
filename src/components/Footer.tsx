"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

// FactoryRegistry dropped (23/09 audit — confirmed dead, never read at
// runtime, only ever written to by deploy scripts). ANAMemorials added in
// its place — the contract that actually matters for quick Basescan access
// now (celebrations/memorials). Its address isn't NEXT_PUBLIC_-prefixed
// (Vercel rejected that name), so it's fetched client-side from
// /api/memorials/list instead, same pattern used everywhere else this
// address is needed in the browser.
const STATIC_CONTRACTS = [
  { name: "AssociationCore",      addr: CONTRACT_ADDRESSES.AssociationCore      },
  { name: "ConstituentAssembly",  addr: CONTRACT_ADDRESSES.ConstituentAssembly  },
  { name: "WorkRegistry",         addr: CONTRACT_ADDRESSES.WorkRegistry         },
  { name: "ANACollectionFactory", addr: CONTRACT_ADDRESSES.ANACollectionFactory },
];

export function Footer() {
  const t = useTranslations("footer");

  const [memorialsAddr, setMemorialsAddr] = useState("");
  useEffect(() => {
    fetch("/api/memorials/list")
      .then(r => r.json())
      .then((d: { contractAddress?: string }) => setMemorialsAddr(d.contractAddress ?? ""))
      .catch(() => setMemorialsAddr(""));
  }, []);

  const CONTRACTS = [
    ...STATIC_CONTRACTS,
    ...(memorialsAddr ? [{ name: "ANAMemorials", addr: memorialsAddr }] : []),
  ].filter(c => c.addr);

  const NAV_GROUPS = [
    {
      label: t("theAssociation"),
      links: [
        { href: "/about",        label: t("about") },
        { href: "/governance",   label: t("governance") },
        { href: "/architecture", label: t("architecture") },
        { href: "/roadmap",      label: t("roadmap") },
      ],
    },
    {
      label: t("participate"),
      links: [
        { href: "/register", label: t("registerMyNormie") },
        { href: "/members",  label: t("foundingMembers") },
        { href: "/assembly", label: t("constituentAssembly") },
        { href: "/galerie",    label: t("works") },
      ],
    },
    {
      label: t("external"),
      links: [
        { href: "https://normies.art",               label: "Normies.art ↗",  external: true },
        { href: "https://x.com/RoubziArt",           label: "@RoubziArt ↗",   external: true },
        { href: "https://basescan.org",              label: "Basescan ↗",     external: true },
      ],
    },
  ];

  return (
    <footer className="border-t border-[--border] bg-[--bg-card]">
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center gap-3 group w-fit">
              <Image
                src="/ANA.png"
                alt="ANA"
                width={32}
                height={32}
                className="w-8 h-8 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
              <span className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                ANA
              </span>
            </Link>
            <p className="text-xs text-[--fg-muted] leading-relaxed max-w-[200px]">
              Agentic Normie Association.<br />
              {t("onChainCulturalInstitution")}
            </p>
            <div className="space-y-1 font-mono text-xs text-[--fg-muted]">
              <p>{t("baseMainnetContracts")}</p>
              <p>{t("ethereumMainnetNormies")}</p>
              <p>{t("everythingOnChainNoDependency")}</p>
            </div>
          </div>

          {/* Nav groups */}
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="space-y-4">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                {group.label}
              </p>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[--fg-muted] hover:text-[--fg] transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-[--fg-muted] hover:text-[--fg] transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Contrats déployés */}
        <div className="mt-12 pt-8 border-t border-[--border] space-y-3">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            {t("contractsBaseMainnet")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {CONTRACTS.map((c) => (
              <a
                key={c.name}
                href={`https://basescan.org/address/${c.addr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group border border-[--border] px-3 py-2 hover:border-[--fg] transition-colors"
              >
                <p className="font-mono text-xs text-[--fg] group-hover:text-[--fg]">{c.name}</p>
                <p className="font-mono text-xs text-[--fg-muted] truncate">{c.addr}</p>
              </a>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-6 pt-6 border-t border-[--border] flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="font-mono text-xs text-[--fg-muted]">
            ANA · {t("hackathon2026")} · {t("openSource")} ·{" "}
            <a
              href="https://x.com/RoubziArt"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[--fg] transition-colors"
            >
              @RoubziArt
            </a>
          </p>
          <p className="font-mono text-xs text-[--fg-muted]">
            {t("immutableAssociationCoreNote")}
          </p>
        </div>
      </div>
    </footer>
  );
}
