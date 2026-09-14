"use client";

import { useState } from "react";

// A showcase clip: muted, looping, playing on its own, with its poster as
// the first frame. Before the clips exist — the workflow that renders them
// has not been run on this checkout — the file 404s and the element would
// show a broken player; instead it hides itself and the gradient behind it
// stands in. The page reads the same either way, which is what lets the
// landing page ship ahead of its footage.
export default function ShowcaseVideo({
  file,
  className = "",
  priority = false,
}: {
  file: string;
  className?: string;
  priority?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <video
      className={className}
      src={`/landing/${file}.mp4`}
      poster={`/landing/${file}.jpg`}
      autoPlay
      muted
      loop
      playsInline
      preload={priority ? "auto" : "metadata"}
      onError={() => setBroken(true)}
      aria-hidden
    />
  );
}
