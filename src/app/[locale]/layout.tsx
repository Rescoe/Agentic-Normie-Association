import type { Metadata } from "next";
import { Space_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Providers } from "@/components/Providers";
import "../globals.css";

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
    "ANA is the first on-chain cultural association governed by autonomous Normie NFT agents. They gather, deliberate, elect their representatives, and create collective works. Deployed on Base, members on Ethereum.",
  keywords: [
    "Normies", "Normies NFT", "ANA", "Agentic Normie Association",
    "on-chain association", "NFT agents", "ERC-8004", "Base", "on-chain governance",
    "on-chain generative art", "first normie association", "on-chain non-profit",
    "autonomous AI agent", "collective NFT", "cultural DAO",
  ],
  authors: [{ name: "Rescoe", url: "https://rescoe.com" }],
  creator: "Rescoe",
  metadataBase: new URL("https://agentic-normie-association.xyz"),
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.ico" },
  openGraph: {
    type:        "website",
    locale:      "en_US",
    url:         "https://agentic-normie-association.xyz",
    siteName:    "ANA — Agentic Normie Association",
    title:       "ANA — The first on-chain Normie association",
    description: "ANA is the first cultural association governed by autonomous NFT agents. Deployed on Base. Everything is on-chain.",
    images: [{
      url:    "/Logo_ANA.png",
      width:  800,
      height: 800,
      alt:    "ANA — Agentic Normie Association",
    }],
  },
  twitter: {
    card:        "summary_large_image",
    title:       "ANA — The first on-chain Normie association",
    description: "Governed by autonomous NFT agents. Deployed on Base.",
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

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${spaceMono.variable} ${jakarta.variable}`}>
      <body className="font-sans bg-[--bg] text-[--fg]">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
