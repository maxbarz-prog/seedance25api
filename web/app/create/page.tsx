import { Suspense } from "react";
import { DEFAULT_MODE, DEFAULT_MODEL, SITE_TAGLINE_PRICING } from "@/lib/config";
import Composer from "@/components/Composer";
import CreateGate from "@/components/CreateGate";
import Link from "next/link";
import { fmtUsd, pricingConstants, quote } from "@/lib/pricing";
import { storageEnabled } from "@/lib/storage";

// The composer: where video gets made. Rendered once and revalidated, not per
// request. Nothing on this page differs between visitors: the prices come
// from the same constants for everyone, and the member-specific parts (the
// balance in the header, the composer's state, the welcome-flow gate) are
// client-side. A signed-out visitor sees it too: the prompt is the first
// thing they do, and signing up is what pressing Generate leads to.
export const revalidate = 300;

export default async function CreatePage() {
  const pricing = pricingConstants();
  const uploadsEnabled = storageEnabled();
  const q5 = quote({ model: DEFAULT_MODEL, durationS: 5, mode: DEFAULT_MODE });
  const q30 = quote({ model: DEFAULT_MODEL, durationS: 30, mode: DEFAULT_MODE });

  return (
    <div className="py-10">
      <Suspense fallback={null}>
        <CreateGate />
      </Suspense>
      <section className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{SITE_TAGLINE_PRICING}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">
          Members generate at our cost — the membership is the business model. A
          5-second 4K video runs{" "}
          <span className="font-medium text-ink">{q5.credits.toLocaleString()} credits</span>; a
          full 30-second Seedance 2.5 clip is{" "}
          <span className="font-medium text-ink">{q30.credits.toLocaleString()}</span>.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted">
          Credits cost a cent each — {fmtUsd(1)} buys 100.
        </p>
      </section>

      <Composer pricing={pricing} uploadsEnabled={uploadsEnabled} />

      <section className="mt-14 grid gap-6 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Honest pricing</h3>
          <p className="mt-2 text-sm text-muted">
            Our <Link href="/pricing" className="underline">pricing formula</Link> is public.
            When our costs drop, your price drops with them.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Smart 1080p</h3>
          <p className="mt-2 text-sm text-muted">
            We render at 480p and AI-upscale to 1080p — about a quarter of the cost of
            native rendering. Prefer native 1080p? It&apos;s right there in the composer.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Credits that behave</h3>
          <p className="mt-2 text-sm text-muted">
            Pay-as-you-go credits, $10 minimum top-up, failed generations refunded
            automatically. No monthly credit expiry games.
          </p>
        </div>
      </section>
    </div>
  );
}
