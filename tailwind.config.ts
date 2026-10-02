import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // PWNTROL brand v1 — light "paper" theme (pwntrol-brand-colors.pdf).
        // "ink" keeps its name but is now the paper surface scale.
        ink: {
          DEFAULT: "#FAFAF7", // --ink / --paper: page background
          2: "#F2F1EC",       // raised surfaces — cards, callouts, code panels
          3: "#EAE8DF",       // deepest fill — active/selected, nested chips
        },
        line: {
          DEFAULT: "#DCDBD3", // hairline — dividers, table rules, card borders
          2: "#BFBEB4",       // stronger border — inputs, buttons
        },
        fg: {
          DEFAULT: "#0A0A0A", // primary text, headings, icons
          2: "#4A4A4A",       // body copy, descriptions
          mute: "#8A8A85",    // labels, eyebrows, timestamps, placeholders
        },
        // Status accents — severity and state only, never large fills
        ok:   "#5A6B4A", // resolved / passing / low risk
        med:  "#8B7A2E", // medium severity
        high: "#C46A17", // high severity
        warn: "#C46A17", // legacy alias of high (pending / open states)
        crit: "#B4231C", // critical, blocking
        info: "#5A6070", // neutral / informational
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        serif: ['"Lora"', "Georgia", "serif"],
      },
      fontSize: {
        "2xs": "11px",
        xs: "12px",
      },
      borderRadius: {
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
      },
      letterSpacing: {
        tight2: "-0.02em",
        tight3: "-0.025em",
      },
    },
  },
  plugins: [],
};
export default config;
