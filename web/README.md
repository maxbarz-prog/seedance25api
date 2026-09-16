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

## Pages and the way in

- `/` — the landing page: the tagline, the showcase clips
  (`public/landing/`, rendered by the landing-showcase workflow from the
  list in `lib/landing.ts`), and one call to action, `/create`. White
  whatever the system theme; the only page whose tab carries the tagline.
- `/create` — the composer. Public and cached like the landing page; a
  signed-out visitor types a prompt, and pressing Generate (or Enter) is
  what leads to sign-up. The draft survives in localStorage.
- `/sign-up`, `/sign-in` (Clerk) and `/signup`, `/login` (built-in auth) — a
  split screen: the showcase clips on the left, one question at a time on
  the right (`components/auth/`). The Clerk flows are drawn by us with
  `useSignUp`/`useSignIn` from `@clerk/nextjs/legacy`: email, then password,
  then the emailed code; Google returns through `/sso-callback`.
- **Deleting an account** goes through `lib/account.ts` from two doors: the
  member pressing Delete (confirmed by typing `delete`, which works the same
  for a Google sign-in as for a password), and Clerk's `user.deleted`
  webhook at `/api/auth/clerk`, so an identity removed in the Clerk
  dashboard takes our row, credits and videos with it. Our own deletion
  removes the Clerk user too. The webhook needs
  `CLERK_WEBHOOK_SIGNING_SECRET` in SSM (`/remerged/<stage>/`) and the
  endpoint added under Webhooks in the Clerk dashboard, subscribed to
  `user.deleted`. The Clerk id → row mapping is `clerk#<id>` in the system
  store, written the first time an identity is seen.
- The plan modal (`components/PlanModal.tsx`) is mounted once in the site
  layout and opened from the header's Upgrade button, the composer's
  refusal dialog and the welcome offer via `openPlans()` in `lib/ui-events.ts`.
- `/welcome` — the welcome flow a new account is sent to after sign-up. Two
  screens on the same split-screen shell as sign-up — finalize (the Terms
  and Privacy consent, one Create account button) and a referral code or
  Skip — then three dark full-screen questions with a progress bar: who
  they are, what they came for, how they heard of us. Answers live on the
  user row (`lib/onboarding.ts`); it ends at `/create` with the plan modal
  over the composer, once, and a member's composer carries no examples or
  pitch (`components/VisitorOnly.tsx`).
- **Growth events** (`lib/events.ts`) — the browser reports page views, welcome
  steps and the offer through `/api/events`; the server records account
  creation, jobs and paid plans where they happen. `/admin` reads them back
  as a funnel, by window, in the Growth section.

- **The audit diary** (`lib/audit.ts`) — a dated record of things that happened,
  kept so a timeline can be reconstructed after the live rows are gone: accounts
  created and deleted, payments, refunds, disputes, freezes. A chargeback
  arrives months after the payment and a deletion takes the account's history
  with it, which is what this is for.

  Three rules make it a record rather than a second copy of the product's state,
  and `npm run lint` fails the build if the first one is broken:

  1. **Nothing reads it.** No sign-up check, no grant, no rate limit. An account
     deleted and remade with the same address behaves exactly as it did the
     first time, because nothing on that path knows the diary exists. The only
     reader is `/api/admin/audit`.
  2. **No content.** No prompts, no videos, no IP addresses, no user agents.
     Amounts, counts, dates, provider ids and fixed reason codes.
  3. **It expires.** Each line carries the date it stops being kept and the
     store deletes it then: seven years for money, two for everything else.

  The address is not stored. What is stored is an HMAC of it under `AUDIT_SALT`,
  so a timeline still joins across a deletion and a fresh sign-up when an
  administrator types the address in, while a copy of the table on its own is a
  list of hashes with no key to reverse them. Changing that salt orphans every
  hash already written, so `ssm-secrets.yml` generates it once and leaves it
  alone.

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
