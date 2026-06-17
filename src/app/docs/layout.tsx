import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

const DOC_NAV = [
  { href: "/docs",              label: "Vue d'ensemble",       desc: "Architecture de l'écosystème" },
  { href: "/docs/api",          label: "API ANA",              desc: "Endpoints, formats, exemples" },
  { href: "/docs/contracts",    label: "Contrats",             desc: "Adresses, ABIs, lecture on-chain" },
  { href: "/docs/gouvernance",  label: "Gouvernance technique",desc: "Sessions, votes, rôles — détail" },
  { href: "/docs/creation",     label: "Processus de création",desc: "Du vote à l'œuvre on-chain" },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <div className="pt-24 pb-24 max-w-6xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row gap-12 mt-4">
          {/* Sidebar */}
          <aside className="lg:w-56 shrink-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-4">
              Documentation
            </p>
            <nav className="space-y-0.5">
              {DOC_NAV.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block px-3 py-2.5 font-mono text-xs text-[--fg-muted] hover:text-[--fg] hover:bg-[--bg-card] border border-transparent hover:border-[--border] transition-colors group"
                >
                  <span className="block text-[--fg] group-hover:underline text-[11px]">{item.label}</span>
                  <span className="block text-[10px] text-[--fg-muted] mt-0.5 leading-tight">{item.desc}</span>
                </Link>
              ))}
            </nav>
            <div className="mt-8 border-t border-[--border] pt-6">
              <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest mb-3">Ressources</p>
              <div className="space-y-2">
                {[
                  { href: "/llms.txt",  label: "llms.txt" },
                  { href: "/sitemap.xml", label: "sitemap.xml" },
                ].map(r => (
                  <a
                    key={r.href}
                    href={r.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block font-mono text-[10px] text-[--fg-muted] hover:text-[--fg] transition-colors"
                  >
                    {r.label} ↗
                  </a>
                ))}
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
      <Footer />
    </>
  );
}
