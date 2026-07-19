// Reasoning-view fonts — self-hosted at build time by next/font (no runtime
// CDN). JetBrains Mono for the stream, Fraunces italic for the tally numerals.
// Scoped to the reasoning view via CSS variables (applied on its root wrapper).
import { JetBrains_Mono, Fraunces } from "next/font/google";

export const rzMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-rz-mono",
  display: "swap",
});

export const rzSerif = Fraunces({
  subsets: ["latin"],
  weight: ["500"],
  style: ["italic"],
  variable: "--font-rz-serif",
  display: "swap",
});
