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
  webpack(config, { isServer }) {
    // Optional peer deps pulled in by pino and @metamask/sdk that don't exist
    // in a Next.js / browser context — tell webpack to ignore them.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "pino-pretty": false,
      "@react-native-async-storage/async-storage": false,
      "react-native-encrypted-storage": false,
      "react-native": false,
    };

    if (!isServer) {
      // These Node.js built-ins are pulled in by some wallet libs on the server
      // side only — safe to stub on client bundles.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    return config;
  },
};

export default nextConfig;
