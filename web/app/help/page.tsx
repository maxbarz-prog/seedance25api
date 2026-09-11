import Link from "next/link";
import type { Metadata } from "next";
import { HELP, helpIndex } from "@/lib/help";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { SITE_NAME } from "@/lib/config";
import HelpSearch from "@/components/HelpSearch";

export const metadata: Metadata = {
  title: `${SITE_NAME} help centre`,
  description: `Answers about generating video on ${SITE_NAME}: plans, credits, quality, upscaling and troubleshooting.`,
};

// Prices in the articles come from the pricing code, which reads the
// environment, so this renders per request rather than at build time. That is
// the point: a help centre quoting last month's prices is worse than none.
export const dynamic = "force-dynamic";

export default function HelpHome() {
  return (
    <div className="py-10">
      <h1 className="text-3xl font-semibold">How can we help?</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Every price and plan figure below is read live from the product, so
        nothing here can be out of date.
      </p>

      <div className="mt-6 max-w-2xl">
        <HelpSearch index={helpIndex()} />
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {HELP.map((c) => (
          <div key={c.slug} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-medium">
              <Link href={`/help/${c.slug}`} className="hover:text-accent">
                {c.title}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-muted">{c.blurb}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {c.articles.slice(0, 4).map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/help/${c.slug}/${a.slug}`}
                    className="text-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    {a.title}
                  </Link>
                </li>
              ))}
              {c.articles.length > 4 && (
                <li>
                  <Link href={`/help/${c.slug}`} className="text-accent hover:underline">
                    {c.articles.length - 4} more…
                  </Link>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-muted">
        Still stuck?{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-ink">
          {SUPPORT_EMAIL}
        </a>{" "}
        — a person reads it.
      </p>
    </div>
  );
}
