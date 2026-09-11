import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { HELP, categoryBySlug } from "@/lib/help";
import { SITE_NAME } from "@/lib/config";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return HELP.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const c = categoryBySlug((await params).category);
  return c
    ? { title: `${c.title} — ${SITE_NAME} help`, description: c.blurb }
    : { title: `${SITE_NAME} help` };
}

export default async function HelpCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const c = categoryBySlug((await params).category);
  if (!c) notFound();

  return (
    <div className="py-10">
      <Link href="/help" className="text-sm text-muted hover:text-ink">
        ← Help centre
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">{c.title}</h1>
      <p className="mt-2 max-w-2xl text-muted">{c.blurb}</p>

      <ul className="mt-8 space-y-3">
        {c.articles.map((a) => (
          <li key={a.slug} className="rounded-2xl border border-line bg-surface p-5">
            <Link href={`/help/${c.slug}/${a.slug}`} className="font-medium hover:text-accent">
              {a.title}
            </Link>
            <p className="mt-1 text-sm text-muted">{a.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
