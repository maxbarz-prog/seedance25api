import Composer from "@/components/Composer";
import Link from "next/link";
import { SITE_NAME } from "@/lib/config";
import { quote, fmtUsd } from "@/lib/pricing";

export default function Home() {
  const q5 = quote({ durationS: 5, mode: "upscaled-1080p", upscaleFactor: 2 });
  const q15 = quote({ durationS: 15, mode: "upscaled-1080p", upscaleFactor: 2 });

  return (
    <div className="py-10">
      <section className="mb-8 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          AI video, sold at cost.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">
          {SITE_NAME} members generate Seedance video at exactly what it costs
          us — provider rates, payment processing, and delivery, with zero
          markup. Our only revenue is the membership. A 5-second 1080p video is{" "}
          <span className="font-medium text-ink">{fmtUsd(q5.usd)}</span>; the
          15-second maximum is{" "}
          <span className="font-medium text-ink">{fmtUsd(q15.usd)}</span>.
        </p>
      </section>

      <Composer />

      <section className="mt-14 grid gap-6 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Zero markup, provably</h3>
          <p className="mt-2 text-sm text-muted">
            Our <Link href="/pricing" className="underline">pricing formula</Link>{" "}
            is public: provider cost + processing + delivery. When our costs
            drop, your price drops the same day.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Smart 1080p</h3>
          <p className="mt-2 text-sm text-muted">
            We render at 480p and AI-upscale to 1080p — about a quarter of the
            cost of native 1080p. Prefer native? It&apos;s right there in the
            composer, also at cost.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Credits that behave</h3>
          <p className="mt-2 text-sm text-muted">
            Pay-as-you-go credits, $10 minimum top-up, failed generations
            refunded automatically. No monthly credit expiry games.
          </p>
        </div>
      </section>
    </div>
  );
}
