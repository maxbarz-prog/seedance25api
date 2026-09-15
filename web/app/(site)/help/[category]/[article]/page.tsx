import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { HELP, articleBySlug } from "@/lib/help";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { SITE_NAME } from "@/lib/config";
import HelpBody from "@/components/HelpBody";

// Revalidated rather than rendered per request. The rates come from the same
// environment for every visitor, so this HTML is identical for all of them and
// belongs in the CDN; a deploy replaces it, and 5 minutes bounds how long a
// live SSM change takes to appear.
export const revalidate = 300;

export function generateStaticParams() {
  return HELP.flatMap((c) => c.articles.map((a) => ({ category: c.slug, article: a.slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; article: string }>;
}): Promise<Metadata> {
  const p = await params;
  const found = articleBySlug(p.category, p.article);
  return found
    ? { title: `${found.article.title} — ${SITE_NAME} help`, description: found.article.summary }
    : { title: `${SITE_NAME} help` };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ category: string; article: string }>;
}) {
  const p = await params;
  const found = articleBySlug(p.category, p.article);
  if (!found) notFound();
  const { category, article } = found;
  const siblings = category.articles.filter((a) => a.slug !== article.slug);

  return (
    <div className="py-10">
      <p className="text-sm text-muted">
        <Link href="/help" className="hover:text-ink">
          Help centre
        </Link>{" "}
        ·{" "}
        <Link href={`/help/${category.slug}`} className="hover:text-ink">
          {category.title}
        </Link>
      </p>

      <article className="mt-3 max-w-2xl">
        <h1 className="text-3xl font-semibold">{article.title}</h1>
        <p className="mt-2 text-muted">{article.summary}</p>
        <HelpBody blocks={article.body} />
      </article>

      {siblings.length > 0 && (
        <section className="mt-12 max-w-2xl border-t border-line pt-6">
          <h2 className="text-sm font-medium text-muted">More in {category.title}</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {siblings.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/help/${category.slug}/${a.slug}`}
                  className="underline-offset-2 hover:text-accent hover:underline"
                >
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 max-w-2xl text-sm text-muted">
        This did not answer it?{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-ink">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
