import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { currentUser } from "@/lib/auth";
import { addEvents, Event } from "@/lib/db";
import {
  CLIENT_EVENTS,
  cleanAttr,
  cleanProps,
  dayOf,
  MAX_BATCH,
  VISITOR_RE,
} from "@/lib/events";

// Where the browser reports what it saw. Open to anyone — a visitor has no
// account yet, and that is the part of the funnel worth measuring — so the
// shape is checked hard and the volume capped: a listed name, a well-formed
// visitor id, a few small props, at most twenty per call. Anything else is
// dropped, not refused: one bad event must not lose the rest of the batch.
//
// The body arrives as text/plain rather than JSON so that sendBeacon can
// carry it on the way out of the page.

const MAX_BODY = 16_000;
// Timestamps the page supplies are trusted only within a window: a clock
// that is wrong by a day would file the event under the wrong partition.
const SKEW_MS = 10 * 60_000;

export async function POST(req: NextRequest) {
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return NextResponse.json({ ok: false }, { status: 400 });
  let body: { visitor?: unknown; attr?: unknown; events?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const visitor = typeof body.visitor === "string" && VISITOR_RE.test(body.visitor) ? body.visitor : null;
  if (!visitor || !Array.isArray(body.events)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const attr = cleanAttr(body.attr);
  // Signed in: the event belongs to the member, and carries the visitor id
  // alongside so the report can join what they did before signing up.
  const user = await currentUser().catch(() => null);
  const now = Date.now();
  const out: Event[] = [];
  for (const raw of body.events.slice(0, MAX_BATCH)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as { name?: unknown; props?: unknown; at?: unknown };
    if (typeof e.name !== "string" || !(CLIENT_EVENTS as readonly string[]).includes(e.name)) continue;
    const at =
      typeof e.at === "number" && Math.abs(now - e.at) < SKEW_MS ? Math.min(e.at, now) : now;
    out.push({
      id: randomUUID(),
      day: dayOf(at),
      name: e.name,
      actor: user?.id ?? visitor,
      visitor,
      props: cleanProps(e.props),
      attr,
      created_at: at,
    });
  }
  if (out.length) {
    await addEvents(out).catch((err) => console.error("events not stored:", err));
  }
  const res = NextResponse.json({ ok: true, stored: out.length });
  res.headers.set("cache-control", "private, no-store");
  return res;
}
