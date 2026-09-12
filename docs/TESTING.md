# Dev testing checklist

For a manual pass over **dev.remerged.ai** before production. Work top to
bottom: each section assumes the ones above it passed.

**Costs.** Everything up to §6 is free. §6 onwards spends real money at the
providers — the amount is stated per step, and the whole list comes to about
**$2.20**. Stripe is in test mode on dev, so card charges are not real; the
provider charges are.

Two ways to get credits without a card at all: the admin page can comp a
membership and grant credits (§3 note). Prefer that if you only want to
exercise generation.

---

## 1. Before touching the site — free

- [ ] **`stage-check.yml`** dispatched against `dev` → green. Confirms every
      model quotes on every route it claims, withdrawn models are refused,
      and the pricing page loads.
- [ ] **`model-activation.yml`** → the four sold models callable, the rest
      not. If a sold model has become uncallable, stop: members would get
      failed generations.
- [ ] **`/admin`** → System status all green. Look specifically at:
      - **Selling** — must read `open`, not `HALTED`
      - **Token estimate** — must read `5 ok`; red means our price no longer
        matches what the provider bills
      - **Database**, **Bucket access**, **Pipeline**

## 2. Signing up — free

- [ ] Sign up with an address you can read. Clerk handles this.
- [ ] You land signed in, and the header shows a balance of **$0.00** with
      an **Add credits** button beside it.
- [ ] Sign out and back in. The session survives.
- [ ] **Generate without a membership** → the dialog says a membership is
      required, with a Join button. Nothing is charged.

## 3. Membership — free (Stripe test mode)

- [ ] Join Monthly ($19.99). Card **4242 4242 4242 4242**, any future expiry,
      any CVC, any postcode.
- [ ] You return to the site with membership active.
- [ ] `/account` shows the plan and its renewal date.

> Alternative with no card: `/admin` → comp a membership to your address,
> then grant credits. Same end state, nothing through Stripe.

## 4. Credits — free (Stripe test mode)

- [ ] Top up $10 (the minimum). Same test card.
- [ ] **The header balance updates to $10.00 without a page reload.**
- [ ] `/account` shows the top-up in the ledger.
- [ ] `/admin` → the money desk shows the purchase.

## 5. Insufficient credits — free

- [ ] Set duration and model so the price exceeds your balance (30s on
      Seedance 2.5 at 4K is about $4.54).
- [ ] Generate → a dialog states the cost, your balance and the shortfall,
      with an **Add credits** button. **Nothing is charged.**

## 6. The first generation — about $0.26

Use **Seedance 2.0 Mini**, 5s, 4K. Cheapest real end-to-end test.

- [ ] The composer states the pipeline before you submit — model, render
      resolution, what happens next.
- [ ] The quoted price matches the pricing page for that combination.
- [ ] Submit. The balance drops by the quoted amount, immediately.
- [ ] The job page shows **Queued → Generating → Upscaling → Ready**.
      Expect roughly 2 minutes generating, then 3 minutes upscaling.
- [ ] The finished video plays, and is **3840×2160**.
- [ ] `/library` lists it.
- [ ] Download works.

## 7. The routes and the models — about $1.10

- [ ] **Switch output route** in the composer. The price changes and the
      description changes with it. 1080p should be cheaper than 4K; native
      1080p dearer than both.
- [ ] **Switch model.** The price changes. 2.0 Fast and 2.0 Mini must not
      offer native 1080p at all.
- [ ] Generate one at **1080p upscaled** (2.0 Mini, 5s, about $0.14) →
      1920×1080.
- [ ] Generate one at **native 1080p** (2.0, 5s, about $2.18) → 1920×1080 at
      24fps, with **no upscaling step** in the progress display.

> Skip the native one if $2.18 is more than the answer is worth — the
> bake-off already proved the path works.

## 8. Images in — free to try, refusals cost nothing

- [ ] Attach a **photograph of a person** as a first frame. The composer
      warns before you submit. If you submit anyway, it fails with a message
      explaining photographs of real people are refused — **and you are not
      charged**.
- [ ] Attach a **non-person image** (an object, a drawing). The aspect
      control disables itself and explains that the image sets the ratio.
- [ ] Generate from it (about $0.26 on 2.0 Mini) → the video starts on your
      image.

## 9. Extending — about $0.30

- [ ] Open a finished clip → **Extend**. The quote appears.
- [ ] Extend by 5s. The result is source + continuation joined, and the job
      page reports the full length.

## 10. Money safety — free

- [ ] `/admin` → **Halt generation**. Confirm.
- [ ] Try to generate → refused with "paused while we check a billing
      issue", **before any charge**.
- [ ] **Resume generation.** Generation works again.
- [ ] The money desk shows **nothing outstanding** — no charge without a
      matching spend anywhere in your session.

## 11. What the operator sees — free

- [ ] `/admin` → **Generation speed** now has rows from your real jobs:
      seconds of wait per second of video, and the share spent queued.
- [ ] Check the job's cost against `/admin` totals: charged should exceed
      what the provider billed, on every job.
- [ ] Email: you should have received a "your video is ready" message.

---

## Stop and report if

- Any charge happens without a video, or a video without a charge.
- The header balance disagrees with `/account`.
- A price on the pricing page differs from the composer's quote for the same
  combination.
- The status page shows **Token estimate** red — our price has drifted from
  what the provider bills.
- **Selling** shows HALTED when you did not halt it — the margin guard found
  a render sold below cost, and the detail line says which.

## Not covered here

- **Production.** Nothing in this list touches prod. Production deploys only
  from a `prod-YYYY-MM-DD` tag, and that path has never been exercised.
- **Load.** One member at a time. The provider allows 3 concurrent tasks;
  behaviour above that is deferral, not failure, but it is untested with
  real traffic.
- **Real card payments.** Dev uses Stripe test mode throughout.
