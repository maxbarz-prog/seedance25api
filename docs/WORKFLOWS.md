# Workflows

Everything that touches AWS or a provider runs here, because the development
sandbox has no route to either. All of them assume the OIDC role
`arn:aws:iam::949228118688:role/remerge-github-deploy` and read secrets from
SSM under `/remerged/<stage>/`.

Each carries a `push: branches: [main]` trigger. **That trigger only
registers the workflow with GitHub so it becomes dispatchable** — every job
except `deploy` is gated on `workflow_dispatch` and skips on a push. Until
2026-09-10 those triggers named feature branches that no longer existed,
which is why nothing ran automatically.

## Costs money

These call a paid provider. Each refuses to run without explicit
confirmation, and each fails *before* spending if its inputs are wrong.

### `model-bakeoff.yml` — compare models side by side
Renders the same clip on every sold model, optionally upscales it, and
reports tokens billed against our estimate, cost, price and margin verdict.
Needs the word `spend` typed into `confirm`.

| Input | Meaning |
|---|---|
| `t2v` | Text-to-video, no starting image. **Required for anything involving people** — the provider refuses photographs of real people |
| `native` | Render at 1080p with no upscaler, instead of 480p + upscale. Only 2.5 and 2.0 can |
| `models` | Limit to named model ids, so a partial re-run does not re-pay for renders that already worked |
| `reuse_run_id` | Reuse an earlier run's key frame and artifact rather than paying for a new one |
| `key_image_url` | A starting image. Fetched and re-hosted on our own bucket, because stock sites refuse datacentre IPs |

Roughly $1.30 for four models at 5s upscaled; $3.95 for the two that can do
native 1080p.

### `model-frame-size.yml` — measure what a resolution really is
Every price is derived from the frame size a model actually emits, and that
is not predictable from the resolution name: "480p" is 854×480 on Seedance
2.5 and 864×496 on the 2.0 family, a 4.5% difference. Guessing it low sells
below cost; guessing it high overcharges. So a resolution stays out of
`VERIFIED_QUALITIES` in `web/lib/config.ts` — and therefore off the site —
until this has measured it.

It renders the shortest allowed clip per model at the resolution under test,
reads back the token count the provider billed, inverts
`tokens = frames × w × h / 1024` to get the size they charged for, probes the
delivered file with ffprobe, and prints the exact `frameSize` line to paste
into `config.ts`. Needs the word `spend` typed into `confirm`.

| Input | Meaning |
|---|---|
| `resolution` | Which to measure. `720p` is the one currently unmeasured |
| `duration` | Seconds per clip. The frame size does not depend on it, so leave it at the minimum |
| `models` | Limit to named model ids |

About $2.35 for all four models at 720p, before promotions.

### `upscale-4k.yml` — one clip to 4K
Takes a file from an earlier bake-off artifact and upscales it, publishing
under its own artifact name (`4k-sample`) so looking at one thing does not
mean downloading a dozen. About $0.03 per source second.

### `dev-e2e.yml` — the whole member journey in a browser
Signs up, joins, tops up with Stripe test cards, generates, extends and
downloads. `generate` defaults to `"no"`, which stops after billing and
spends nothing.

## Free

### `deploy.yml` — the only way anything ships
Deploys the `dev` stage on a push to `main` touching `web/`, `functions/`,
`sst.config.ts` or `package.json`. **Production deploys only from a `prod-*`
tag.** Also dispatchable.

### `stage-check.yml` — what a deployed stage actually serves
Reads the public quote API and pricing page. Asks the site which models it
sells (`/api/models`) rather than keeping its own copy of the list, then
checks every model quotes on every route it claims to support, that a model
without native 1080p refuses it, that a soundtrack-priced model costs more
with audio, and that withdrawn models are absent and refused with a 400.

Run it after every deploy. No auth, no writes, no generation.

### `model-activation.yml` — which models we may actually call
**Being on the provider's price list does not mean the account can use it.**
Five of the nine Seedance models answer 404 `ModelNotOpen`, as does every
Seedream image model — and all nine appear in the `/models` catalogue, so
that endpoint proves nothing.

Probes each model with a deliberately invalid request: a 404 means not
activated, a 400 means activated and the parameters were refused. No task is
created either way. **Run this before offering a new model.**

### `provider-check.yml` — keys, status and request shapes
Modes: `keys` (default, auth only), `status`, `validate`, `full`. Confirms
credentials work and request shapes are still accepted.

### `aws-verify.yml` — access and configuration
Proves the OIDC role works and lists `/remerged/*` parameter names, plus
`COST_*` values. Those are per-second provider rates, not credentials, and an
override silently beats the rate derived in code — so it has to be visible.

### `ssm-cost.yml` — set or delete `COST_*` parameters
Deleting is the normal fix: with no override the rate comes from
`web/lib/config.ts`, which is where it belongs. Refuses any parameter not
named `COST_*`, so it cannot touch a key.

### `ssm-promote.yml` — copy secrets between stages
Named parameters only, dev → prod. Values are masked and never printed; only
a fingerprint is shown, enough to confirm both sides match.

### `dns.yml` — Route 53 records
Applies the record set in `infra/clerk-dns.json`.

### `logs.yml` — CloudWatch
Reads Lambda logs without needing console access.

## Adding a model

1. Add it to `MODELS` in `web/lib/config.ts` with its upstream id, measured
   frame sizes and rate per million tokens.
2. **Run `model-activation.yml`.** If it is not activated, mark
   `activated: false` and stop — a member picking it gets a failed
   generation.
3. Deploy, then run `stage-check.yml`.
4. Optionally bake it off against the others.

Never add a model on the strength of the pricing page alone. That page has
no activation column, and three models were briefly offered that no member
could have used.
