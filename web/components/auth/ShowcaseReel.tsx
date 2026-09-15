"use client";

import { useEffect, useState } from "react";
import { SHOWCASE } from "@/lib/landing";
import ShowcaseVideo from "@/components/landing/ShowcaseVideo";

// The footage half of the sign-in screen: the showcase clips, one at a
// time, with a tab per clip along the top and a caption at the foot. Moves
// on by itself every few seconds; a tab click holds the one you picked.
const HOLD_MS = 7000;

export default function ShowcaseReel() {
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % SHOWCASE.length), HOLD_MS);
    return () => window.clearInterval(id);
  }, [held]);
  const clip = SHOWCASE[i];

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink text-white">
      <div className="showcase-fallback absolute inset-0" aria-hidden />
      {SHOWCASE.map((c, n) => (
        <div
          key={c.file}
          className={`absolute inset-0 transition-opacity duration-700 ${n === i ? "opacity-100" : "opacity-0"}`}
          aria-hidden={n !== i}
        >
          <ShowcaseVideo file={c.file} priority={n === 0} className="h-full w-full object-cover" />
        </div>
      ))}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" aria-hidden />
      <nav className="absolute inset-x-0 top-0 flex gap-2 overflow-x-auto p-6 text-sm" aria-label="Showcase">
        {SHOWCASE.map((c, n) => (
          <button
            key={c.file}
            type="button"
            onClick={() => {
              setI(n);
              setHeld(true);
            }}
            className={`shrink-0 border-b-2 px-3 py-1 transition-colors ${
              n === i ? "border-white text-white" : "border-transparent text-white/60 hover:text-white"
            }`}
          >
            {c.title}
          </button>
        ))}
      </nav>
      <figcaption className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
        <p className="text-2xl font-semibold tracking-tight">{clip.title}</p>
        <p className="mt-2 max-w-md text-sm text-white/80 line-clamp-3">&ldquo;{clip.prompt}&rdquo;</p>
        <p className="mt-2 text-xs text-white/60">
          Made with Seedance 2.5 on Remerged · {clip.durationS}s · {clip.quality} render, upscaled to 4K
        </p>
      </figcaption>
    </div>
  );
}
