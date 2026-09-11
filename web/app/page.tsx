import { DEFAULT_MODE, DEFAULT_MODEL } from "@/lib/config";
import Composer from "@/components/Composer";
import Link from "next/link";
import { fmtUsd, pricingConstants, quote } from "@/lib/pricing";
import { storageEnabled } from "@/lib/storage";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ deactivated?: string; deleted?: string }>;
}) {
  // Deactivating and deleting both end the session, so the member lands back
  // here signed out. Saying what just happened is the difference between a
  // completed action and an unexplained logout.
  const sp = await searchParams;
  const farewell = sp.deleted
    ? "Your account and everything in it has been deleted. Nothing further is billed."
    : sp.deactivated
      ? "Your account is deactivated and billing has stopped. Sign in whenever you want it back — your videos are waiting."
      : null;
  // Resolved once, at render, and handed to the composer. Saves the browser
  // two round trips on first paint and makes every later price change
  // instant.
  const pricing = pricingConstants();
  const uploadsEnabled = storageEnabled();
  const q5 = quote({ model: DEFAULT_MODEL, durationS: 5, mode: DEFAULT_MODE });
  const q30 = quote({ model: DEFAULT_MODEL, durationS: 30, mode: DEFAULT_MODE });

  return (
    <div className="py-10">
      {farewell && (
        <p className="mb-8 rounded-2xl border border-line bg-surface px-5 py-4 text-center text-sm">
          {farewell}
        </p>
      )}
      <section className="mb-8 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Seedance video, without the markup.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">
          Members generate at our cost — the membership is the business model.
          A 5-second 4K video runs{" "}
          <span className="font-medium text-ink">{fmtUsd(q5.usd)}</span>; a full
          30-second Seedance 2.5 clip is{" "}
          <span className="font-medium text-ink">{fmtUsd(q30.usd)}</span>.
        </p>
      </section>

      <Composer pricing={pricing} uploadsEnabled={uploadsEnabled} />

      <section className="mt-14 grid gap-6 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Honest pricing</h3>
          <p className="mt-2 text-sm text-muted">
            Our <Link href="/pricing" className="underline">pricing formula</Link>{" "}
            is public. When our costs drop, your price drops with them.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="font-medium">Smart 1080p</h3>
          <p className="mt-2 text-sm text-muted">
            We render at 480p and AI-upscale to 1080p — about a quarter of the
            cost of native rendering. Prefer native 1080p? It&apos;s right there
            in the composer.
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
