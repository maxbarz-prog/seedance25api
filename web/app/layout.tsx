import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/config";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description:
    "Generate AI video with Seedance, upscaled to crisp 1080p. Members pay exactly what it costs us — our only revenue is the membership.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <Header />
        <main className="mx-auto max-w-5xl px-4 pb-24">{children}</main>
        <footer className="border-t border-line py-8 text-center text-sm text-muted">
          <p>
            Powered by Seedance. Not affiliated with, endorsed by, or sponsored by
            ByteDance. Videos are rendered at 480p and AI-upscaled to 1080p unless
            you choose native rendering.
          </p>
        </footer>
      </body>
    </html>
  );
}
