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
    Needs a **test-mode** Stripe key on the stage (see the blocker below).
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

## Blocker: the dev Stripe key is a LIVE key

`/remerged/dev/STRIPE_SECRET_KEY` is `sk_live_…` (balance check returns
`livemode: true`). Consequences:

- The end-to-end run cannot pay with test cards, and nobody should be
  making real charges to test dev, so the "sign up, top up, generate,
  extend, download" rehearsal has not been run.
- The dev webhook endpoint was deliberately **not** created: a live-mode
  endpoint's secret would be wrong the moment dev switches to a test key.

To unblock: put an `sk_test_…` key into `/remerged/dev/STRIPE_SECRET_KEY`
(SecureString, overwrite), then dispatch `provider-check.yml` with
`mode=keys, stage=dev, webhook=create` (creates the test-mode endpoint for
`https://dev.remerged.click/api/billing/webhook` and stores the secret in
`/remerged/dev/STRIPE_WEBHOOK_SECRET`), redeploy dev, then dispatch
`dev-e2e.yml` with `stage=dev`.

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
   its first (0.26). So `durationS` = seconds added is the right contract,
   but the delivered file does not contain the original clip. Product
   decision pending: concatenate source + continuation at finalize (ffmpeg
   in the pipeline Lambda) or present extensions as separate clips.
4. **Extension billing counts the reference video as input tokens.** 96,075
   tokens = ~4 s of source + 6 s of output at ~9,600 tokens/s, billed at the
   with-video rate. Cost per added second therefore grows with source length:
   a +5 s extension of a 30 s clip costs about (35 × 9,611 × $6.40/M) / 5 =
   $0.43 per added second, four times the plain 480p rate the extend quote
   currently uses (`web/app/api/jobs/[id]/extend/route.ts` quotes
   `durationS` at the generation rate). Fix before prod: quote extensions as
   `(source.duration_s + durationS)` seconds at the with-video rate, or cap
   extension sources.
5. **fal queue polling** must address `queue.fal.run/fal-ai/bytedance-upscaler/requests/{id}`
   (the app id), not the full model subpath (405). Fixed in `fal.ts`; the
   result body carries `video.url` and `duration`.
6. Seedance 2.5 resource pack / `ModelNotOpen`: not encountered; tasks ran
   pay-as-you-go on this key.
7. Reference videos as plain https URLs (ModelArk's own output URLs) work.

## Tasks, in order

1. **Dev go-live check.** The Deploy workflow was dispatched on
   `claude/seedance-1080p-verify-c8cbha` on 2026-09-08 with live providers
   and the measured costs. Confirm the run is green and
   https://dev.remerged.click loads.
2. **Swap dev to a Stripe test key** and run the steps under the blocker
   above (keys run → redeploy → `dev-e2e.yml`). Read the e2e summary and
   the screenshots artifact.
3. **Extension pricing** (fact 4 above) and the concatenate-or-not decision
   (fact 3). Both are a few lines in `pricing.ts` / the extend route /
   `pipeline.ts`.
4. **Merge into the platform branch.** `claude/seedance-video-platform-9sp9cn`
   is behind `claude/seedance-1080p-verify-c8cbha` (provider fixes, check
   workflows, this brief). Merge or fast-forward it; that push redeploys dev.
5. **Prod cutover.** `/remerged/prod/` is complete: provider keys, Clerk,
   admin emails, `MOCK_BILLING=0`, `PROVIDER_MODE=live`, the live Stripe
   key, the live webhook endpoint `we_1UDNRZ2Nd3VZM6rLW1KGdxoR` for
   `https://remerged.click/api/billing/webhook` with its secret in
   `/remerged/prod/STRIPE_WEBHOOK_SECRET`, and the `COST_*` values. Cut the
   first `prod-YYYY-MM-DD` tag on the platform branch, watch the Deploy run,
   then run `dev-e2e.yml` with `stage=prod` **only if** you accept one real
   monthly membership charge plus a $10 top-up on your own card (there is no
   test mode in prod); otherwise sign up by hand and verify manually.
6. **After the first real generations**, compare the ModelArk and fal
   invoices with the table above and adjust `COST_*` in SSM. The deploy
   workflow bakes SSM values into the Lambda environment, so redeploy after
   changing any parameter.
