"use client";

import { useEffect, useState } from "react";

interface Standing {
  code: string;
  link: string;
  rewardUsd: number;
  rewards: { pending: number; applied: number };
  referred: { at: number; vested: boolean; revoked: boolean } | null;
}

// A member's referral link and what it has earned.
//
// The wording matters here more than the layout: a reward is a discount on a
// future month, one month at a time, and someone who brings ten friends gets
// ten discounted months rather than a free year. Saying that plainly up front
// is cheaper than answering it in support later.
export default function ReferralCard() {
  const [s, setS] = useState<Standing | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/referrals")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setS(d))
      .catch(() => {});
  }, []);

  if (!s) return null;
  const { pending, applied } = s.rewards;

  async function copy() {
    try {
      await navigator.clipboard.writeText(s!.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-medium">Invite a friend</h2>
      <p className="mt-2 text-sm text-muted">
        They get <strong className="text-ink">${s.rewardUsd} off their first month</strong>, and you
        get ${s.rewardUsd} off one of yours once they have paid for theirs.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm">
          {s.link}
        </code>
        <button
          onClick={copy}
          className="rounded-lg border border-line px-3 py-2 text-sm hover:border-accent hover:text-accent"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-line px-3 py-2">
          <dt className="text-muted">Waiting to be used</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {pending} {pending === 1 ? "month" : "months"}
          </dd>
        </div>
        <div className="rounded-xl border border-line px-3 py-2">
          <dt className="text-muted">Already discounted</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {applied} {applied === 1 ? "month" : "months"}
          </dd>
        </div>
      </dl>

      {pending > 0 && (
        <p className="mt-3 text-sm text-muted">
          ${s.rewardUsd} comes off your next bill automatically — one reward per month, so they are
          used in turn rather than all at once.
        </p>
      )}
      {s.referred && !s.referred.revoked && (
        <p className="mt-3 text-sm text-muted">
          You joined on a friend&apos;s link, which is where the discount on your first month came
          from.
        </p>
      )}
    </section>
  );
}
