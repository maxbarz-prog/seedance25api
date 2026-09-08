# Remerged — next session brief

Handover for the go-live leg. A fresh Claude Code session can be told "read
docs/NEXT.md and go". Read `web/README.md` and `infra/README.md` first.

## Where things stand (2026-09-08)

- The whole platform lives on branch `claude/seedance-video-platform-9sp9cn`
  plus the commits on `claude/seedance-1080p-verify-c8cbha` (provider fixes,
  the check workflows, this brief). Pushing `web/**`, `functions/**`,
  `sst.config.ts` or `package.json` to the platform branch deploys the `dev`
  stage (https://dev.remerged.click) via `.github/workflows/deploy.yml`; a
  `prod-*` tag deploys `prod` (https://remerged.click). The Deploy workflow
  can also be dispatched manually on any branch: a branch ref deploys dev
  from that branch, a `prod-*` tag ref deploys prod.
- All keys are in SSM Parameter Store under `/remerged/dev/` and
  `/remerged/prod/`. The deploy workflow reads them by name; see the `load`
  loop in `deploy.yml` for the exact list.
- `PROVIDER_MODE=live` is set on both stages; the measured `COST_*` values
  are set on both stages (table below).
- Claude's sandbox cannot reach Stripe, Clerk, ModelArk or fal (egress
  policy). Anything that needs a provider call runs from a GitHub runner:
  - `.github/workflows/provider-check.yml` → `scripts/provider-check.mjs`.
    Modes: `keys` (Stripe/Clerk + webhook, free), `validate` (one small
    task per provider), `full` (the three-way cost test and the probes).
    Dispatch it with the GitHub MCP `actions_run_trigger` tool and read the
    job log with `get_job_logs`; the JSON summary is at the end.
  - `.github/workflows/dev-e2e.yml` → `scripts/dev-e2e.mjs`. Real-browser
    run on a deployed stage: Clerk sign-in token → Stripe Checkout with the
    4242 test card (join, then $10 top-up) → generate → extend → download.
    Needs a **test-mode** Stripe key on the stage (dev has one; see below).
- The AWS connector (`https://aws-mcp.us-east-1.api.aws/mcp`) authenticates
  with OAuth via AWS Sign-in using your IAM identity, not access keys: the
  access token lasts 1 hour and the refresh token at most 12 hours, after
  which the connector is dead until you sign in again. claude.ai keeps
  showing it as "Connected" in that state and there is no refresh button:
  Settings → Connectors → AWS → **Disconnect**, then **Connect** again and
  complete the AWS Sign-in consent page, then start a new session within 12
  hours. In-session symptom: every AWS tool call returns `MCP server "AWS"
  requires re-authorization (token expired)`. The `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` in the session env are proxy placeholders (STS
  rejects them), so boto3 or the CLI cannot be used as a fallback.

## Auth and billing: resolved and verified (2026-09-08)

Both stages are configured and the deployed dev stage passes an end-to-end
run. What was wrong and is now fixed:

- **Clerk was the wrong application.** The keys in SSM belonged to a
  production instance serving `facematch.click`, so sign-in could never work
  on either stage. Now: dev holds the new app's **Development** instance
  (`pk_test_`/`sk_test_`, any origin, no DNS); prod holds its **Production**
  instance (`pk_live_`/`sk_live_`, domain `remerged.click`). The five Clerk
  CNAMEs are in Route 53 and verified — see `infra/clerk-dns.json` and
  `.github/workflows/dns.yml`.
- **Stripe** is test mode on dev and live mode on prod, each with its own
  webhook endpoint and signing secret in SSM. Never copy one to the other.
- **A DynamoDB bug blocked every signup on AWS.** `createUser` wrote
  `stripe_customer_id: null`, and that attribute is the hash key of the
  users table's "stripe" GSI; DynamoDB rejects a NULL index key, so account
  creation 500'd on both stages. Fixed in `web/lib/data/dynamo.ts` (omit on
  insert, REMOVE on clear). Local SQLite accepted the null, which is why it
  never showed up in development.

## Status monitoring

The **admin page** carries a traffic-light panel fed by `GET
/api/admin/status` (`web/lib/status.ts`), in five groups:

- **config** — how the stage is wired (database, storage, ffmpeg, provider
  mode, generator, upscaler, auth, billing, webhook secret).
- **internal** — live probes of our own pieces: a read against the users
  table, a HeadBucket on the media bucket, and the age of the oldest
  in-flight job (catches a cron that has stopped advancing work).
