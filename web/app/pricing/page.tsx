import Link from "next/link";
import { PLANS, MIN_TOPUP_USD, SITE_NAME } from "@/lib/config";
import { fmtUsd, quote, rates } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const r = rates();
  const rows = [5, 10, 15].map((d) => ({
    d,
    upscaled: quote({ durationS: d, mode: "upscaled-1080p", upscaleFactor: 2 }),
    native: quote({ durationS: d, mode: "native-1080p" }),
  }));

  return (
    <div className="py-10">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 max-w-2xl text-muted">
        {SITE_NAME} charges members exactly what each video costs us. The
        membership is our entire business model — generation carries zero
        markup, ever.
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-medium">{PLANS.monthly.label}</h2>
          <p className="mt-2 text-3xl font-semibold">
            ${PLANS.monthly.priceUsd}
            <span className="text-base font-normal text-muted">/month</span>
          </p>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>All generation at cost</li>
            <li>{PLANS.monthly.storageGb} GB video storage</li>
            <li>Credits never expire</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-accent bg-surface p-6">
          <h2 className="font-medium">{PLANS.annual.label}</h2>
          <p className="mt-2 text-3xl font-semibold">
            ${PLANS.annual.priceUsd}
            <span className="text-base font-normal text-muted">/year</span>
            <span className="ml-2 align-middle rounded-full bg-accent px-2 py-0.5 text-xs text-accent-ink">
              2 months free
            </span>
          </p>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>All generation at cost</li>
            <li>{PLANS.annual.storageGb} GB video storage</li>
            <li>Credits never expire</li>
          </ul>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-medium">What videos cost</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="p-4 font-normal">Length</th>
                <th className="p-4 font-normal">1080p (upscaled) — default</th>
                <th className="p-4 font-normal">1080p (native)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.d} className="border-b border-line last:border-0">
                  <td className="p-4">{row.d} seconds</td>
                  <td className="p-4 font-medium">{fmtUsd(row.upscaled.usd)}</td>
                  <td className="p-4">{fmtUsd(row.native.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Live rates — these numbers move when our provider costs move, in both
          directions.
        </p>
      </section>

      <section className="mt-10 max-w-2xl">
        <h2 className="text-xl font-medium">The formula, in the open</h2>
        <p className="mt-2 text-sm text-muted">
          Every price on this site is computed as:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface p-4 text-sm">
{`price = (provider cost + delivery) ÷ (1 − processing)

provider cost  what our AI providers charge us, per second
delivery       ${fmtUsd(r.deliveryPerVideo)}/video for storage + CDN
processing     ${(r.processingPct * 100).toFixed(1)}% payment fees, recovered not marked up`}
        </pre>
        <p className="mt-3 text-sm text-muted">
          Minimum top-up is ${MIN_TOPUP_USD} (small card charges are mostly
          fees — that protects your credit value, not our margin). Failed
          generations are refunded automatically. Credits never expire.
        </p>
      </section>

      <section className="mt-10">
        <Link
          href="/signup"
          className="rounded-full bg-accent px-8 py-3 font-medium text-accent-ink hover:opacity-90"
        >
          Join {SITE_NAME}
        </Link>
      </section>
    </div>
  );
}
