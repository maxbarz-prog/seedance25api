import { adminData } from "./db";
import { PLAN_IDS, PLANS, PlanId, planPriceUsd } from "./config";
import { planMargins } from "./economics";

export type { AdminJobRow, AdminUserRow } from "./data/types";

export interface AdminOverview {
  totals: {
    users: number;
    activeMembers: number;
    monthlyMembers: number;
    annualMembers: number;
    // Recurring revenue at today's roster, annual plans spread over twelve
    // months.
    estMonthlyMembershipUsd: number;
    // Active paid members per tier, in plan order.
    membersByPlan: { plan: PlanId; label: string; monthly: number; annual: number }[];
    // What each plan earns a month if the member spends every credit it
    // grants. Worst first — that is the one a plan is set by.
    planMargins: {
      label: string;
      interval: string;
      revenueUsd: number;
      costUsd: number;
      marginUsd: number;
    }[];
    creditsPurchased: number;
    creditsSpent: number;
    creditsRefunded: number;
    jobsReady: number;
    jobsFailed: number;
    jobsInFlight: number;
  };
  users: import("./data/types").AdminUserRow[];
  jobs: import("./data/types").AdminJobRow[];
  // Per-model generation speed, measured from finished jobs.
  modelTiming: import("./data/types").ModelTiming[];
}

export async function adminOverview(): Promise<AdminOverview> {
  const d = await adminData();
  return {
    totals: {
      users: d.userCount,
      activeMembers: d.members.reduce((a, m) => a + m.count, 0),
      monthlyMembers: d.members
        .filter((m) => m.interval === "month")
        .reduce((a, m) => a + m.count, 0),
      annualMembers: d.members
        .filter((m) => m.interval === "year")
        .reduce((a, m) => a + m.count, 0),
      // Each tier at its own price, annual spread over the year it covers.
      estMonthlyMembershipUsd: d.members.reduce((a, m) => {
        if (!(m.plan in PLANS)) return a;
        const p = m.plan as PlanId;
        return (
          a +
          m.count *
            (m.interval === "year" ? planPriceUsd(p, "year") / 12 : PLANS[p].monthlyUsd)
        );
      }, 0),
      planMargins: planMargins().map((m) => ({
        label: PLANS[m.plan].label,
        interval: m.interval === "year" ? "annual" : "monthly",
        revenueUsd: m.monthlyRevenueUsd,
        costUsd: m.fullUseCostUsd + m.processingUsd,
        marginUsd: m.marginUsd,
      })),
      membersByPlan: PLAN_IDS.filter((p) => PLANS[p].monthlyUsd > 0).map((p) => ({
        plan: p,
        label: PLANS[p].label,
        monthly: d.members.find((m) => m.plan === p && m.interval === "month")?.count ?? 0,
        annual: d.members.find((m) => m.plan === p && m.interval === "year")?.count ?? 0,
      })),
      creditsPurchased: d.creditsPurchased,
      creditsSpent: d.creditsSpent,
      creditsRefunded: d.creditsRefunded,
      jobsReady: d.jobsReady,
      jobsFailed: d.jobsFailed,
      jobsInFlight: d.jobsInFlight,
    },
    users: d.users,
    jobs: d.jobs,
    modelTiming: d.modelTiming,
  };
}
