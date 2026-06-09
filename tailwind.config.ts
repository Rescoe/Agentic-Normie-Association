import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "Space Mono", "monospace"],
      },
      colors: {
        ana: {
          bg:       "#F5F4EF",
          "bg-card": "#EFEDE6",
          fg:       "#0A0A0A",
          muted:    "#6B6B6B",
          border:   "#D6D4CC",
        },
      },
      backgroundImage: {
        "pixel-grid":
          "linear-gradient(#0A0A0A 1px, transparent 1px), linear-gradient(90deg, #0A0A0A 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
