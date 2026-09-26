import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.normies.art",
        pathname: "/normie/**",
      },
    ],
  },
  // pino-pretty is an optional peer dep of pino (server-side logging).
  // Keep it external so Next.js doesn't try to bundle it.
  serverExternalPackages: ["pino", "pino-pretty"],
  webpack(config) {
    // Optional/React-Native peer deps pulled in by @metamask/sdk that don't
    // exist in a browser context — tell webpack to return an empty module.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "react-native-encrypted-storage": false,
      "react-native": false,
      fs: false,
      net: false,
      tls: false,
      // Same pattern (26/09/2026): @coinbase/cdp-sdk's x402 payment/charging
      // feature is pulled in transitively via @wagmi/connectors' Coinbase
      // "base account" connector (RainbowKit -> wagmi -> @base-org/account ->
      // @coinbase/cdp-sdk), which statically imports these even though ANA
      // never uses Coinbase's x402 payment protocol. Not installed on
      // purpose — this app has its own relayer/payment flow entirely — so
      // treat them as empty modules instead of a hard build failure.
      "@x402/evm":              false,
      "@x402/evm/upto/client":  false,
      "@x402/evm/exact/client": false,
      "@x402/core/client":      false,
      "@x402/svm/exact/client": false,
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
