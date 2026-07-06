import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brutecat palette — near-black with hairline grays
        ink: {
          DEFAULT: "#0a0a0a", // page bg
          2: "#101010",       // raised surface
          3: "#161616",       // input bg / focused surface
        },
        line: {
          DEFAULT: "#1f1f1f", // hairline borders
          2: "#2a2a2a",       // slightly stronger borders / input frames
        },
        fg: {
          DEFAULT: "#ededed", // primary text
          2: "#a8a8a8",       // secondary text
          mute: "#6a6a6a",    // muted / placeholder / labels
        },
        // Status colors — used sparingly
        ok:   "#22c55e",
        warn: "#f59e0b",
        crit: "#ff5c5c",
        info: "#60a5fa",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        serif: ['"Fraunces"', "Georgia", "serif"],
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
