import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { setOnboarding, userById } from "@/lib/db";
import { needsOnboarding, nextStep, SURVEY, surveyOption } from "@/lib/onboarding";
import { recordReferral, referralFor } from "@/lib/referrals";

// The welcome flow's server side. GET says which step is next and what the
// page needs to draw it; POST completes one step. Each step is idempotent:
// a double submit or a back button cannot put the row in a state the next
// GET cannot read.

const noStore = (body: unknown, status = 200) => {
  const res = NextResponse.json(body, { status });
  res.headers.set("cache-control", "private, no-store");
  return res;
};

export async function GET() {
  const user = await currentUser();
  if (!user) return noStore({ error: "Not signed in." }, 401);
  // A link like /r/CODE leaves the code in a cookie. It becomes the default
  // in the referral step, so a person who arrived by a friend's link does
  // not have to remember the code they never typed.
  const jar = await cookies();
  const existing = await referralFor(user.id);
  return noStore({
    email: user.email,
    step: nextStep(user),
    required: needsOnboarding(user),
    refCode: existing?.code ?? jar.get("remerged_ref")?.value ?? null,
    referred: !!existing,
    survey: SURVEY,
  });
}

const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("finalize"), agree: z.literal(true) }),
  z.object({
    step: z.literal("referral"),
    code: z.string().max(20).optional(),
    skip: z.boolean().optional(),
  }),
  z.object({
    step: z.literal("survey"),
    role: z.string().max(32),
    goal: z.string().max(32),
    source: z.string().max(32),
  }),
  z.object({ step: z.literal("upgrade_seen") }),
]);

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return noStore({ error: "Not signed in." }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return noStore({ error: "Bad request." }, 400);
  const b = parsed.data;
  const now = Date.now();

  if (b.step === "finalize") {
    if (!user.terms_accepted_at) await setOnboarding(user.id, { terms_accepted_at: now });
    return noStore({ ok: true, step: nextStep({ ...user, terms_accepted_at: now }) });
  }

  if (b.step === "referral") {
    const code = (b.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    let result: "ok" | "skipped" | "unknown-code" | "self" | "already-referred" = "skipped";
    if (!b.skip && code) {
      const r = await recordReferral(user.id, code);
      result = r.ok ? "ok" : r.reason;
      // A wrong code is not the end of the step: say so and let them fix it
      // or skip. Only a code that took, or a skip, moves on.
      if (!r.ok && r.reason !== "already-referred") {
        return noStore({ ok: false, result });
      }
    }
    // The cookie has served its purpose whichever way this went.
    const jar = await cookies();
    try {
      jar.delete("remerged_ref");
    } catch {}
    if (!user.referral_answered_at) await setOnboarding(user.id, { referral_answered_at: now });
    return noStore({
      ok: true,
      result,
      step: nextStep({ ...user, referral_answered_at: now }),
    });
  }

  if (b.step === "survey") {
    if (!surveyOption("role", b.role) || !surveyOption("goal", b.goal) || !surveyOption("source", b.source)) {
      return noStore({ error: "Pick one of the options." }, 400);
    }
    await setOnboarding(user.id, {
      survey_role: b.role,
      survey_goal: b.goal,
      survey_source: b.source,
      onboarded_at: user.onboarded_at ?? now,
    });
    return noStore({ ok: true, step: "done" });
  }

  // upgrade_seen: once, ever. The first caller wins; the page only shows the
  // offer when the me route says it has not been shown.
  const fresh = (await userById(user.id)) ?? user;
  if (!fresh.upgrade_prompted_at) await setOnboarding(user.id, { upgrade_prompted_at: now });
  return noStore({ ok: true, first: !fresh.upgrade_prompted_at });
}
