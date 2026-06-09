import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "wagmi/chains";

const isMainnet = process.env.NEXT_PUBLIC_CHAIN === "base";

export const wagmiConfig = getDefaultConfig({
  appName: "Agentic Normie Association",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "PLACEHOLDER",
  chains: [isMainnet ? base : baseSepolia],
  ssr: true,
});

export const targetChain = isMainnet ? base : baseSepolia;
