import { Suspense } from "react";
import { DEFAULT_MODE, DEFAULT_MODEL } from "@/lib/config";
import Composer from "@/components/Composer";
import CreateGate from "@/components/CreateGate";
import PromptExamples from "@/components/PromptExamples";
import Link from "next/link";
import { pricingConstants, quote } from "@/lib/pricing";
import { storageEnabled } from "@/lib/storage";

// The composer: where video gets made. One question, the box, three clips
// to start from, and the three things worth knowing about the money. Rendered
// once and revalidated: nothing on this page differs between visitors, and
// the member-specific parts (the balance, the composer's state, the
// welcome-flow gate) are client-side. A signed-out visitor sees it too: the
// prompt is the first thing, and signing up is what pressing Generate leads to.
export const revalidate = 300;

export default async function CreatePage() {
  const pricing = pricingConstants();
  const uploadsEnabled = storageEnabled();
  const q5 = quote({ model: DEFAULT_MODEL, durationS: 5, mode: DEFAULT_MODE });

  return (
    <div className="py-10">
      <Suspense fallback={null}>
        <CreateGate />
      </Suspense>
      <section className="mb-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">What do you want to create?</h1>
        <p className="mt-2 text-sm text-muted">
          Every Seedance model, priced at cost. A 5-second 4K clip is{" "}
          <span className="font-medium text-ink">{q5.credits.toLocaleString()} credits</span> — a credit is a cent.
        </p>
      </section>

      <Composer pricing={pricing} uploadsEnabled={uploadsEnabled} />

      <PromptExamples />

      <section className="mt-12 grid gap-6 sm:grid-cols-3">
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
