import {
  ANNUAL_DISCOUNT,
  BillingInterval,
  PLANS,
  PlanId,
  effectiveMonthlyUsd,
  planPriceUsd,
} from "@/lib/config";

// A plan's price, always expressed per month so the tiers can be compared at
// a glance whichever billing period is selected. What changes is the number
// and the line under it — an annual plan shows the discounted month with the
// full amount and the saving stated plainly underneath, because a headline
// price that quietly means "if you pay for a year up front" is the thing
// people resent discovering at the card form.
export default function PlanPrice({
  plan,
  interval,
}: {
  plan: PlanId;
  interval: BillingInterval;
}) {
  const monthly = PLANS[plan].monthlyUsd;
  if (monthly === 0) {
    return (
      <>
        <span className="block text-3xl font-semibold">$0</span>
        <span className="block text-xs text-muted">Free, no card needed</span>
      </>
    );
  }

  const perMonth = effectiveMonthlyUsd(plan, interval);
  const yearly = planPriceUsd(plan, "year");
  const showsDecimals = !Number.isInteger(perMonth);

  return (
    <>
      <span className="block text-3xl font-semibold">
        ${showsDecimals ? perMonth.toFixed(2) : perMonth}
        <span className="text-base font-normal text-muted">/month</span>
      </span>
      {interval === "year" ? (
        <span className="block text-xs text-muted">
          <s>${monthly}</s> billed yearly at ${yearly} · save{" "}
          {Math.round(ANNUAL_DISCOUNT * 100)}%
        </span>
      ) : (
        <span className="block text-xs text-muted">
          billed monthly · ${planPriceUsd(plan, "year")}/year saves{" "}
          {Math.round(ANNUAL_DISCOUNT * 100)}%
        </span>
      )}
    </>
  );
}
