import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import { Suspense, type ReactNode } from "react";

import { Shell } from "@/components/Shell";
import { Skeleton } from "@/components/States";

import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Parking Occupancy Forecasts",
  description:
    "Occupancy forecasts, zone comparisons and model evaluation built on the historical UCI Parking Birmingham dataset (2016).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141b1a" },
  ],
};

// Applies a saved theme before first paint, so the page does not flash the wrong one.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Shell>
          <Suspense fallback={<Skeleton height={320} />}>{children}</Suspense>
        </Shell>
      </body>
    </html>
  );
}
