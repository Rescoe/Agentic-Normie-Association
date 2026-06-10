"use client";

import Image from "next/image";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[--bg]/95 backdrop-blur-sm border-b border-[--border]">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
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

        {/* Nav links + Connect */}
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
            href="/roadmap"
            className="hidden lg:block text-sm font-mono text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            Roadmap
          </Link>
          <Link
            href="/register"
            className="hidden md:flex items-center gap-1.5 font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 transition-opacity"
          >
            <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
            S'inscrire
          </Link>
          <ConnectButton
            label="Connecter"
            showBalance={false}
            chainStatus="none"
            accountStatus={{
              smallScreen: "avatar",
              largeScreen: "full",
            }}
          />
        </nav>
      </div>
    </header>
  );
}
