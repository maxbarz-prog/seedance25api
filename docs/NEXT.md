# Remerged — next session brief

Handover for the go-live leg. A fresh Claude Code session can be told "read
docs/NEXT.md and go". Read `web/README.md` and `infra/README.md` first.

## How this repository is laid out and deployed (2026-09-10)

**`main` is the branch.** Until 2026-09-10 it held only a README and every
line of application code lived on feature branches, so a fresh checkout
looked like an empty repository and the deployed stack looked like it came
from nowhere. 84 commits were fast-forwarded onto main; nothing was
rewritten.

**Deploys.** `deploy.yml` deploys the `dev` stage on a push to `main` that
touches `web/`, `functions/`, `sst.config.ts` or `package.json`. Production
deploys ONLY from a tag matching `prod-*` (e.g. `prod-2026-09-10`), so
merging can never ship to production by accident.

Every other workflow carries a `push: branches: [main]` trigger as well.
That trigger exists solely so GitHub registers the workflow and makes it
dispatchable — the jobs themselves are gated on `workflow_dispatch` and skip
on a push. Until 2026-09-10 those triggers still named long-dead feature
branches, which is why nothing ever ran automatically and every deploy this
week was dispatched by hand.

See `docs/WORKFLOWS.md` for what each one does, what it costs, and how to run
it.


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

Source: `provider-check.yml` run 34222147838. Cost = `usage.total_tokens` x
the model's price per million tokens. The Ark billing console was not
reachable from Claude; reconcile the first invoice against these.

**Corrected 2026-09-09.** The Seedance 2.0 rows below were originally costed
at $4.30/M, which is the *with-video-input* rate. Plain text-to-video bills
at $7.00/M at 480p and $7.70/M at 1080p, so those two rows were 56% and 79%
low and we were selling 2.0 below cost. The token counts were always right;
only the price per million was wrong. Prices are now derived in code from
the per-model rate in `web/lib/config.ts` rather than tabulated, so this
class of error cannot recur silently.

| Task | Output | Tokens | Per output second |
|---|---|---|---|
| Seedance 2.5, 480p | 854x480 @24 fps, 4.04 s | 38,830 | **$0.1028** |
| Seedance 2.5, native 1080p | 1920x1080 @24 fps, 4.04 s | 196,425 | **$0.5202** |
| Seedance 2.0, 480p | 864x496 @24 fps, 4.04 s | 40,594 | **$0.0673** (was $0.0432) |
| Seedance 2.0, native 1080p | 1920x1080 @24 fps, 4.04 s | 196,425 | **$0.3742** (was $0.2091) |
| fal ByteDance upscaler, 480p → 1080p | 1918x1080 @30 fps, 4.0 s, 141 s wall | n/a | **$0.0072** (list, per source second) |
| Seedance 2.5 extension, +6 s from a 4 s source | 854x480 @24 fps, 6.0 s | 96,075 | $0.1025 per added second (see below) |

Three-way comparison for a 1080p deliverable on Seedance 2.5: 480p→upscale
$0.110/s versus native $0.520/s, so the upscaled path is 4.7× cheaper.
Wall-clock: 480p ~160 s + upscale ~140 s versus native ~195 s.

