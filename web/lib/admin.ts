import { adminData } from "./db";
import { PLANS } from "./config";

export type { AdminJobRow, AdminUserRow } from "./data/types";

export interface AdminOverview {
  totals: {
    users: number;
    activeMembers: number;
    monthlyMembers: number;
    annualMembers: number;
    estMonthlyMembershipUsd: number;
    creditsPurchased: number;
    creditsSpent: number;
    creditsRefunded: number;
    jobsReady: number;
    jobsFailed: number;
    jobsInFlight: number;
  };
  users: import("./data/types").AdminUserRow[];
  jobs: import("./data/types").AdminJobRow[];
}

export async function adminOverview(): Promise<AdminOverview> {
  const d = await adminData();
  return {
    totals: {
      users: d.userCount,
      activeMembers: d.monthlyMembers + d.annualMembers,
      monthlyMembers: d.monthlyMembers,
      annualMembers: d.annualMembers,
      estMonthlyMembershipUsd:
        d.monthlyMembers * PLANS.monthly.priceUsd +
        (d.annualMembers * PLANS.annual.priceUsd) / 12,
      creditsPurchased: d.creditsPurchased,
      creditsSpent: d.creditsSpent,
      creditsRefunded: d.creditsRefunded,
      jobsReady: d.jobsReady,
      jobsFailed: d.jobsFailed,
      jobsInFlight: d.jobsInFlight,
    },
    users: d.users,
    jobs: d.jobs,
  };
}
