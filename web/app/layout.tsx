import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Header from "@/components/Header";
import Providers from "@/components/Providers";
import PageWidth from "@/components/PageWidth";
import { SITE_NAME } from "@/lib/config";
import { SUPPORT_EMAIL } from "@/lib/legal";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// The tab says the name and nothing else. The landing page is the one
// exception (app/page.tsx sets an absolute title with the tagline): once
// someone is inside, the name is all the tab needs to say.
export const metadata: Metadata = {
  title: { default: SITE_NAME, absolute: SITE_NAME },
  description:
    "Generate Seedance video, upscaled to crisp 1080p. Members generate at our cost — the membership is the business model.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <Providers>
        <Header />
        <main className="pb-24">
          <PageWidth className="px-4">{children}</PageWidth>
        </main>
        <footer className="border-t border-line py-8 text-center text-sm text-muted">
          <p className="space-x-4">
            <Link href="/pricing" className="hover:text-ink">Pricing</Link>
            <Link href="/help" className="hover:text-ink">Help</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/refunds" className="hover:text-ink">Refunds</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-ink">Support</a>
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs">
            Powered by Seedance. Not affiliated with, endorsed by, or sponsored by
            ByteDance. Videos are rendered at the quality you pick and AI-upscaled
            to the resolution you pick; both are shown before you are charged.
          </p>
        </footer>
        </Providers>
      </body>
    </html>
  );
}
