import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("docsLayout");

  const DOC_NAV = [
    { href: "/docs",              label: t("nav.overview.label"),    desc: t("nav.overview.desc") },
    { href: "/docs/api",          label: t("nav.api.label"),         desc: t("nav.api.desc") },
    { href: "/docs/contracts",    label: t("nav.contracts.label"),   desc: t("nav.contracts.desc") },
    { href: "/docs/gouvernance",  label: t("nav.governance.label"),  desc: t("nav.governance.desc") },
    { href: "/docs/creation",     label: t("nav.creation.label"),    desc: t("nav.creation.desc") },
  ];

  return (
    <>
      <Navbar />
      <div className="pt-24 pb-24 max-w-6xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row gap-12 mt-4">
          {/* Sidebar */}
          <aside className="lg:w-56 shrink-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-4">
              {t("documentation")}
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
              <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-widest mb-3">{t("resources")}</p>
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
