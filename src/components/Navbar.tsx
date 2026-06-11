"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";

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
      <span className="text-[--fg-muted] truncate">
        {text.slice(0, 10)}…{text.slice(-8)}
      </span>
      <span className={`shrink-0 ml-2 ${copied ? "text-green-600" : "text-[--fg-muted] group-hover:text-[--fg]"}`}>
        {copied ? "✓ copié" : "copier"}
      </span>
    </button>
  );
}

// ─── WalletButton ─────────────────────────────────────────────────────────────
//
// Rendu 100 % custom — aucune modal ou popup RainbowKit, seulement le
// mécanisme de connexion de wagmi est conservé.
//
// États :
//   non connecté  → bouton "Connecter" (ouvre la modal de sélection de wallet)
//   mauvais réseau → chip rouge
//   connecté      → chip réseau + chip compte → dropdown ANA
// ─────────────────────────────────────────────────────────────────────────────

function WalletButton() {
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ferme le dropdown au clic extérieur
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Ferme aussi à Escape
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

        if (!ready) {
          return (
            <div aria-hidden style={{ opacity: 0, pointerEvents: "none", userSelect: "none" }}>
              <div className="w-24 h-9" />
            </div>
          );
        }

        // ── Non connecté ────────────────────────────────────────────────────
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

        // ── Mauvais réseau ──────────────────────────────────────────────────
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

        // ── Connecté — chip + dropdown ────────────────────────────────────
        return (
          <div className="relative" ref={containerRef}>
            <div className="flex items-center gap-2">
              {/* Chip réseau */}
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

              {/* Chip compte — ouvre notre dropdown */}
              <button
                onClick={() => setOpen((o) => !o)}
                className={`flex items-center gap-2 font-mono text-xs border px-3 py-2 transition-colors ${
                  open
                    ? "border-[--fg] bg-[--bg-card]"
                    : "border-[--border] bg-[--bg-card] hover:bg-[--bg]"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block shrink-0" />
                <span className="text-[--fg]">{account.displayName}</span>
                {account.displayBalance && (
                  <span className="hidden xl:inline text-[--fg-muted]">
                    · {account.displayBalance}
                  </span>
                )}
                <svg
                  width="10" height="6" viewBox="0 0 10 6" fill="none"
                  className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                >
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                </svg>
              </button>
            </div>

            {/* ── Dropdown ANA ─────────────────────────────────────────────── */}
            {open && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 bg-[--bg] border border-[--border]">

                {/* En-tête */}
                <div className="px-4 py-3 border-b border-[--border] space-y-0.5">
                  <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">
                    Wallet connecté
                  </p>
                  <p className="font-mono text-sm font-bold">{account.displayName}</p>
                  {account.displayBalance && (
                    <p className="font-mono text-xs text-[--fg-muted]">
                      {account.displayBalance}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    {chain.hasIcon && chain.iconUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={chain.iconUrl} alt="" width={10} height={10} />
                    )}
                    <span className="font-mono text-xs text-[--fg-muted]">{chain.name}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="py-1">
                  {account.address && <CopyButton text={account.address} />}

                  <a
                    href={`https://basescan.org/address/${account.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full text-left font-mono text-xs px-3 py-2 hover:bg-[--bg-card] transition-colors flex items-center gap-2"
                  >
                    <span>Voir sur Basescan</span>
                    <span className="text-[--fg-muted]">↗</span>
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

// ─── Navbar ───────────────────────────────────────────────────────────────────

export function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[--bg]/95 backdrop-blur-sm border-b border-[--border]">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group shrink-0">
          <Image
            src="/ANA.png"
            alt="ANA"
            width={32}
            height={32}
            className="w-8 h-8 object-contain group-hover:opacity-70 transition-opacity"
            style={{ imageRendering: "pixelated" }}
          />
          <Image
            src="/logo_img.png"
            alt="Agentic Normie Association"
            width={140}
            height={32}
            className="h-6 w-auto object-contain group-hover:opacity-70 transition-opacity"
            style={{ imageRendering: "pixelated" }}
          />
        </Link>

        {/* Nav links + wallet */}
        <nav className="flex items-center gap-5">
          <Link
            href="/about"
            className="hidden lg:block text-sm font-mono text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            À propos
          </Link>
          <Link
            href="/governance"
            className="hidden lg:block text-sm font-mono text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            Gouvernance
          </Link>
          <Link
            href="/members"
            className="hidden md:block text-sm font-mono text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            Membres
          </Link>
          <Link
            href="/assembly"
            className="hidden md:block text-sm font-mono text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            Assemblée
          </Link>
          <Link
            href="/works"
            className="hidden md:block text-sm font-mono text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            Œuvres
          </Link>
          <Link
            href="/roadmap"
            className="hidden lg:block text-sm font-mono text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            Roadmap
          </Link>

          {/* Séparateur */}
          <div className="hidden md:block w-px h-4 bg-[--border]" />

          {/* CTA inscription */}
          <Link
            href="/register"
            className="hidden md:flex items-center gap-1.5 font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
            S'inscrire
          </Link>

          {/* Wallet */}
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}
