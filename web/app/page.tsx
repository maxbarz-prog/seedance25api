import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Farewell from "@/components/Farewell";
import Cta from "@/components/landing/Cta";
import LandingTrack from "@/components/landing/LandingTrack";
import ShowcaseVideo from "@/components/landing/ShowcaseVideo";
import ForceLight from "@/components/landing/ForceLight";
import { DEFAULT_MODE, DEFAULT_MODEL, MODELS, PLANS, SITE_NAME, SITE_TAGLINE } from "@/lib/config";
import { SEEDANCE_ALSO_POWERS, SHOWCASE } from "@/lib/landing";
import { fmtUsd, quote } from "@/lib/pricing";

// The front door. The only page that carries the tagline in its title; every
// other tab just says the name.
export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
};

// Rendered once and revalidated. Nothing here is per-visitor: the prices are
// the same constants for everyone, and the clips are static files.
export const revalidate = 300;

export default function Landing() {
  const hero = SHOWCASE.find((c) => c.slot === "hero")!;
  const cards = SHOWCASE.filter((c) => c.slot === "card");
  const q5 = quote({ model: DEFAULT_MODEL, durationS: 5, mode: DEFAULT_MODE });
  const std = PLANS.standard;

  return (
    <div className="landing -mx-4 px-4 pb-4 pt-6">
      <ForceLight />
      <Suspense fallback={null}>
        <Farewell />
        <LandingTrack />
      </Suspense>

      {/* Hero: one clip, edge to edge of the column, the words over it. */}
      <section className="relative overflow-hidden rounded-3xl bg-ink text-white shadow-lg">
        <div className="showcase-fallback absolute inset-0" aria-hidden />
        <ShowcaseVideo
          file={hero.file}
          priority
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/10" aria-hidden />
        <div className="relative flex min-h-[26rem] flex-col justify-end p-6 sm:min-h-[32rem] sm:p-10 lg:min-h-[36rem]">
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            {SITE_TAGLINE}
          </h1>
          <p className="mt-4 max-w-xl text-base text-white/85 sm:text-lg">
            {SITE_NAME} turns a sentence into video with Seedance, the model behind some of
            the most-used editors in the world, and charges what it costs us to run.
            Type a prompt. Press Generate. The first one is free.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Cta
              where="hero"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-medium text-ink hover:bg-white/90"
            >
              Try {SITE_NAME} for free <span aria-hidden>›</span>
            </Cta>
            <Link
              href="/pricing"
              className="rounded-full border border-white/40 px-5 py-2.5 font-medium text-white hover:bg-white/10"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Who else runs on the model. Said precisely: these are Seedance's
          customers, not ours. */}
      <section className="mt-10 text-center">
        <p className="text-sm text-muted">
          Built on Seedance, the video model that also powers:
        </p>
        <div className="marquee mt-4" aria-label="Products built on Seedance">
          <ul className="marquee-track">
            {[...SEEDANCE_ALSO_POWERS, ...SEEDANCE_ALSO_POWERS].map((name, i) => (
              <li
                key={`${name}-${i}`}
                className="px-8 text-lg font-semibold tracking-tight text-ink/70"
                aria-hidden={i >= SEEDANCE_ALSO_POWERS.length}
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* What it does, shown rather than described. */}
      <section className="mt-20 text-center">
        <h2 className="mx-auto max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          One composer. Every Seedance model.
          <br className="hidden sm:block" /> Rendered, upscaled, delivered.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          Text to video, image to video, references, extensions and AI upscaling to 4K, priced
          per second and shown before anything is charged.
        </p>
      </section>

      <section className="mt-10 grid gap-5 sm:grid-cols-3">
        {cards.map((c) => (
          <figure key={c.file} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="relative aspect-video overflow-hidden bg-ink">
              <div className="showcase-fallback absolute inset-0" aria-hidden />
              <ShowcaseVideo file={c.file} className="absolute inset-0 h-full w-full object-cover" />
            </div>
            <figcaption className="p-5">
              <h3 className="font-medium">{c.title}</h3>
              <p className="mt-2 line-clamp-3 text-sm text-muted" title={c.prompt}>
                &ldquo;{c.prompt}&rdquo;
              </p>
              <p className="mt-3 text-xs text-muted">
                {MODELS[DEFAULT_MODEL].label} · {c.durationS}s · {c.quality} render, upscaled to 4K
              </p>
            </figcaption>
          </figure>
        ))}
      </section>

      {/* The pitch that used to be the homepage's headline, kept where it
          belongs: after the pictures. */}
      <section className="mt-20 grid gap-6 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h3 className="font-medium">Priced at cost</h3>
          <p className="mt-2 text-sm text-muted">
            Members generate at what it costs us. Our{" "}
            <Link href="/pricing" className="underline">pricing formula</Link> is public, and a
            5-second 4K clip is {q5.credits.toLocaleString()} credits — {fmtUsd(q5.usd)}.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h3 className="font-medium">Render smart, upscale sharp</h3>
          <p className="mt-2 text-sm text-muted">
            Render at 480p or 720p and AI-upscale to 1080p or 4K for a fraction of a native
            render, or go native 1080p when the shot deserves it. Your choice, every time.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h3 className="font-medium">Credits that behave</h3>
          <p className="mt-2 text-sm text-muted">
            A credit is a cent. {std.label} is ${std.monthlyUsd} a month for{" "}
            {std.credits.toLocaleString()} credits; failed generations are refunded on their own.
          </p>
        </div>
      </section>

      <section className="mt-20 rounded-3xl bg-ink px-6 py-14 text-center text-white sm:px-10">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Start with a free video.</h2>
        <p className="mx-auto mt-3 max-w-xl text-white/80">
          No card. One clip on us, then plans from ${std.monthlyUsd} a month.
        </p>
        <Cta
          where="footer"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-medium text-ink hover:bg-white/90"
        >
          Try {SITE_NAME} for free <span aria-hidden>›</span>
        </Cta>
      </section>
    </div>
  );
}
