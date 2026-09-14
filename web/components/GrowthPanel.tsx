"use client";

import { useEffect, useState } from "react";
import type { GrowthReport, FunnelStep, Breakdown } from "@/lib/events";

// The growth section of the admin page: what happens between someone
// arriving and someone paying, over a window. Everything here is a count of
// people, not of events — a visitor who opened the landing page five times
// is one person who saw it.

const WINDOWS = [7, 30, 90];

function pct(v: number | null) {
  return v === null ? "—" : `${v}%`;
}

function Funnel({ steps, title, blurb }: { steps: FunnelStep[]; title: string; blurb: string }) {
  const max = Math.max(1, ...steps.map((s) => s.people));
  return (
    <div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-xs text-muted">{blurb}</p>
      <ol className="mt-3 space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{s.label}</span>
                <span className="shrink-0 tabular-nums">{s.people.toLocaleString()}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-line">
                <div className="h-full bg-accent" style={{ width: `${(s.people / max) * 100}%` }} />
              </div>
            </div>
            <div className="w-28 text-right text-xs text-muted tabular-nums">
              {i === 0 ? (
                <span>start</span>
              ) : (
                <span title="of the previous step / of the first step">
                  {pct(s.ofPreviousPct)} · {pct(s.ofFirstPct)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-right text-[11px] text-muted">step-over-step · of the first step</p>
    </div>
  );
}

function Answers({ title, rows }: { title: string; rows: Breakdown[] }) {
  const total = rows.reduce((a, r) => a + r.people, 0);
  return (
    <div>
      <h3 className="font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No answers yet.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-normal">Answer</th>
              <th className="py-1 text-right font-normal">People</th>
              <th className="py-1 text-right font-normal">Share</th>
              <th className="py-1 text-right font-normal">Paid now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.answer} className="border-t border-line">
                <td className="py-1.5">{r.answer}</td>
                <td className="py-1.5 text-right tabular-nums">{r.people}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {total ? Math.round((r.people / total) * 100) : 0}%
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.paidNow}
                  {r.people ? (
                    <span className="text-muted"> ({Math.round((r.paidNow / r.people) * 100)}%)</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="text-xs text-muted">{detail}</p>}
    </div>
  );
}

export default function GrowthPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<GrowthReport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    fetch(`/api/admin/growth?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setBusy(false));
  }, [days]);

  const share = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Growth</h2>
          <p className="text-xs text-muted">
            From the landing page to a paid plan, by person.
            {data && (
              <>
                {" "}
                {data.from} to {data.to}, {data.events.toLocaleString()} events.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-line p-1 text-xs">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              className={`rounded-full px-3 py-1 ${days === w ? "bg-accent text-accent-ink" : "text-muted"}`}
            >
              {w} days
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="mt-4 text-sm text-muted">{busy ? "Loading…" : "No data."}</p>
      ) : (
        <div className={`mt-5 space-y-8 ${busy ? "opacity-60" : ""}`}>
          <div className="grid gap-6 lg:grid-cols-2">
            <Funnel
              steps={data.funnel}
              title="The funnel"
              blurb="Distinct people at each step. Sign-up itself is drawn by Clerk, so the step after 'Reached sign-up' is the account existing."
            />
            <Funnel
              steps={data.welcome}
              title="The welcome flow"
              blurb="From the account row to the upgrade offer being answered. A drop between steps here is a screen people leave on."
            />
          </div>

          <div>
            <h3 className="font-medium">New accounts</h3>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Accounts created" value={data.free.accounts} />
              <Stat
                label="Made a video"
                value={data.free.generated}
                detail={share(data.free.generated, data.free.accounts)}
              />
              <Stat
                label="Never generated"
                value={data.free.neverGenerated}
                detail={share(data.free.neverGenerated, data.free.accounts)}
              />
              <Stat
                label="On a paid plan now"
                value={data.free.paidNow}
                detail={share(data.free.paidNow, data.free.accounts)}
              />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Answers title={`Survey: what best describes you`} rows={data.survey.role} />
            <Answers title={`Survey: what are you looking for`} rows={data.survey.goal} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="font-medium">Referral codes</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Entered" value={data.referrals.entered} detail={`${data.referrals.skipped} skipped`} />
                <Stat
                  label="Accepted"
                  value={data.referrals.accepted}
                  detail={`${data.referrals.unknown} unknown · ${data.referrals.self} own · ${data.referrals.alreadyReferred} already`}
                />
                <Stat label="Applied" value={data.referrals.applied} detail="referral recorded" />
                <Stat label="Vested" value={data.referrals.vested} detail="referee paid" />
              </div>
              {data.referrals.topCodes.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-1 font-normal">Code</th>
                      <th className="py-1 text-right font-normal">Applied</th>
                      <th className="py-1 text-right font-normal">Vested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.referrals.topCodes.map((c) => (
                      <tr key={c.code} className="border-t border-line">
                        <td className="py-1 font-mono">{c.code}</td>
                        <td className="py-1 text-right tabular-nums">{c.applied}</td>
                        <td className="py-1 text-right tabular-nums">{c.vested}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h3 className="font-medium">The upgrade offer</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Shown" value={data.upgrade.shown} />
                <Stat
                  label="Clicked See plans"
                  value={data.upgrade.clicked}
                  detail={share(data.upgrade.clicked, data.upgrade.shown)}
                />
                <Stat
                  label="Dismissed"
                  value={data.upgrade.dismissed}
                  detail={share(data.upgrade.dismissed, data.upgrade.shown)}
                />
                <Stat
                  label="Paid after seeing it"
                  value={data.upgrade.convertedInWindow}
                  detail={share(data.upgrade.convertedInWindow, data.upgrade.shown)}
                />
              </div>
              <h3 className="mt-5 font-medium">Locked options people click</h3>
              <p className="text-xs text-muted">What free members reach for and cannot have.</p>
              {data.locked.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {data.locked.map((l) => (
                    <li key={l.option} className="flex justify-between border-t border-line py-1">
                      <span>{l.option}</span>
                      <span className="tabular-nums">{l.clicks}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="font-medium">Where people came from</h3>
              <p className="text-xs text-muted">First touch: a referral link, a utm tag, or the referring site.</p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 font-normal">Source</th>
                    <th className="py-1 text-right font-normal">Visitors</th>
                    <th className="py-1 text-right font-normal">Accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attribution.sources.map((s) => (
                    <tr key={s.source} className="border-t border-line">
                      <td className="py-1">{s.source}</td>
                      <td className="py-1 text-right tabular-nums">{s.visitors}</td>
                      <td className="py-1 text-right tabular-nums">
                        {s.accounts} <span className="text-muted">({share(s.accounts, s.visitors)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="font-medium">Landing paths</h3>
              <p className="text-xs text-muted">The first page each visitor opened.</p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 font-normal">Path</th>
                    <th className="py-1 text-right font-normal">Visitors</th>
                    <th className="py-1 text-right font-normal">Accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attribution.landings.map((l) => (
                    <tr key={l.path} className="border-t border-line">
                      <td className="py-1 font-mono text-xs">{l.path}</td>
                      <td className="py-1 text-right tabular-nums">{l.visitors}</td>
                      <td className="py-1 text-right tabular-nums">{l.accounts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="font-medium">By day</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 font-normal">Day</th>
                    <th className="py-1 text-right font-normal">Landing</th>
                    <th className="py-1 text-right font-normal">Sign-ups</th>
                    <th className="py-1 text-right font-normal">Jobs</th>
                    <th className="py-1 text-right font-normal">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.daily].reverse().map((d) => (
                    <tr key={d.day} className="border-t border-line">
                      <td className="py-1 font-mono text-xs">{d.day}</td>
                      <td className="py-1 text-right tabular-nums">{d.landing}</td>
                      <td className="py-1 text-right tabular-nums">{d.signups}</td>
                      <td className="py-1 text-right tabular-nums">{d.jobs}</td>
                      <td className="py-1 text-right tabular-nums">{d.paid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
