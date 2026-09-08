# Remerged — next session brief

Handover for the validation-to-prod leg. A fresh Claude Code session can be
told "read docs/NEXT.md and go". Read `web/README.md` and `infra/README.md`
first.

## Where things stand

- The whole platform lives on branch `claude/seedance-video-platform-9sp9cn`.
  Pushing `web/**`, `functions/**`, `sst.config.ts` or `package.json` to that
  branch deploys the `dev` stage (https://dev.remerged.click) via
  `.github/workflows/deploy.yml`; a `prod-*` tag deploys `prod`
  (https://remerged.click). Work on any other branch does **not** deploy until
  it is merged into that branch.
- All keys are in SSM Parameter Store under `/remerged/dev/` (Stripe test,
  BytePlus, fal, Clerk). The deploy workflow reads them by name; see the
  `load` loop in `deploy.yml` for the exact parameter list.
- Providers run in mock mode until `PROVIDER_MODE=live` is set in SSM.
- The AWS connector (`https://aws-mcp.us-east-1.api.aws/mcp`) must be
  connected and enabled for the session. Its OAuth token expires; if AWS
  tools error with "requires re-authorization", reconnect it in claude.ai
  Settings → Connectors and start a new session.

## Provider request shapes (confirmed 2026-09-08 from the ModelArk schema)

Source: BytePlus ModelArk API as encoded in the open-source seedance-cli
(paperfoot/seedance-cli, run daily against the live API) and the fal model
page for `fal-ai/bytedance-upscaler/upscale/video`. Applied in
`web/lib/providers/byteplus.ts` and `web/lib/providers/fal.ts`.

BytePlus ModelArk, `POST /api/v3/contents/generations/tasks`:

| Concern | Field |
|---|---|
| Model ids | `dreamina-seedance-2-5-260628`, `dreamina-seedance-2-0-260128` |
| Generation controls | top-level `resolution`, `ratio`, `duration`, `seed`, `generate_audio`, `watermark`, `return_last_frame` (not prompt text flags) |
| Image roles | `content[].role` = `first_frame`, `last_frame`, `reference_image` |
| Reference video / audio | `content[]` `type: "video_url"` + `role: "reference_video"`; `type: "audio_url"` + `role: "reference_audio"` |
| Extension | no dedicated role: `reference_video` + extend/continue intent in the prompt, and `ratio` must be `adaptive` (else `InvalidParameter.TaskTypeConstraint`, raised asynchronously) |
| Terminal statuses | `succeeded`, `failed`, `cancelled`, `expired` |
| Result | `content.video_url`, `content.last_frame_url`, `usage.total_tokens` |

Still to confirm on a live key (each is flagged in the client comments):

1. Whether `camera_fixed` is accepted as a top-level boolean.
2. Whether extension `duration` is the added length or the total length.
3. Whether Seedance 2.5 accepts `1080p`. The public model catalogue lists
   720p as its ceiling and 1080p/4k as 2.0-only. If so, "native 1080p" mode
   must route to Seedance 2.0 or be limited to 2.0 in the UI.
4. Seedance 2.5 needs a prepaid resource pack in the Ark console; without one
   calls return `ModelNotOpen`.
5. Reference videos must be fetchable URLs (presigned S3 URLs are fine, ~1h).

fal upscaler, `POST https://queue.fal.run/fal-ai/bytedance-upscaler/upscale/video`:
`video_url` plus `target_resolution` in `1080p` | `2K` | `4K`. Published
price per source second at 30fps: 0.0072 / 0.0144 / 0.0288 USD. The
`COST_UPSCALE_4X_PER_SEC` default is now 0.0288.

## Tasks, in order

1. **Verify AWS access.** `sts:GetCallerIdentity`, then list parameter names
   under `/remerged/dev/` (`ssm:GetParametersByPath`, recursive, no
   decryption needed for names).
2. **Validate each provider key** with a minimal call: Stripe
   (`GET /v1/balance`), BytePlus (create a 4s 480p task and poll it), fal
   (submit a short upscale and poll it), Clerk (`GET /v1/users?limit=1`).
3. **Three-way quality test.** Same prompt and seed on Seedance 2.5 at
   480p, native 1080p, and 480p→1080p upscaled. Record `usage.total_tokens`
   from each task (the pipeline logs it as `generation usage`) and the fal
   request cost, then report cost per output second from real billing
   (ModelArk billing console / fal usage page), not from list prices.
4. **Set measured `COST_*` parameters** in SSM under `/remerged/dev/`:
   `COST_SD25_480P_PER_SEC`, `COST_SD25_1080P_PER_SEC`,
   `COST_SD20_480P_PER_SEC`, `COST_SD20_1080P_PER_SEC`,
   `COST_UPSCALE_2X_PER_SEC`, `COST_UPSCALE_4X_PER_SEC`.
5. **Confirm the open ModelArk questions** above with the live key and fix
   `web/lib/providers/byteplus.ts` if needed (image roles, extend, reference
   video/audio are already aligned; `camera_fixed`, extension duration and
   2.5 resolution ceiling remain).
6. **Stripe webhook.** Create an endpoint for
   `https://dev.remerged.click/api/billing/webhook` listening to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`, and store its signing secret as
   `/remerged/dev/STRIPE_WEBHOOK_SECRET` (SecureString).
7. **Go live on dev.** Set `/remerged/dev/PROVIDER_MODE=live`, redeploy
   (push to the platform branch or run the Deploy workflow), and do an
   end-to-end generation on the dev site: sign up, mock or test-card top-up,
   generate, extend, download.
8. **Prepare prod.** Create the same parameter set under `/remerged/prod/`
   with live Stripe keys, a prod webhook endpoint for
   `https://remerged.click/api/billing/webhook`, and the measured `COST_*`
   values; then cut the first `prod-YYYY-MM-DD` tag on the platform branch.
