import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#0f1114",
          elevated: "#12151a",
          surface: "#181b21",
          raised: "#1c1f26",
        },
        stroke: {
          subtle: "rgba(255,255,255,0.06)",
          DEFAULT: "rgba(255,255,255,0.09)",
          strong: "rgba(255,255,255,0.14)",
        },
        accent: {
          DEFAULT: "#3b82f6",
          muted: "rgba(59, 130, 246, 0.15)",
        },
        yes: {
          DEFAULT: "#4ade80",
          muted: "rgba(74, 222, 128, 0.14)",
        },
        no: {
          DEFAULT: "#f87171",
          muted: "rgba(248, 113, 113, 0.14)",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "var(--font-inter)",
          "ui-monospace",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 16px 48px -28px rgba(0,0,0,0.65)",
        glow: "0 0 48px -16px rgba(59, 130, 246, 0.35)",
        innersearch:
          "inset 0 2px 8px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03)",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
} satisfies Config;
