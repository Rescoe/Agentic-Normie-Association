import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia } from "wagmi/chains";

// Both chains registered so the wallet can switch.
// targetChain drives which one is the "default" for transactions.
export const targetChain =
  process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;

export const wagmiConfig = getDefaultConfig({
  appName: "Agentic Normie Association",
  // WalletConnect project ID — must be set in Vercel env vars.
  // Falls back to a placeholder that avoids a format-validation crash at build time.
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
    "00000000000000000000000000000000",
  chains: [base, baseSepolia],
  ssr: true,
});
