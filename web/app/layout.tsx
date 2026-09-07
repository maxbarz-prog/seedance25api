import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Header from "@/components/Header";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/config";
import { SUPPORT_EMAIL } from "@/lib/legal";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description:
    "Generate Seedance video, upscaled to crisp 1080p. Members generate at our cost — the membership is the business model.",
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
          <p className="space-x-4">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/refunds" className="hover:text-ink">Refunds</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-ink">Support</a>
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs">
            Powered by Seedance. Not affiliated with, endorsed by, or sponsored by
            ByteDance. Videos are rendered at 480p and AI-upscaled to 1080p unless
            you choose native rendering.
          </p>
        </footer>
      </body>
    </html>
  );
}
