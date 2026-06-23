"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export function GallerySubNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const tabs = [
    { href: "/galerie",              label: t("spontaneousWorks") },
    { href: "/galerie/celebrations", label: t("celebrations") },
  ];

  return (
    <nav className="px-6 mb-12">
      <div className="max-w-6xl mx-auto flex gap-6 border-b border-[--border]">
        {tabs.map(tab => {
          const active = tab.href === "/galerie" ? pathname === "/galerie" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`font-mono text-xs uppercase tracking-widest pb-3 -mb-px border-b-2 transition-colors ${
                active ? "border-[--fg] text-[--fg]" : "border-transparent text-[--fg-muted] hover:text-[--fg]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
