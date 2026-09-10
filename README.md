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

**[`docs/NEXT.md`](docs/NEXT.md)** is the running brief: what is verified,
what the provider's documentation gets wrong, and what is still outstanding.
Read it before changing pricing or adding a model.
