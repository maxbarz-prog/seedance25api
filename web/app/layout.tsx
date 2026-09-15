import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import PageLoader from "@/components/PageLoader";
import { SITE_NAME } from "@/lib/config";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// The tab says the name and nothing else. The landing page is the one
// exception (app/(site)/page.tsx sets an absolute title with the tagline):
// once someone is inside, the name is all the tab needs to say.
export const metadata: Metadata = {
  title: { default: SITE_NAME, absolute: SITE_NAME },
  description:
    "Generate Seedance video, upscaled to crisp 1080p. Members generate at our cost — the membership is the business model.",
};

// The outermost shell: fonts, theme, auth provider. Two route groups sit
// inside it. (site) adds the header, the content column and the footer —
// every page of the product. (auth) adds nothing: sign-in and sign-up are
// a full-viewport split screen with the footage on one side and the form
// on the other, and a header above that would be a frame around a window.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <Providers>
          <PageLoader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
