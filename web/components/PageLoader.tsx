"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOADING_EVENT } from "@/lib/ui-events";

// The loading screen between pages: a spinner on the page's own ground,
// shown the moment a link is pressed, gone once the next page is actually
// ready to look at. "Ready" means the fonts are in and the images and
// posters above the fold have arrived, so a page appears whole rather than
// assembling itself in front of the visitor. Capped, so a slow image can
// delay a page by a moment but never hold it hostage.
//
// Three ways in: a click on a link to this site (caught before the
// router sees it), a navigation the code makes itself (announced with
// showLoader()), and the first load of any page, which starts covered and
// uncovers when ready. A full-page navigation away shows it on the way
// out (beforeunload) and the next document shows its own on the way in.

const MIN_SHOWN_MS = 250;
const MAX_WAIT_MS = 2500;
// A click that never becomes a navigation (a link a component intercepted)
// must not leave the page covered.
const ORPHAN_MS = 3000;

function whenReady(): Promise<void> {
  const waits: Promise<unknown>[] = [];
  try {
    if (document.fonts?.ready) waits.push(document.fonts.ready);
  } catch {}
  const vh = window.innerHeight;
  const inView = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh;
  };
  for (const img of Array.from(document.images)) {
    if (!inView(img) || img.complete) continue;
    waits.push(new Promise<void>((res) => {
      img.addEventListener("load", () => res(), { once: true });
      img.addEventListener("error", () => res(), { once: true });
    }));
  }
  // A video's poster is what the page shows first; fetch it as an image so
  // its arrival can be waited on.
  for (const v of Array.from(document.querySelectorAll("video[poster]"))) {
    if (!inView(v)) continue;
    const src = (v as HTMLVideoElement).poster;
    if (!src) continue;
    waits.push(new Promise<void>((res) => {
      const i = new Image();
      i.onload = () => res();
      i.onerror = () => res();
      i.src = src;
    }));
  }
  const cap = new Promise<void>((res) => setTimeout(res, MAX_WAIT_MS));
  return Promise.race([Promise.all(waits).then(() => undefined), cap]);
}

export default function PageLoader() {
  const pathname = usePathname();
  const [shown, setShown] = useState(true);
  const [fading, setFading] = useState(false);
  const shownAt = useRef<number>(Date.now());
  const orphan = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback(() => {
    if (orphan.current) clearTimeout(orphan.current);
    shownAt.current = Date.now();
    setFading(false);
    setShown(true);
    orphan.current = setTimeout(() => setShown(false), ORPHAN_MS);
  }, []);

  const settle = useCallback(async () => {
    const mine = ++seq.current;
    if (orphan.current) clearTimeout(orphan.current);
    await whenReady();
    const left = MIN_SHOWN_MS - (Date.now() - shownAt.current);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    if (mine !== seq.current) return;
    setFading(true);
    setTimeout(() => {
      if (mine === seq.current) setShown(false);
    }, 220);
  }, []);

  // A new pathname means the next page has rendered: wait for it to be
  // ready, then uncover. Also runs on first load.
  useEffect(() => {
    settle();
  }, [pathname, settle]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      show();
    };
    const onCode = () => show();
    const onLeave = () => show();
    const onShow = (e: PageTransitionEvent) => {
      // Back from the bfcache: the page is already whole.
      if (e.persisted) setShown(false);
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(LOADING_EVENT, onCode);
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(LOADING_EVENT, onCode);
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pageshow", onShow);
    };
  }, [show]);

  if (!shown) return null;
  return (
    <div
      className={`page-loader fixed inset-0 z-[100] flex items-center justify-center bg-bg transition-opacity duration-200 ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <div className="flex flex-col items-center gap-4">
        <span className="spinner" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}
