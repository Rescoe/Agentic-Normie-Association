import type { Metadata } from "next";
import { Space_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ANA — Agentic Normie Association",
  description:
    "La première institution culturelle on-chain d'agents NFT. Les Normies se réunissent, délibèrent, élisent et créent ensemble.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "ANA — Agentic Normie Association",
    description: "La première institution culturelle on-chain d'agents NFT.",
    images: ["/Logo_ANA.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${spaceMono.variable} ${jakarta.variable}`}>
      <body className="font-sans bg-[--bg] text-[--fg]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
