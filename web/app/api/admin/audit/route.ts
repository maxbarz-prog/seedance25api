import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { auditTimeline, RETENTION_DAYS } from "@/lib/audit";

// The audit diary, read back as a timeline. THE ONLY READER of lib/audit.ts's
// store — see the rules at the top of that file. Nothing in the product may
// call this, and nothing may decide anything from what it returns.
//
//   ?days=90                  the window, up to ten years
//   ?email=someone@example    narrowed to one address
//
// The address is hashed here and matched against the hash in the table; it is
// never stored and never returned. Narrowing happens after the read rather
// than through an index, which is what keeps "has this address been seen
// before" a question an administrator asks deliberately rather than one the
// code can ask by accident.

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const p = req.nextUrl.searchParams;
  const days = Number(p.get("days") || 90);
  const email = p.get("email");
  const entries = await auditTimeline({
    days: Number.isFinite(days) ? days : 90,
    email,
  });

  const res = NextResponse.json({
    days: Number.isFinite(days) ? days : 90,
    // Echoed so the page can say what it filtered by without holding the
    // address itself in the response.
    filtered: !!email,
    count: entries.length,
    retentionDays: RETENTION_DAYS,
    entries,
  });
  res.headers.set("cache-control", "private, no-store");
  return res;
}
