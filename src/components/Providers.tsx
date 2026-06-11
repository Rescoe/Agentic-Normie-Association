"use client";

import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import "@rainbow-me/rainbowkit/styles.css";

// ─── ANA custom theme ─────────────────────────────────────────────────────────
//
// Reprend exactement la palette CSS de globals.css :
//   --bg        #F5F4EF   (fond chaud)
//   --bg-card   #EFEDE6   (fond carte)
//   --fg        #0A0A0A   (near-black)
//   --fg-muted  #6B6B6B
//   --border    #D6D4CC
//
// + Space Mono pour tous les labels, 0px de border-radius partout.
// ─────────────────────────────────────────────────────────────────────────────

const anaTheme: Theme = {
  blurs: {
    modalOverlay: "blur(4px)",
  },
  colors: {
    accentColor:                    "#0A0A0A",
    accentColorForeground:          "#F5F4EF",
    actionButtonBorder:             "#D6D4CC",
    actionButtonBorderMobile:       "#D6D4CC",
    actionButtonSecondaryBackground:"#EFEDE6",
    closeButton:                    "#6B6B6B",
    closeButtonBackground:          "#EFEDE6",
    connectButtonBackground:        "#0A0A0A",
    connectButtonBackgroundError:   "#DC2626",
    connectButtonInnerBackground:   "#EFEDE6",
    connectButtonText:              "#F5F4EF",
    connectButtonTextError:         "#DC2626",
    connectionIndicator:            "#22C55E",
    downloadBottomCardBackground:   "#EFEDE6",
    downloadTopCardBackground:      "#F5F4EF",
    error:                          "#DC2626",
    generalBorder:                  "#D6D4CC",
    generalBorderDim:               "#E5E3DC",
    menuItemBackground:             "#EFEDE6",
    modalBackdrop:                  "rgba(10, 10, 10, 0.45)",
    modalBackground:                "#F5F4EF",
    modalBorder:                    "#D6D4CC",
    modalText:                      "#0A0A0A",
    modalTextDim:                   "#6B6B6B",
    modalTextSecondary:             "#6B6B6B",
    profileAction:                  "#EFEDE6",
    profileActionHover:             "#D6D4CC",
    profileForeground:              "#F5F4EF",
    selectedOptionBorder:           "#0A0A0A",
    standby:                        "#6B6B6B",
  },
  fonts: {
    // Space Mono — même variable que le layout
    body: "var(--font-mono), 'Space Mono', monospace",
  },
  radii: {
    actionButton:   "0px",
    connectButton:  "0px",
    menuButton:     "0px",
    modal:          "0px",
    modalMobile:    "0px",
  },
  shadows: {
    connectButton:        "none",
    dialog:               "0 8px 48px rgba(10, 10, 10, 0.10), 0 1px 0 #D6D4CC",
    profileDetailsAction: "none",
    selectedOption:       "none",
    selectedWallet:       "none",
    walletLogo:           "none",
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={anaTheme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
