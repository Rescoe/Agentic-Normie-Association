"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";
import { LanguageToggle } from "@/components/LanguageToggle";

// ─── Nav structure ────────────────────────────────────────────────────────────

const NAV = [
  {
    label: "Association",
    href:  "/association",
    children: [
      { href: "/register",    label: "Inscrire mon Normie",  desc: "Rejoindre l'ANA on-chain" },
      { href: "/members",     label: "Membres",              desc: "Les Normies inscrits" },
      { href: "/governance",  label: "Gouvernance",          desc: "Règles et principes" },
      { href: "/assembly",    label: "Assemblée",            desc: "Sessions et votes" },
    ],
  },
  {
    label: "Observer",
    href:  "/observer",
    children: [
      { href: "/salon",        label: "Salon des Normies",   desc: "Discussions des agents" },
      { href: "/activity",     label: "Activité on-chain",   desc: "Flux d'événements live" },
      { href: "/architecture", label: "Architecture",        desc: "Contrats et schémas" },
    ],
  },
  {
    label:    "Galerie",
    href:     "/galerie",
    children: null,
  },
  {
    label:    "API & Données",
    href:     "/data",
    children: null,
  },
];

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button
      onClick={copy}
      className="w-full text-left font-mono text-xs px-3 py-2 hover:bg-[--bg-card] transition-colors flex items-center justify-between group"
    >
      <span className="text-[--fg-muted] truncate">{text.slice(0, 10)}…{text.slice(-8)}</span>
      <span className={`shrink-0 ml-2 ${copied ? "text-green-600" : "text-[--fg-muted] group-hover:text-[--fg]"}`}>
        {copied ? "✓ copié" : "copier"}
      </span>
    </button>
  );
}

// ─── WalletButton ─────────────────────────────────────────────────────────────

