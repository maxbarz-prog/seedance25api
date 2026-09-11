import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { moneyIssues, userById } from "@/lib/db";
import { refundCredits } from "@/lib/grants";
import { clearHalt, currentHalt, halt } from "@/lib/money";

// The money desk: what the halt switch says, what we owe back, and the two
// actions that change either. Admin only.

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [stop, issues] = await Promise.all([currentHalt(), moneyIssues()]);
  const emails = new Map<string, string>();
  for (const i of issues) {
    if (emails.has(i.userId)) continue;
    const u = await userById(i.userId);
    emails.set(i.userId, u?.email ?? i.userId);
  }
  return NextResponse.json({
    halt: stop,
    issues: issues.map((i) => ({ ...i, email: emails.get(i.userId) })),
    owedCredits: issues.reduce((a, i) => a + i.credits, 0),
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("halt"), reason: z.string().min(1).max(200) }),
  z.object({ action: z.literal("resume") }),
  // Refund everything reconciliation found. Idempotent: each refund carries
  // the job id as its external id, so a second click writes nothing.
  z.object({ action: z.literal("refund-all") }),
  z.object({ action: z.literal("refund"), jobId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const b = parsed.data;

  if (b.action === "halt") {
    await halt({ reason: b.reason, detail: "Paused by hand from the admin page.", by: admin.email });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "resume") {
    await clearHalt();
    return NextResponse.json({ ok: true });
  }

  // Re-read rather than trusting anything the client sent: the amount owed is
  // computed here, from the ledger, at the moment of the refund.
  const issues = await moneyIssues();
  const targets = b.action === "refund" ? issues.filter((i) => i.jobId === b.jobId) : issues;
  if (!targets.length) {
    return NextResponse.json({ ok: true, refunded: 0, credits: 0 });
  }
  let refunded = 0;
  let credits = 0;
  for (const i of targets) {
    const entry = await refundCredits(i.userId, i.credits, {
      jobId: i.jobId,
      memo: `Reconciliation: ${i.reason}`,
      // Guards against a double refund if this is clicked twice or two
      // admins act at once.
      externalId: `reconcile#${i.jobId}`,
    });
    if (entry) {
      refunded++;
      credits += i.credits;
    }
  }
  return NextResponse.json({ ok: true, refunded, credits });
}
