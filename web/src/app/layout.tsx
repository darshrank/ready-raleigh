import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Geist, Geist_Mono } from "next/font/google";
import { BRAND } from "@/config/game";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Big_Shoulders({ variable: "--font-bigshoulders", subsets: ["latin"], weight: ["500", "700", "800", "900"] });

export const metadata: Metadata = {
  title: `${BRAND.name}: ${BRAND.subtitle}`,
  description: BRAND.secondary,
};

export const viewport: Viewport = {
  themeColor: "#050810",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden bg-background">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