`COST_*` in SSM (dev and prod): SD25 480p 0.1028, SD25 1080p 0.5202,
UPSCALE_2X 0.0072, UPSCALE_4X 0.0288 (4K is fal's list price, not measured).
The SD20 pair was **deleted on 2026-09-09** — it held the $4.30/M-derived
values and an override beats the rate derived in code, so it would have kept
2.0 mispriced. `ssm-cost.yml` sets or deletes these; deleting is the normal
fix, since with no override the rate comes from the token price in
`lib/config.ts`.

## Model catalogue and provider rates (authoritative, 2026-09-09)

Source: the ModelArk pricing page, docs.byteplus.com/en/docs/ModelArk/1544106.
Every rate below reproduces that page's own worked price examples exactly —
checked, not assumed. All values are USD per million tokens. `sd` covers 480p
and 720p output; `hd` is 1080p; "+video" is the lower rate when a reference
video rides along (an extension), whose seconds bill as input.

| Model | sd | sd +video | hd | hd +video |
|---|---|---|---|---|
| `dreamina-seedance-2-5-260628` | 10.70 | 6.40 | **11.70** | **7.00** |
| `dreamina-seedance-2-0-260128` | 7.00 | 4.30 | 7.70 | **4.70** |
| `dreamina-seedance-2-0-fast-260128` | 5.60 | 3.30 | — | — |
| `dreamina-seedance-2-0-mini-260615` | 3.50 | 2.10 | — | — |
| `seedance-1-5-pro-251215` | 1.20 silent / 2.40 with audio (flat) |||| 
| `seedance-1-0-pro-250528` | 2.50 (flat) ||||
| `seedance-1-0-pro-fast-251015` | 1.00 (flat) ||||

Traps in that table, each of which had already cost us money or would have:

1. **2.5's 1080p rate is 11.70, not 10.70.** 10.70 is the 480p/720p tier.
   Same shape as the 2.0 mistake: a cheaper tier read as the whole price.
2. **2.0's with-video rate at 1080p is 4.70, not 4.30**, for the same reason.
3. **2.0 Fast and 2.0 Mini have no 1080p or 4K output at all.** Offering a
   native-1080p option for them quoted a render the provider will not do.
   Both API routes now refuse it and the composer hides the option.
4. **1.5 Pro prices by soundtrack, not resolution.** Quotes take the audio
   flag through the composer, both routes and the extend flow.
5. **Frame sizes are not what the docs' headline resolutions suggest.** 480p
   comes back 864x496 on the 2.0 series (measured: 40,594 tokens for 4.04 s)
   and 1080p is 1920x1088 on the 1.0 Pro pair (the provider's own token
   table). `TOKENS_PER_SEC` uses the larger of each, so a quote errs high
   rather than selling under.
6. **Minimum token consumption** applies to the 2.0 series and 2.5 when the
   input includes video: below roughly 4 s of input, the bill is floored.
   `EXTEND_CONTEXT_S` is 5 s, above the floor, so extensions are unaffected —
   but lowering it would silently stop reducing cost.

Time-limited promotions live in the registry with their expiry and apply only
while running, so a rate returns to list by itself when one lapses:
2.5 1080p 28% off to 2026-09-17; 2.0 Fast 25% and 2.0 Mini 60% off to
2026-10-07. Baking a discounted number into a table is how a price silently
goes below cost.

## Activation: listed and priced is not the same as callable (2026-09-09)

Only FOUR models can actually be called on account 3003868753:
`dreamina-seedance-2-5-260628`, `dreamina-seedance-2-0-260128`,
`dreamina-seedance-2-0-fast-260128`, `dreamina-seedance-2-0-mini-260615`.

These five are listed on the pricing page AND present in the `/models`
catalogue, but a submit answers **404 ModelNotOpen**:
`seedance-1-5-pro-251215`, `seedance-1-0-pro-250528`,
`seedance-1-0-pro-fast-251015`, `seedance-1-0-lite-t2v-250428`,
`seedance-1-0-lite-i2v-250428`. So is every Seedream image model, which is
why the bake-off cannot generate its own key frame from a still model.

**The `/models` catalogue is not an activation check** — all nine Seedance
models appear in it. Only a real submit tells them apart. Three of these were
briefly offered on dev after being added from the pricing page; a member
choosing one would have got a failed generation.

They carry `activated: false` in the registry, which keeps their verified
rates but excludes them from `MODEL_IDS`. To turn one on: activate it in the
Ark Console (Model activation), re-run `model-activation.yml` (free, no
generation) to confirm, then delete the flag.

Still unpriced regardless of activation: the `1-0-lite` pair, which appears
nowhere on the pricing page.

No `COST_*` model overrides remain in SSM — only the two fal upscaler rates,
which are a different provider. `ssm-cost.yml` sets or deletes them;
`stage-check.yml` reads a deployed stage's quotes for free (no auth, no
generation) and asserts the 1.5 Pro audio rule and the 2.0 Fast refusal.

## Model bake-off, 2026-09-09 (run 34376740213, $1.42 spent)

Four models, same key frame, same prompt, same seed, 5s at 480p then upscaled
to 1080p. Both versions of every clip are in the run's artifact.

| Model | Tokens | 480p frame | Cost to us | We charge | Margin | Gen |
|---|---|---|---|---|---|---|
| Seedance 2.5 | 48,437 | 854x480 | $0.5543 | $0.67 | ok | 247 s |
| Seedance 2.0 | 50,638 | 864x496 | $0.3905 | $0.46 | ok | 111 s |
| Seedance 2.0 Fast | 50,638 | 864x496 | $0.2487 | $0.30 | ok | 101 s |
| Seedance 2.0 Mini | 50,638 | 864x496 | $0.1069 | $0.14 | ok | 79 s |

