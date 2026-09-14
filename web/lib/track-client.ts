"use client";

// The browser half of lib/events.ts: a queue that posts to /api/events in
// small batches, a visitor id that survives reloads, and the attribution a
// first visit carried (referral code, utm_*, where they came from).
//
// Batched and sent with keepalive so a click that navigates away — which is
// most of the interesting ones — still reports. Nothing here ever throws
// into the page: analytics failing is not something a member should see.

import type { ClientEventName } from "./events";

const VID_KEY = "remerged_vid";
const ATTR_KEY = "remerged_attr";
const FLUSH_MS = 700;
const MAX_QUEUE = 15;

type Props = Record<string, string | number | boolean | null>;
interface Queued {
  name: ClientEventName;
  props?: Props;
  at: number;
}

const queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let bound = false;

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

export function visitorId(): string {
  const have = safeGet(VID_KEY);
  if (have && /^v_[a-z0-9]{20}$/.test(have)) return have;
  let s = "";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += (b % 36).toString(36);
  const id = `v_${s}`;
  safeSet(VID_KEY, id);
  return id;
}

// Captured once, on the first page this browser ever reports from, and
// repeated with every event after. A later visit with a different utm does
// not overwrite it: the question the report asks is where somebody FIRST
// came from.
export function attribution(): Record<string, string> {
  const have = safeGet(ATTR_KEY);
  if (have) {
    try {
      return JSON.parse(have);
    } catch {}
  }
  const out: Record<string, string> = {};
  try {
    const u = new URL(window.location.href);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      const v = u.searchParams.get(k);
      if (v) out[k] = v.slice(0, 120);
    }
    const ref = u.searchParams.get("ref");
    if (ref) out.ref = ref.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    out.landing = (u.pathname + (u.search && !ref ? u.search : "")).slice(0, 120);
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.host !== u.host) out.referrer = r.host.slice(0, 120);
    }
  } catch {}
  safeSet(ATTR_KEY, JSON.stringify(out));
  return out;
}

function send(useBeacon: boolean) {
  if (!queue.length) return;
  const batch = queue.splice(0, MAX_QUEUE);
  const body = JSON.stringify({ visitor: visitorId(), attr: attribution(), events: batch });
  try {
    // text/plain: a "simple" request, so no preflight, and sendBeacon can
    // carry it. The route parses the text as JSON itself.
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "text/plain" }));
      return;
    }
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {}
  if (queue.length) schedule();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    send(false);
  }, FLUSH_MS);
}

function bind() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    send(true);
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function track(name: ClientEventName, props?: Props) {
  if (typeof window === "undefined") return;
  bind();
  queue.push({ name, props, at: Date.now() });
  if (queue.length >= MAX_QUEUE) send(false);
  else schedule();
}

// Flush now, before a navigation the page is about to make itself.
export function flushEvents() {
  if (typeof window === "undefined") return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  send(true);
}
