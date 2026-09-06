# Remerged — AI video at cost

Members-only AI video generation: Seedance rendered at 480p and AI-upscaled to
1080p (native 1080p available as a premium mode), sold at exactly our cost.
Revenue comes from the membership, not from marking up generation.

## Architecture

- **Next.js 15 (App Router, TypeScript, Tailwind)** — the whole product is one app.
- **SQLite** (`lib/db.ts`) — users, credit ledger, jobs. All access goes through
  repository functions, so the store can be swapped for DynamoDB/Postgres when
  we move to AWS.
- **Provider abstraction** (`lib/providers/`) — generation and upscaling behind
  interfaces; mock implementations run the full UX with zero external keys.
  Provider identity never reaches API responses.
- **Pipeline** (`lib/pipeline.ts`) — queued → generating → upscaling → ready |
  failed (auto-refund). Advancement is lazy (on poll) in dev; maps 1:1 to a Step
  Functions state machine in production.
- **Pricing** (`lib/pricing.ts`) — the public at-cost formula:
  `price = (provider + delivery) / (1 - processing)`. All rates env-overridable.
- **Billing** (`lib/billing.ts`) — Stripe Checkout (payment top-ups +
  subscription membership) with signature-verified webhook and idempotent credit
  grants; a mock mode covers local dev without keys.

## Run locally

```bash
npm install
npm run dev
```

No env needed: providers and billing run in mock mode (mock "payments" apply
instantly; generations complete in ~30s with a sample clip).

## Going live

Copy `.env.example` to `.env.local` and fill in: `SESSION_SECRET`, Stripe keys,
provider keys, `PROVIDER_MODE=live`. Production items tracked for the AWS phase:
copy provider output into our own S3 + CloudFront before exposing URLs, Stripe
subscription renewal/lapse webhooks, Cognito or hardened auth, storage lifecycle
enforcement.
