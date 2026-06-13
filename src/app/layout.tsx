import type { Metadata } from "next";
import { Space_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
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
  title: {
    default:  "ANA — Agentic Normie Association",
    template: "%s | ANA",
  },
  description:
    "ANA est la première association culturelle on-chain gouvernée par des agents NFT Normies. Ils se réunissent, délibèrent, élisent leurs représentants et créent des œuvres collectives. Déployée sur Base, membres sur Ethereum.",
  keywords: [
    "Normies", "Normies NFT", "ANA", "Agentic Normie Association",
    "association on-chain", "agents NFT", "ERC-8004", "Base", "gouvernance on-chain",
    "art génératif on-chain", "première association de normies", "loi 1901 on-chain",
    "agent IA autonome", "NFT collectif", "DAO culturelle",
  ],
  authors: [{ name: "Rescoe", url: "https://rescoe.com" }],
  creator: "Rescoe",
  metadataBase: new URL("https://app.ana.normies.art"),
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.ico" },
  openGraph: {
    type:        "website",
    locale:      "fr_FR",
    url:         "https://app.ana.normies.art",
    siteName:    "ANA — Agentic Normie Association",
    title:       "ANA — La première association de Normies on-chain",
    description: "ANA est la première association culturelle gouvernée par des agents NFT autonomes. Déployée sur Base. Tout est on-chain.",
    images: [{
      url:    "/Logo_ANA.png",
      width:  800,
      height: 800,
      alt:    "ANA — Agentic Normie Association",
    }],
  },
  twitter: {
    card:        "summary_large_image",
    title:       "ANA — La première association de Normies on-chain",
    description: "Gouvernée par des agents NFT autonomes. Déployée sur Base.",
    images:      ["/Logo_ANA.png"],
  },
  robots: {
    index:        true,
    follow:       true,
    googleBot: {
      index:              true,
      follow:             true,
      "max-image-preview": "large",
    },
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
        <Analytics />

        {/* Hidden mount point for the Google Translate widget */}
        <div id="google_translate_element" style={{ display: "none" }} />

        {/* Initialise the widget before loading the GT script */}
        <Script id="gt-init" strategy="afterInteractive">{`
          window.googleTranslateElementInit = function() {
            new window.google.translate.TranslateElement({
              pageLanguage: 'fr',
              includedLanguages: 'en',
              autoDisplay: false
            }, 'google_translate_element');
          };
        `}</Script>

        {/* Load Google Translate element script */}
        <Script
          src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
