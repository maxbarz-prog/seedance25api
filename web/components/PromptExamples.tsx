"use client";

import { SHOWCASE } from "@/lib/landing";
import ShowcaseVideo from "./landing/ShowcaseVideo";
import { setComposerPrompt } from "@/lib/ui-events";
import { track } from "@/lib/track-client";

// Three finished clips under the composer with the prompts that made them.
// Clicking one puts its prompt in the box: the fastest way to see what a
// good prompt looks like is to run one.
export default function PromptExamples() {
  const cards = SHOWCASE.filter((c) => c.slot === "card");
  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">Or start from one of these</h2>
        <p className="text-xs text-muted">Made on Remerged with Seedance 2.5. Click to use the prompt.</p>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <button
            key={c.file}
            type="button"
            onClick={() => {
              track("cta_clicked", { where: `example:${c.file}` });
              setComposerPrompt(c.prompt);
            }}
            className="group overflow-hidden rounded-2xl border border-line bg-surface text-left hover:border-accent"
          >
            <div className="relative aspect-video overflow-hidden bg-ink">
              <div className="showcase-fallback absolute inset-0" aria-hidden />
              <ShowcaseVideo file={c.file} className="absolute inset-0 h-full w-full object-cover" />
            </div>
            <div className="p-4">
              <p className="font-medium">{c.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted">&ldquo;{c.prompt}&rdquo;</p>
              <p className="mt-2 text-xs font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                Use this prompt →
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