- **dependency** — our real keys against each vendor's API, read-only and
  free: Stripe balance, Clerk users, ModelArk task list, a fal request-status
  lookup for an id that cannot exist (404 is the healthy answer). A 401/403
  is labelled "our side", a timeout or 5xx "their side".
- **vendor** — public incident feeds. Verified to exist and answer:
  Clerk, Cloudflare and GitHub (Statuspage `/api/v2/status.json`), Google
  (`appsstatus/dashboard/incidents.json`, open = no `end`), AWS
  (`health.aws.amazon.com/public/currentevents`, **served as UTF-16**,
  filtered to our region). **Stripe, fal and BytePlus publish no usable
  machine-readable status page** — those rows say so and defer to the direct
  probe above, which is the better signal anyway.
- **deprecation** — whether the pinned ModelArk model ids still appear in
  `GET {ARK}/models`. If one disappears, the row goes amber before
  generations start failing.

Results are cached 60 s; "Re-check" forces a refresh. Endpoints were
verified against the live services with `provider-check.yml mode=status`
(`scripts/status-probe.mjs`) rather than guessed — re-run it if a vendor
changes their feed.

`GET /api/health` stays public but says only `{ ok, ready }`: it must not
name the generator or upscaler, since provider identity is never revealed to
users.

## Spending discipline

Every generation and extension is a real, billed provider call (roughly
$0.42 for a 4 s 480p Seedance 2.5 clip, $2.10 at native 1080p). So:

- `dev-e2e.yml` defaults to `generate: "no"` and stops after billing. It
  still proves sign-up, sign-in, membership purchase, top-up, both webhooks
  and the credit ledger — all free. Only pass `generate: "yes"` deliberately.
- `provider-check.yml` defaults to `mode: keys`, the only free mode.
- To exercise the pipeline without paying, set `/remerged/dev/PROVIDER_MODE`
  to anything but `live` and redeploy; the mock provider returns a sample
  clip through the same states.

## Verified on dev (run 34279866051, no provider spend)

health → signup → Clerk ticket sign-in → membership via Stripe Checkout
(4242 test card, webhook activated it) → $10 top-up (webhook credited 1,000
credits) → generation skipped by choice. 29 seconds, `ok: true`.

Watch item: two RSC prefetches (`/terms`, `/library`) returned 429 during
the run. Direct navigation to those pages worked. Worth checking under load.

## Measured provider numbers (live run 2026-09-08, 4 s clips, 16:9, seed 12345)

Source: `provider-check.yml` run 34222147838. Cost = `usage.total_tokens` ×
ModelArk list price ($10.70/M tokens for Seedance 2.5 without video input,
$6.40/M with video input, $4.30/M for Seedance 2.0 resource packs). The Ark
billing console was not reachable from Claude; reconcile the first invoice
against these.

| Task | Output | Tokens | Per output second |
|---|---|---|---|
| Seedance 2.5, 480p | 854x480 @24 fps, 4.04 s | 38,830 | **$0.1028** |
| Seedance 2.5, native 1080p | 1920x1080 @24 fps, 4.04 s | 196,425 | **$0.5202** |
| Seedance 2.0, 480p | 864x496 @24 fps, 4.04 s | 40,594 | **$0.0432** |
| Seedance 2.0, native 1080p | 1920x1080 @24 fps, 4.04 s | 196,425 | **$0.2091** |
| fal ByteDance upscaler, 480p → 1080p | 1918x1080 @30 fps, 4.0 s, 141 s wall | n/a | **$0.0072** (list, per source second) |
| Seedance 2.5 extension, +6 s from a 4 s source | 854x480 @24 fps, 6.0 s | 96,075 | $0.1025 per added second (see below) |

Three-way comparison for a 1080p deliverable on Seedance 2.5: 480p→upscale
$0.110/s versus native $0.520/s, so the upscaled path is 4.7× cheaper.
Wall-clock: 480p ~160 s + upscale ~140 s versus native ~195 s.

