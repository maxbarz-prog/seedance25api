import Link from "next/link";
import { MIN_TOPUP_USD, MODELS, PLANS, SITE_NAME } from "@/lib/config";
import { fmtUsd, quote, rates } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const r = rates();
  const durations = [5, 15, 30];
  const price = (model: keyof typeof MODELS, d: number) =>
    d <= MODELS[model].maxDurationS
      ? fmtUsd(quote({ model, durationS: d, mode: "upscaled-1080p", upscaleFactor: 2 }).usd)
      : "—";
  const nativePrice = (model: keyof typeof MODELS, d: number) =>
    d <= MODELS[model].maxDurationS
      ? fmtUsd(quote({ model, durationS: d, mode: "native-1080p" }).usd)
      : "—";

  return (
    <div className="py-10">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 max-w-2xl text-muted">
        One membership, then generation priced at what it costs us to make and
        deliver your videos. No markup on usage — the membership is our
        revenue.
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-medium">{PLANS.monthly.label}</h2>
          <p className="mt-2 text-3xl font-semibold">
            ${PLANS.monthly.priceUsd}
            <span className="text-base font-normal text-muted">/month</span>
          </p>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>Seedance 2.0 &amp; 2.5, up to 30s clips</li>
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
            <li>Everything in Monthly</li>
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
                <th className="p-4 font-normal">Model</th>
                <th className="p-4 font-normal">Output</th>
                {durations.map((d) => (
                  <th key={d} className="p-4 font-normal">
                    {d}s
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(MODELS) as (keyof typeof MODELS)[]).map((m) => (
                <>
                  <tr key={`${m}-up`} className="border-b border-line">
                    <td className="p-4">{MODELS[m].label}</td>
                    <td className="p-4 text-muted">1080p upscaled (default)</td>
                    {durations.map((d) => (
                      <td key={d} className="p-4 font-medium">
                        {price(m, d)}
                      </td>
                    ))}
                  </tr>
                  <tr key={`${m}-native`} className="border-b border-line last:border-0">
                    <td className="p-4"></td>
                    <td className="p-4 text-muted">1080p native</td>
                    {durations.map((d) => (
                      <td key={d} className="p-4">
                        {nativePrice(m, d)}
                      </td>
                    ))}
                  </tr>
                </>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Live rates — these numbers move when our costs move, in both
          directions. Seedance 2.0 supports up to 15s; Seedance 2.5 up to 30s.
        </p>
      </section>

      <section className="mt-10 max-w-2xl">
        <h2 className="text-xl font-medium">How prices are computed</h2>
        <p className="mt-2 text-sm text-muted">
          Every generation price on this site comes from one formula:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface p-4 text-sm">
{`price = (provider + delivery) × (1 + operations) ÷ (1 − processing)

provider    what our AI providers charge us, per second
delivery    ${fmtUsd(r.deliveryPerVideo)}/video for storage + CDN
operations  ${(r.overheadPct * 100).toFixed(0)}% for hosting, admin & support overhead
processing  ${(r.processingPct * 100).toFixed(1)}% payment fees`}
        </pre>
        <p className="mt-3 text-sm text-muted">
          Minimum top-up is ${MIN_TOPUP_USD} — small card charges are mostly
          processing fees. Failed generations are refunded automatically.
          Credits never expire.
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
