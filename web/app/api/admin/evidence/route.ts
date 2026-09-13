import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getSystem, jobsFor, ledgerFor, userByEmail } from "@/lib/db";
import { accountFrozen } from "@/lib/money";

// The evidence pack: everything we know about whether one member got what
// they paid for, in one JSON document, for a refund request or a dispute.
//
// Not analytics and not a dashboard — a record. Per job: when it was ordered
// and from where, when it finished, when the member's own page first showed
// it, how many times it was downloaded. Plus the ledger, so the money and the
// credits can be walked side by side. A deleted account leaves a summary
// behind (see app/api/account/route.ts), served here by the same email.

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const user = await userByEmail(email);
  if (!user) {
    const snapshot = await getSystem(`evidence#${email}`);
    if (snapshot) return NextResponse.json({ deleted: true, ...JSON.parse(snapshot) });
    return NextResponse.json({ error: "No such user, and no record of a deleted one." }, { status: 404 });
  }

  const [jobs, ledger, frozen] = await Promise.all([
    jobsFor(user.id, 1000),
    ledgerFor(user.id, 1000),
    accountFrozen(user.id),
  ]);
  return NextResponse.json(evidencePack(user, jobs, ledger, frozen), {
    headers: { "cache-control": "private, no-store" },
  });
}

type Job = Awaited<ReturnType<typeof jobsFor>>[number];
type Entry = Awaited<ReturnType<typeof ledgerFor>>[number];
type User = NonNullable<Awaited<ReturnType<typeof userByEmail>>>;

export function evidencePack(
  user: User,
  jobs: Job[],
  ledger: Entry[],
  frozen: unknown,
  now = Date.now()
) {
  const sum = (kind: string) =>
    ledger.filter((e) => e.kind === kind).reduce((a, e) => a + e.delta_credits, 0);
  return {
    generatedAt: now,
    account: {
      email: user.email,
      id: user.id,
      createdAt: user.created_at,
      membership: user.membership,
      membershipRenewsAt: user.membership_renews_at,
      stripeCustomerId: user.stripe_customer_id,
      stripeSubscriptionId: user.stripe_subscription_id ?? null,
      deactivatedAt: user.deactivated_at ?? null,
      frozen,
    },
    summary: {
      jobs: jobs.length,
      ready: jobs.filter((j) => j.status === "ready").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      readyNeverOpened: jobs.filter((j) => j.status === "ready" && !j.viewed_at).length,
      downloads: jobs.reduce((a, j) => a + (j.download_count ?? 0), 0),
      creditsBought: sum("topup"),
      creditsGranted: sum("grant"),
      creditsSpent: -sum("charge"),
      creditsRefundedToBalance: sum("refund"),
      creditsClawedBack: -(sum("clawback") + sum("refund-out")),
      balance: ledger.reduce((a, e) => a + e.delta_credits, 0),
    },
    jobs: jobs.map((j) => ({
      id: j.id,
      kind: j.kind ?? "generate",
      status: j.status,
      prompt: j.prompt.slice(0, 160),
      durationS: j.duration_s,
      mode: j.mode,
      credits: j.quote_credits,
      orderedAt: j.created_at,
      orderedFrom: { ip: j.created_ip ?? null, userAgent: j.created_ua ?? null },
      finishedAt: j.provider_done_at ?? (j.status === "ready" ? j.updated_at : null),
      firstOpenedAt: j.viewed_at ?? null,
      downloads: j.download_count ?? 0,
      lastDownloadAt: j.last_download_at ?? null,
      error: j.error,
      hasFile: !!j.video_url,
    })),
    ledger: ledger.map((e) => ({
      at: e.created_at,
      kind: e.kind,
      credits: e.delta_credits,
      jobId: e.job_id,
      memo: e.memo,
      externalId: e.external_id,
    })),
  };
}
