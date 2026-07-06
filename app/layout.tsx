import "@/styles/globals.css";
import type { Metadata } from "next";
import { jetbrainsMono, fraunces } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "VAPTBOOSTER",
  description: "Pwntrol's AI web-pentest platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${fraunces.variable}`}>
      <body className="font-mono bg-ink text-fg antialiased">{children}</body>
    </html>
  );
}