What it settled:

1. **The token formula is right to 0.03%.** Predicted 50,622 for a 5.04 s
   864x496 clip, billed 50,638.
2. **480p is not one frame size.** The 2.0 family renders 864x496; 2.5
   renders 854x480. `TOKENS_PER_SEC.p480` uses the larger, so a 2.5 quote
   runs about 4.5% high — the safe direction, by design.
3. **No render was priced below cost**, and the margin guard's arithmetic now
   has real provider-reported tokens behind it, not just fixtures.
4. **2.5 is slow**: 247 s against 79-111 s for the 2.0 family, before the
   upscale. Worth knowing before it is made the default for long clips.
5. The upscaler preserves the source aspect rather than padding to 1920 —
   1880x1080 from 864x496, 1918x1080 from 854x480 — and moves 24 fps to 30.

**The bug it found, which was live:** a first- or last-frame image pins the
output ratio at the provider, and sending an explicit `ratio` alongside one
fails the whole request at submit ("For first-frame or first-last-frame
generation, the output ratio follows the first-frame image"). Any member
attaching a start image and leaving the aspect on its 16:9 default would have
had the generation rejected. `buildGenerationBody` now sends `adaptive`
whenever a frame is supplied, as it already did for extensions.

## Generation speed: their renderer, not their queue (2026-09-10)

Run 34433768931, text-to-video, 5 s at 480p, all four sold models, one
prompt, one seed. Queue time is measured from the task's queued -> running
transition, polled every 5 s.

| Model | Queued | Rendering | Tokens | Est drift |
|---|---|---|---|---|
| Seedance 2.5 | **0 s** | **368 s** | 48,437 | +0.50% |
| Seedance 2.0 | **0 s** | 81 s | 50,638 | +0.50% |
| Seedance 2.0 Fast | **0 s** | 109 s | 50,638 | +0.50% |
| Seedance 2.0 Mini | **0 s** | 121 s | 50,638 | +0.50% |

**Queue time was zero on every task.** They pick work up within 5 s; the wait
is their compute. Two consequences:

1. **The pending rate-limit increase will not make anything faster.** More
   concurrency raises throughput, not latency. Worth not promising otherwise.
2. Nothing in our pipeline contributes. We submit and poll; the only overhead
   we add is the poll interval.

**Do not rank the 2.0 family on speed from these numbers.** The ordering
inverted between two runs — Mini was the fastest at 79 s on 2026-09-09 and
the slowest at 121 s on 2026-09-10, on comparable work. One sample each is
noise. The per-model timing now recorded on every job (admin page, median
seconds per second of output) is what should settle it, from real traffic.

What IS stable across both runs: **Seedance 2.5 is 2-4.5x slower than the
whole 2.0 family**, and it got worse on the easier job — 247 s with a start
image, 368 s without. With the upscale on top that is 8.3 minutes for a
5-second clip. Relevant before making it the default.

Also measured: the fal upscaler takes 130-170 s regardless of model, and
always outputs 30 fps from a 24 fps source, so it interpolates frames that
were never rendered.

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

0. **Measure the 720p frame size** (≈$2.35, needs approval). 720p is wired
   through the registry, the pricing formula, the composer, the pipeline and
   the catalogue endpoint, but is withheld from `VERIFIED_QUALITIES` in
   `web/lib/config.ts` because nobody has measured what frame the models
   actually emit at that resolution. The estimate would be a guess, and a
   guess breaks the 0..+1% rule in both directions. Run
   `.github/workflows/model-frame-size.yml` with `resolution=720p`, paste the
   `frameSize` lines it prints into `config.ts`, add the matching fixtures to
   `TOKEN_FIXTURES` in `web/lib/status.ts`, then add `"720p"` to
   `VERIFIED_QUALITIES`.

   Worth knowing before spending: 720p is poor value. A 5s Seedance 2.5 clip
   costs $0.77 at 480p→4K and $1.52 at 720p→4K, for the same delivered
   3840×2160. The only thing the extra buys is more real detail going into
   the upscaler.

1. **Owner's manual generation test on dev** (deliberately not automated —
   the owner wants to validate output quality personally). Sign in at
   https://dev.remerged.click, join, top up, then generate a short clip in
   each mode, extend one, and download. What to watch:
   - The default is 480p rendered, upscaled to 4K. Quality and upscale are
     now separate controls: 480p/1080p × 4K/1080p/none. Native 1080p is the
     premium render and costs about 4× more per second for a quarter of the
     delivered pixels.
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
