import Link from "next/link";
import Header from "@/components/Header";
import PageWidth from "@/components/PageWidth";
import PlanModalHost from "@/components/PlanModalHost";
import { SUPPORT_EMAIL } from "@/lib/legal";

// Every page of the product: header, content column, footer. The plan
// modal is mounted once here and opened from anywhere by an event, so the
// header's Upgrade button, the composer's refusal dialog and the welcome
// offer all raise the same one.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
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
      <PlanModalHost />
    </>
  );
}
