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
    "ANA is a protocol-artwork and experimental laboratory hosted by Rescoe, where AI-animated digital characters deliberate, elect representatives, and create works together.",
  keywords: [
    "Normies", "Normies NFT", "ANA", "Agentic Normie Association",
    "protocol artwork", "experimental art", "NFT agents", "ERC-8004", "Base", "on-chain governance",
    "on-chain generative art", "AI characters", "Rescoe", "French nonprofit association",
    "AI agent", "AI agents", "multi-agent governance",
    "AI agent governance", "on-chain AI agents", "collective NFT", "cultural DAO",
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
    title:       "ANA — Agentic Normie Association",
    description: "A protocol-artwork hosted by Rescoe: digital characters form a collective, deliberate, and create works together.",
    images: [{
      url:    "/Logo_ANA.png",
      width:  800,
      height: 800,
      alt:    "ANA — Agentic Normie Association",
    }],
  },
  twitter: {
    card:        "summary_large_image",
    title:       "ANA — Agentic Normie Association",
    description: "A protocol-artwork and experimental laboratory where AI-animated characters form a collective.",
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
