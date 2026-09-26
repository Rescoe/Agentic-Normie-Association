import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  walletConnectWallet,
  safeWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";

// Chain cible selon env — Base mainnet par défaut, Sepolia seulement en
// opt-in explicite (trouvaille de l'audit du 26/09/2026 : c'était l'inverse,
// donc un NEXT_PUBLIC_CHAIN absent/mal configuré en prod basculait
// silencieusement sur Sepolia).
export const targetChain =
  process.env.NEXT_PUBLIC_CHAIN === "baseSepolia" ? baseSepolia : base;

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  "00000000000000000000000000000000";

// ─── Wallets affichés dans la modal ──────────────────────────────────────────
//
// On supprime le wallet Rainbow (branding coloré hors-sujet pour ANA).
// Ordre intentionnel : injected d'abord (MetaMask/Rabby selon l'extension active),
// puis MetaMask explicite, Rabby, Coinbase, WalletConnect mobile.
// ─────────────────────────────────────────────────────────────────────────────

const connectors = connectorsForWallets(
  [
    {
      groupName: "Navigateur",
      wallets: [injectedWallet, metaMaskWallet, rabbyWallet],
    },
    {
      groupName: "Autres",
      wallets: [coinbaseWallet, walletConnectWallet, safeWallet],
    },
  ],
  {
    appName:   "Agentic Normie Association",
    projectId,
  }
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [base, baseSepolia],
  transports: {
    [base.id]:        http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});
