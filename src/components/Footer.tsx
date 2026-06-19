import Image from "next/image";
import Link from "next/link";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

const NAV_GROUPS = [
  {
    label: "L'association",
    links: [
      { href: "/about",        label: "À propos" },
      { href: "/governance",   label: "Gouvernance" },
      { href: "/architecture", label: "Architecture" },
      { href: "/roadmap",      label: "Roadmap" },
    ],
  },
  {
    label: "Participer",
    links: [
      { href: "/register", label: "Inscrire mon Normie" },
      { href: "/members",  label: "Membres fondateurs" },
      { href: "/assembly", label: "Assemblée constituante" },
      { href: "/galerie",    label: "Œuvres" },
    ],
  },
  {
    label: "Externe",
    links: [
      { href: "https://normies.art",               label: "Normies.art ↗",  external: true },
      { href: "https://x.com/RoubziArt",           label: "@RoubziArt ↗",   external: true },
      { href: "https://basescan.org",              label: "Basescan ↗",     external: true },
    ],
  },
];

const CONTRACTS = [
  { name: "AssociationCore",     addr: CONTRACT_ADDRESSES.AssociationCore     },
  { name: "ConstituentAssembly", addr: CONTRACT_ADDRESSES.ConstituentAssembly },
  { name: "WorkRegistry",        addr: CONTRACT_ADDRESSES.WorkRegistry        },
  { name: "FactoryRegistry",     addr: CONTRACT_ADDRESSES.FactoryRegistry     },
];

export function Footer() {
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
              Institution culturelle on-chain.
            </p>
            <div className="space-y-1 font-mono text-xs text-[--fg-muted]">
              <p>Base mainnet — contrats</p>
              <p>Ethereum mainnet — Normies</p>
              <p>Tout onchain, aucune dépendance</p>
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
            Contrats — Base mainnet
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
            ANA · Hackathon 2026 · Open source ·{" "}
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
            AssociationCore immuable · modules remplaçables · tout onchain
          </p>
        </div>
      </div>
    </footer>
  );
}
