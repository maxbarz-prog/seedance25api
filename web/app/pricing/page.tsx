import { Fragment } from "react";
import Link from "next/link";
import {
  MIN_TOPUP_USD,
  MODEL_IDS,
  MODELS,
  ModelId,
  OUTPUT_MODES,
  supportsQuality,
  OUTPUT_MODE_IDS,
  OutputMode,
  DEFAULT_MODE,
  SITE_NAME,
} from "@/lib/config";
import { fmtUsd, quote, rates } from "@/lib/pricing";
import PricingPlans from "@/components/PricingPlans";

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const r = rates();
  const durations = [5, 10, 15, 30];
  const priceFor = (model: ModelId, mode: OutputMode, d: number) => {
    if (d > MODELS[model].maxDurationS) return "—";
    if (!supportsQuality(model, OUTPUT_MODES[mode].quality)) return "—";
    return fmtUsd(quote({ model, durationS: d, mode }).usd);
  };
  // Seedance 1.5 Pro is the one model priced by soundtrack rather than
  // resolution, so its rows would otherwise understate a video with audio.
  const hasAudioRate = (model: ModelId) => "audio" in MODELS[model];
  const now = Date.now();
  const live = (model: ModelId) => {
    const d = (MODELS[model] as { discount?: { pct: number; until: string } }).discount;
    return d && Date.parse(d.until) > now ? d : null;
  };
  const anyDiscount = MODEL_IDS.some((m) => live(m));
  const inputs = (model: ModelId) => {
    const a = MODELS[model].accepts as readonly string[];
    if (a.includes("text") && a.includes("image")) return "text + image";
    return a.includes("image") ? "image only" : "text only";
  };

  return (
    <div className="py-10">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 max-w-2xl text-muted">
        One membership, then generation priced at what it costs us to make and
        deliver your videos. No markup on usage — the membership is our
        revenue.
      </p>

      <PricingPlans />

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
              {MODEL_IDS.map((m) => (
                <Fragment key={m}>
                  {OUTPUT_MODE_IDS.map((mode, i) => (
                    <tr
                      key={`${m}-${mode}`}
                      className={
                        i === OUTPUT_MODE_IDS.length - 1
                          ? "border-b border-line last:border-0"
                          : "border-b border-line/40"
                      }
                    >
                      {i === 0 && (
                        <td className="p-4 align-top" rowSpan={OUTPUT_MODE_IDS.length}>
                          <div className="font-medium">{MODELS[m].label}</div>
                          <div className="text-xs text-muted">
                            up to {MODELS[m].maxDurationS}s · {inputs(m)}
                            {hasAudioRate(m) && " · sound doubles the rate"}
                          </div>
                          {live(m) && (
                            <div className="mt-1 text-xs text-accent">
                              {Math.round(live(m)!.pct * 100)}% provider discount, passed on
                              until{" "}
                              {new Date(live(m)!.until).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="p-4 text-muted">
                        {OUTPUT_MODES[mode].label}
                        {mode === DEFAULT_MODE && (
                          <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-ink">
                            default
                          </span>
                        )}
                        <div className="text-xs opacity-70">
                          rendered at {OUTPUT_MODES[mode].renderedAt}
                          {OUTPUT_MODES[mode].upscale === "none"
                            ? ", no upscaler"
                            : `, upscaled to ${OUTPUT_MODES[mode].resolution}`}
                        </div>
                      </td>
                      {durations.map((d) => (
                        <td
                          key={d}
                          className={`p-4 tabular-nums ${mode === DEFAULT_MODE ? "font-medium" : ""}`}
                        >
                          {priceFor(m, mode, d)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Live rates — these numbers move when our costs move, in both
          directions. A dash means the model does not offer that: only some
          models render 1080p themselves, and none is priced past its maximum
          length. Prices are for silent video. Quality is what the model
          renders; upscale is what happens to it afterwards.
          {" "}
          <span className="text-ink">
            4K is the default because it is the cheapest good option, not the
            dearest: the render is the expensive part, so buying more pixels at
            the upscaler costs far less than rendering at 1080p natively.
          </span>
          {anyDiscount &&
            " Where our provider is running a promotion we pass it on, and the price returns to normal by itself when it ends."}
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
          processing fees, and top-ups need a paid plan. Failed generations are
          refunded automatically. Credits you buy never expire; credits
          included with a plan expire when the plan renews, beyond whatever
          your plan carries over.
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
