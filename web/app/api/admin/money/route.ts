import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { moneyIssues, userById } from "@/lib/db";
import { refundCredits } from "@/lib/grants";
import { clearHalt, currentHalt, frozenAccounts, halt, unfreezeAccount } from "@/lib/money";
import { userByEmail } from "@/lib/db";

// The money desk: what the halt switch says, what we owe back, and the two
// actions that change either. Admin only.

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const [stop, issues, frozen] = await Promise.all([currentHalt(), moneyIssues(), frozenAccounts()]);
  const emails = new Map<string, string>();
  for (const id of [...issues.map((i) => i.userId), ...frozen.map((f) => f.userId)]) {
    if (emails.has(id)) continue;
    const u = await userById(id);
    emails.set(id, u?.email ?? id);
  }
  return NextResponse.json({
    halt: stop,
    issues: issues.map((i) => ({ ...i, email: emails.get(i.userId) })),
    owedCredits: issues.reduce((a, i) => a + i.credits, 0),
    // Accounts stopped by a dispute or a fraud warning, waiting for a human.
    frozen: frozen.map((f) => ({ ...f, email: emails.get(f.userId) })),
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("halt"), reason: z.string().min(1).max(200) }),
  z.object({ action: z.literal("resume") }),
  // Refund everything reconciliation found. Idempotent: each refund carries
  // the job id as its external id, so a second click writes nothing.
  z.object({ action: z.literal("refund-all") }),
  z.object({ action: z.literal("refund"), jobId: z.string().min(1) }),
  // Let a frozen account spend and pay again — after the dispute is
  // resolved, or the fraud warning turned out to be the member's own card.
  z.object({ action: z.literal("unfreeze"), email: z.string().email() }),
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
  if (b.action === "unfreeze") {
    const target = await userByEmail(b.email);
    if (!target) return NextResponse.json({ error: "No such user." }, { status: 404 });
    await unfreezeAccount(target.id);
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
