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

## BLOCKER: the Clerk keys belong to another app (found 2026-09-08)

The `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in SSM (dev and
prod, same values) are a **production instance whose only domain is
`facematch.click`** (frontend API `clerk.facematch.click`). Clerk
production instances serve exactly their configured domain, so the sign-in
widget on dev.remerged.click / remerged.click never completes a session; the
end-to-end run (34270152274) timed out on the sign-in page for that reason.
Nobody can sign in until this is fixed.

Fix, in the Clerk dashboard (https://dashboard.clerk.com):

1. Create a new application "Remerged" (Google + email sign-in as before).
2. **Dev**: from its *Development* instance copy `pk_test_…` and `sk_test_…`
   into `/remerged/dev/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `/remerged/dev/CLERK_SECRET_KEY`. Development instances serve any origin,
   so dev.remerged.click works with no DNS.
3. **Prod**: create its *Production* instance with domain `remerged.click`,
   copy `pk_live_…` / `sk_live_…` into the `/remerged/prod/` parameters,
   then dispatch `provider-check.yml` with `mode=keys, stage=prod,
   clerk_dns=upsert`: it verifies the instance serves remerged.click and
   writes the five Clerk CNAMEs (clerk, accounts, clkmail, clk._domainkey,
   clk2._domainkey) into the Route 53 zone. Clerk shows the domain as
   verified once DNS propagates.
4. Redeploy the stage (parameters are baked in at deploy) and run
   `dev-e2e.yml`.

The keys run now reports `siteCheck` (MISMATCH / ok / development instance)
and decodes the publishable key's host, so a mismatched pair is caught too.
The failed e2e run created a stray user `e2e+1788896363551@remerged.click`
in the facematch Clerk app; delete it from that dashboard.

## Stripe on dev (resolved 2026-09-08)

`/remerged/dev/STRIPE_SECRET_KEY` is now a test-mode key (`sk_test_…`,
`livemode: false`). The test-mode webhook endpoint
`we_1UDUcR2Nd3VZM6rLeEsRqKne` for `https://dev.remerged.click/api/billing/webhook`
exists and its secret is in `/remerged/dev/STRIPE_WEBHOOK_SECRET`. If the
key is ever rotated, dispatch `provider-check.yml` with `mode=keys,
stage=dev, webhook=recreate` and redeploy.

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

0. **Clerk keys** (blocker above), then redeploy dev.
1. **Dev end-to-end.** Dev is deployed with live providers, the measured
   costs, the test-mode Stripe key and its webhook. Dispatch `dev-e2e.yml`
   with `stage=dev` after any deploy and read the summary plus the
   screenshots artifact; it signs up, joins, tops up, generates, extends and
   downloads.
2. **Concatenate-or-not** for extensions (fact 3 above): the delivered file
   is the continuation only. If members should get source + continuation in
   one file, join them with ffmpeg at finalize (the binary is already in the
   server bundle).
3. **Prod cutover.** `/remerged/prod/` is complete: provider keys, Clerk,
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