`COST_*` set in SSM (dev and prod): SD25 480p 0.1028, SD25 1080p 0.5202,
SD20 480p 0.0432, SD20 1080p 0.2091, UPSCALE_2X 0.0072, UPSCALE_4X 0.0288
(4K is fal's list price, not measured).

## ModelArk facts confirmed on the live key

1. **1080p on `dreamina-seedance-2-5-260628` works** and renders a true
   1920x1080 frame. The launch-time 720p ceiling is gone. No routing change
   needed; the client sends `1080p` for native mode.
2. **`camera_fixed` is rejected at submit for Seedance 2.5 text-to-video**
   (`400: the specified parameter camera_fixed is not supported for model
   dreamina-seedance-2-5 in t2v, must be empty`). `BytePlusGenerator`
   now drops the flag and resubmits once on that specific 400. Not yet
   probed: whether 2.5 image-to-video or Seedance 2.0 accept it.
3. **Extension `duration` is the length of the output, and the output is the
   continuation only.** A +6 s request on a 4 s reference returned a 6.0 s
   clip whose first frame matches the source's last frame (SSIM 0.68) and not
   its first (0.26). So `durationS` = seconds added is the right contract.
   This matches every comparable product — the extension models behind Kling,
   Runway and Luma all return a continuation — but those products stitch
   before the user sees it, and now so do we: `finalize()` joins source +
   continuation with ffmpeg (`web/lib/video.ts:concat`) and stores the single
   video, updating `duration_s` to the real total. Stream copy first, with
   re-encode and a no-audio variant as fallbacks; any failure delivers the
   continuation alone rather than failing a paid job. Verified locally on
   real clips: 4 s + 6 s → 10.02 s, including the silent and mixed-audio
   fallback paths.
4. **Extension billing counts the reference video as input tokens.** 96,075
   tokens = ~4 s of source + 6 s of output at ~9,600 tokens/s, billed at the
   with-video rate ($6.40/M, i.e. 0.598× the plain rate). Left alone, cost
   per added second would grow with source length (a +5 s extension of a
   30 s clip ≈ $0.43 per added second). Fixed 2026-09-08 in two parts:
   - The pipeline sends only the last `EXTEND_CONTEXT_S` (5 s) of the source
     as the reference video, trimmed with `ffmpeg-static` in the server
     Lambda (`web/lib/video.ts`, `pipeline.ts`), stored under
     `tmp/<user>/<job>-context.mp4` and deleted when the job settles. Any
     trimming failure (missing binary, wrong CPU architecture) logs a
     warning and falls back to the full clip, so jobs never fail on it.
   - `quote()` takes `contextS` and prices `(added + context)` seconds at
     the with-video rate (`videoInputRatio`, env `COST_SD25_VIDEO_INPUT_RATIO`),
     plus the upscaler on the added seconds only. The extend route, the
     quote API (`context=` param) and the job page all pass it.
   Verify on dev after the first extension: the job log should not contain
   "ffmpeg unavailable" or "tail trim failed", and `usage.total_tokens` for
   the extension should be ≈ (5 + added) × 9,611 at 480p.
5. **fal queue polling** must address `queue.fal.run/fal-ai/bytedance-upscaler/requests/{id}`
   (the app id), not the full model subpath (405). Fixed in `fal.ts`; the
   result body carries `video.url` and `duration`.
6. Seedance 2.5 resource pack / `ModelNotOpen`: not encountered; tasks ran
   pay-as-you-go on this key.
7. Reference videos as plain https URLs (ModelArk's own output URLs) work.

## Tasks, in order

1. **Owner's manual generation test on dev** (deliberately not automated —
   the owner wants to validate output quality personally). Sign in at
   https://dev.remerged.click, join, top up, then generate a short clip in
   each mode, extend one, and download. What to watch:
   - 480p → upscaled 1080p is the default path; native 1080p is the premium
     toggle and costs about 5× more per second.
   - An extension returns **only the new seconds**, not source plus
     continuation (see ModelArk fact 3). Decide whether to concatenate.
   - After an extension, check the Lambda log via `logs.yml` for
     "ffmpeg unavailable" or "tail trim failed"; neither should appear.
   - Compare the ModelArk and fal invoices against the measured table below.
2. **Prod cutover.** `/remerged/prod/` is complete: provider keys, Clerk
   production keys, live Stripe key, webhook `we_1UDNRZ2Nd3VZM6rLW1KGdxoR`
   for `https://remerged.click/api/billing/webhook` with its secret,
   `MOCK_BILLING=0`, `PROVIDER_MODE=live`, and the `COST_*` values. Cut a
   `prod-YYYY-MM-DD` tag on the platform branch to deploy. The apex domain
   does not resolve until that first prod deploy, which is also when
   https://remerged.click/terms and /privacy go live.
3. **After the first real generations**, reconcile `COST_*` in SSM against
   the invoices and redeploy (the deploy bakes SSM values into the Lambda).

## Housekeeping

Test accounts named `e2e+<timestamp>@remerged.click` exist in the Clerk
development instance and the dev Dynamo tables; delete them when convenient.
One stray user `e2e+1788896363551@remerged.click` sits in the old
facematch Clerk app.
