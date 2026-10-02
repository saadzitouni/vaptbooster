import { JetBrains_Mono, Lora } from "next/font/google";

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

// Accent face — single-word italic emphasis inside headlines only.
export const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["italic"],
  variable: "--font-serif",
  display: "swap",
});
