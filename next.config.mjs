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
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
