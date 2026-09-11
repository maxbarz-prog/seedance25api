"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { HelpIndexEntry } from "@/lib/help";

// Search over the whole help centre, in the browser, with no request.
//
// The entire corpus is a few kilobytes — smaller than the round trip it would
// take to ask a server — so it ships with the page and every keystroke is
// instant. A search box that spins is worse than no search box.
export default function HelpSearch({ index }: { index: HelpIndexEntry[] }) {
  const [q, setQ] = useState("");
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const hits = useMemo(() => {
    if (!terms.length) return [];
    return index
      .map((e) => {
        // Every term must appear somewhere. Rank by where: a term in the
        // title is worth much more than one buried in the body.
        let score = 0;
        for (const t of terms) {
          if (!e.text.includes(t)) return null;
          if (e.title.toLowerCase().includes(t)) score += 10;
          else if (e.summary.toLowerCase().includes(t)) score += 4;
          else score += 1;
        }
        return { e, score };
      })
      .filter((r): r is { e: HelpIndexEntry; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, index]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search for an answer…"
        aria-label="Search the help centre"
        className="w-full rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent"
      />
      {terms.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
          {hits.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              Nothing matched. Try fewer words, or{" "}
              <Link href="/help/contact/get-in-touch" className="underline hover:text-ink">
                ask us directly
              </Link>
              .
            </p>
          ) : (
            hits.map(({ e }) => (
              <Link
                key={`${e.categorySlug}/${e.slug}`}
                href={`/help/${e.categorySlug}/${e.slug}`}
                className="block border-b border-line p-4 last:border-0 hover:bg-bg"
              >
                <span className="block text-xs text-muted">{e.category}</span>
                <span className="block font-medium">{e.title}</span>
                <span className="block text-sm text-muted">{e.summary}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