function WalletButton() {
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <ConnectButton.Custom>
      {({ account, chain, openChainModal, openConnectModal, mounted }) => {
        const ready     = mounted;
        const connected = ready && account && chain;

        if (!ready) return <div aria-hidden style={{ opacity: 0, pointerEvents: "none", userSelect: "none" }}><div className="w-24 h-9" /></div>;

        if (!connected) {
          return (
            <button
              onClick={openConnectModal}
              className="font-mono text-xs border border-[--fg] text-[--fg] px-4 py-2 hover:bg-[--fg] hover:text-[--bg] transition-colors"
            >
              Connecter
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              className="font-mono text-xs border border-red-400 text-red-500 px-4 py-2 hover:bg-red-50 transition-colors"
            >
              ⚠ Réseau incorrect
            </button>
          );
        }

        return (
          <div className="relative" ref={containerRef}>
            <div className="flex items-center gap-2">
              <button
                onClick={openChainModal}
                className="hidden lg:flex items-center gap-1.5 font-mono text-xs border border-[--border] bg-[--bg-card] px-2.5 py-2 hover:bg-[--bg] transition-colors"
              >
                {chain.hasIcon && chain.iconUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={chain.iconUrl} alt="" width={12} height={12} className="shrink-0" />
                )}
                <span className="text-[--fg-muted]">{chain.name}</span>
              </button>
              <button
                onClick={() => setOpen(o => !o)}
                className={`flex items-center gap-2 font-mono text-xs border px-3 py-2 transition-colors ${open ? "border-[--fg] bg-[--bg-card]" : "border-[--border] bg-[--bg-card] hover:bg-[--bg]"}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block shrink-0" />
                <span className="text-[--fg]">{account.displayName}</span>
                {account.displayBalance && (
                  <span className="hidden xl:inline text-[--fg-muted]">· {account.displayBalance}</span>
                )}
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
                </svg>
              </button>
            </div>

            {open && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 bg-[--bg] border border-[--border]">
                <div className="px-4 py-3 border-b border-[--border] space-y-0.5">
                  <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Wallet connecté</p>
                  <p className="font-mono text-sm font-bold">{account.displayName}</p>
                  {account.displayBalance && <p className="font-mono text-xs text-[--fg-muted]">{account.displayBalance}</p>}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    {chain.hasIcon && chain.iconUrl && <img src={chain.iconUrl} alt="" width={10} height={10} />}
                    <span className="font-mono text-xs text-[--fg-muted]">{chain.name}</span>
                  </div>
                </div>
                <div className="py-1">
                  {account.address && <CopyButton text={account.address} />}
                  <a
                    href={`https://basescan.org/address/${account.address}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full text-left font-mono text-xs px-3 py-2 hover:bg-[--bg-card] transition-colors flex items-center gap-2"
                  >
                    <span>Voir sur Basescan</span><span className="text-[--fg-muted]">↗</span>
                  </a>
                  <Link
                    href="/register"
                    onClick={() => setOpen(false)}
                    className="w-full text-left font-mono text-xs px-3 py-2 hover:bg-[--bg-card] transition-colors flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
                    <span>Inscrire mes Normies</span>
                  </Link>
                  <div className="border-t border-[--border] mt-1 pt-1">
                    <button
                      onClick={() => { disconnect(); setOpen(false); }}
                      className="w-full text-left font-mono text-xs px-3 py-2 text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Déconnecter
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

// ─── Desktop dropdown item ────────────────────────────────────────────────────

function DropdownMenu({
  item,
  onClose,
}: {
  item: (typeof NAV)[number];
  onClose: () => void;
}) {
  if (!item.children) return null;
  return (
    <div className="absolute top-[calc(100%+1px)] left-1/2 -translate-x-1/2 z-50 w-64 bg-[--bg] border border-[--border] py-1 shadow-lg">
      {item.children.map(child => (
        <Link
          key={child.href}
          href={child.href}
          onClick={onClose}
          className="block px-4 py-3 hover:bg-[--bg-card] transition-colors group"
        >
          <p className="font-mono text-xs font-bold text-[--fg] group-hover:underline">{child.label}</p>
          <p className="font-mono text-[11px] text-[--fg-muted] mt-0.5">{child.desc}</p>
        </Link>
      ))}
    </div>
  );
}

// ─── Desktop nav item ─────────────────────────────────────────────────────────

function NavItem({ item }: { item: (typeof NAV)[number] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isActive = item.children
    ? item.children.some(c => pathname.startsWith(c.href))
    : pathname === item.href;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!item.children) {
    return (
      <Link
        href={item.href}
        className={`font-mono text-xs transition-colors ${isActive ? "text-[--fg]" : "text-[--fg-muted] hover:text-[--fg]"}`}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div
      className="relative"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 font-mono text-xs transition-colors ${isActive ? "text-[--fg]" : "text-[--fg-muted] hover:text-[--fg]"}`}
      >
        {item.label}
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
        </svg>
      </button>
      {open && <DropdownMenu item={item} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ─── Mobile menu ──────────────────────────────────────────────────────────────

function MobileMenu({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();

  return (
    <div className="fixed inset-0 z-40 bg-[--bg] pt-16 overflow-y-auto">
      <nav className="px-6 py-6 space-y-1">
        {/* Always-visible top link */}
        <Link
          href="/"
          onClick={onClose}
          className={`block font-mono text-sm py-3 border-b border-[--border] ${pathname === "/" ? "text-[--fg] font-bold" : "text-[--fg-muted]"}`}
        >
          Accueil
        </Link>

        {NAV.map(item => (
          <div key={item.label}>
            {item.children ? (
              <div className="pt-4 pb-1">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-2">
                  {item.label}
                </p>
                <div className="space-y-0 border-l-2 border-[--border] pl-4">
                  {item.children.map(child => (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={onClose}
                      className={`block py-2.5 font-mono text-sm ${pathname.startsWith(child.href) ? "text-[--fg] font-bold" : "text-[--fg-muted]"}`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <Link
                href={item.href}
                onClick={onClose}
                className={`block font-mono text-sm py-3 border-b border-[--border] ${pathname === item.href ? "text-[--fg] font-bold" : "text-[--fg-muted]"}`}
              >
                {item.label}
              </Link>
            )}
          </div>
        ))}

        {/* CTA */}
        <div className="pt-6">
          <Link
            href="/register"
            onClick={onClose}
            className="flex items-center justify-center gap-2 bg-[--fg] text-[--bg] font-mono text-sm px-6 py-3 hover:opacity-80 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
            Inscrire mon Normie
          </Link>
        </div>

        <div className="pt-4 flex items-center justify-between">
          <a
            href="https://normies.art"
            target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs text-[--fg-muted] underline"
          >
            normies.art ↗
          </a>
          <LanguageToggle />
        </div>
      </nav>
    </div>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-[--bg]/95 backdrop-blur-sm border-b border-[--border]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group shrink-0">
            <Image
              src="/ANA.png" alt="ANA" width={32} height={32}
              className="w-8 h-8 object-contain group-hover:opacity-70 transition-opacity"
              style={{ imageRendering: "pixelated" }}
            />
            <Image
              src="/logo_img.png" alt="Agentic Normie Association" width={140} height={32}
              className="h-6 w-auto object-contain group-hover:opacity-70 transition-opacity"
              style={{ imageRendering: "pixelated" }}
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {NAV.map(item => <NavItem key={item.label} item={item} />)}

            <div className="w-px h-4 bg-[--border]" />

            <LanguageToggle />

            <Link
              href="/register"
              className="flex items-center gap-1.5 font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 transition-opacity"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
              S'inscrire
            </Link>

            <WalletButton />
          </nav>

          {/* Mobile: wallet + burger */}
          <div className="md:hidden flex items-center gap-3">
            <WalletButton />
            <button
              onClick={() => setMobileOpen(o => !o)}
              aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
              className="p-2 text-[--fg] border border-[--border] bg-[--bg-card] hover:bg-[--bg] transition-colors"
            >
              {mobileOpen ? (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileOpen && <MobileMenu onClose={() => setMobileOpen(false)} />}
    </>
  );
}
