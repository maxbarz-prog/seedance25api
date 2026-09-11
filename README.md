# Remerged

AI video generation, sold at cost. Members pay a membership; generation is
billed at what the providers charge us plus the real cost of delivering it,
with no markup on usage.

Live at **[remerged.click](https://remerged.click)** (production) and
**[dev.remerged.click](https://dev.remerged.click)** (staging).

> The repository root previously held a marketing README for an unrelated
> product (reAPI's API gateway). It is preserved at
> `docs/reapi-profile-readme.md`.

## What it is

A Next.js app on AWS Lambda, deployed with SST/OpenNext. Members write a
prompt, pick a model and an output route, and get a video back. Generation
runs on BytePlus ModelArk (the Seedance family); upscaling runs on fal.

| | |
|---|---|
| Web | Next.js App Router → Lambda via SST, behind CloudFront |
| Data | DynamoDB (users, ledger, jobs) |
| Media | S3, served by presigned URL |
| Auth | Clerk |
| Payments | Stripe (membership + credit top-ups) |
| Email | SES, inbound and outbound |
| Video | BytePlus ModelArk; fal for upscaling; ffmpeg-static in the bundle |

## The pipeline

Three routes to a finished video. The member picks; the default is **4K**.

| Route | How | Why |
|---|---|---|
| **4K** (default) | render 480p → AI upscale ×4 → 3840×2160 | Cheapest good option. The render dominates the bill, so resolution bought at the upscaler costs a fraction of rendering it natively |
| 1080p | render 480p → AI upscale ×2 → 1920×1080 | Cheapest route to full HD |
| 1080p native | the model renders 1080p; no upscaler | No interpolated frames. Several times the price. Only on models that offer it |

A 5-second clip on Seedance 2.0: **$0.59** at 4K, **$0.46** at 1080p
upscaled, **$2.18** at native 1080p. That ordering is not a mistake — see
`docs/NEXT.md`.

## Plans

Four tiers, declared in one place (`web/lib/config.ts`). Credit allocations
deliberately **match Runway's** so a member can compare like for like — the
difference is that generation here is billed at cost, so the same number of
credits goes several times further. Annual is 25% off.

| | Free | Standard | Pro | Max |
|---|---|---|---|---|
| Per month | $0 | $15 | $35 | $95 |
| Per year | — | $135 | $315 | $855 |
| Credits | 125 once | 625/mo | 2,250/mo | 7,000/mo |
| Storage | 5 GB | 20 GB | 100 GB | 500 GB |
| Upscaling | yes | yes | yes | yes |
| Buy more credits | no | yes | yes | yes |
| Unused credits carry over | — | no | no | 1 month |
| Queue priority | — | 1 | 2 | 3 |

Every plan can generate — Free included. What gates a generation is credits,
not membership.

### Granted credits expire; bought credits do not

This distinction is load-bearing, because a year of banked allocations spent
at once is exactly what an at-cost margin cannot absorb.

- A plan's allocation is recorded on the member as `granted_credits`.
- **Spending takes the granted half first**, so what remains after a spend is
  the credit they actually paid for (`chargeCredits` in `web/lib/grants.ts`).
  A refund puts back the same split the charge took, recorded on the ledger
  entry as `granted_delta`.
- At a **renewal of the same plan**, granted credits above the plan's
  rollover ceiling are forfeited — posted to the ledger as its own `expiry`
  entry, so a member sees what lapsed rather than a balance dropping for no
  stated reason.
- **Changing plan never forfeits anything.** Upgrading from Free to Standard
  carries the leftovers across; only a renewal expires credit.
- An **annual** subscriber is billed once but granted monthly: paying up
  front buys a cheaper month, not a year of credits to spend on day one.
  Monthly renewals are granted from the `invoice.paid` webhook; annual ones
  from a once-a-month sweep in the cron (`sweepPeriodGrants`). Both are
  idempotent on a `grant#<user>#<plan>#<period>` id, so they cannot both pay
  out.

## Pricing

Every price is derived, never typed in. The provider bills tokens:

```
tokens = frames × width × height / 1024        frames = duration × fps + 1
```

`web/lib/config.ts` holds each model's frame sizes and its rate per million
tokens; `web/lib/pricing.ts` turns that into a price. Estimates are held to
**0% to +1%** of what the provider actually bills — under is a loss on every
order, over a percent is money taken for nothing — and the admin status page
fails red if any drifts outside that band.

Nothing overrides the model rates from the environment. An override pins one
number and silently ignores promotions, the audio and video-input tiers and
the model's frame size, which is how a stale value once sold below cost.
Delivery, overhead and processing stay tunable from SSM.

## Money safety

- **Every finished generation is checked** against the tokens the provider
  actually billed. Charged below cost trips a halt; charged above cost is an
  alert only and never moves a price by itself.
- **The halt** stops new spend — jobs are refused before anyone is charged,
  and the pipeline holds queued work. Jobs already with a provider finish,
  because that money is spent either way.
- **Reconciliation** finds charges with no matching spend and refunds them
  idempotently, from the admin page.

## Branches and deploys

`main` is the branch. Feature work merges to it; **a push to `main` deploys
the `dev` stage**. Production deploys **only** from a `prod-YYYY-MM-DD` tag,
so merging can never ship to production by accident.

```bash
git tag prod-2026-09-10 && git push origin prod-2026-09-10   # deploy production
```

## Running locally

```bash
cd web && npm install && npm run dev     # SQLite backend, mock providers
```

`DB_BACKEND=dynamo` switches to AWS. `PROVIDER_MODE=mock` avoids spending
money. See `web/README.md`.

## Operations

This sandbox cannot reach AWS or the providers directly — everything runs
through GitHub Actions and the OIDC role
`arn:aws:iam::949228118688:role/remerge-github-deploy`. Each workflow says
what it costs and which need confirmation before spending. See
**[`docs/WORKFLOWS.md`](docs/WORKFLOWS.md)**.

**[`docs/TESTING.md`](docs/TESTING.md)** is the manual checklist for a dev
pass before production, with the cost of each step.

**[`docs/NEXT.md`](docs/NEXT.md)** is the running brief: what is verified,
what the provider's documentation gets wrong, and what is still outstanding.
Read it before changing pricing or adding a model.
