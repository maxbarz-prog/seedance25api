#!/usr/bin/env node
// End-to-end check of a deployed stage, run by .github/workflows/dev-e2e.yml:
// sign up (Clerk sign-in token consumed in a real browser), join with a test
// card on Stripe Checkout, top up with a test card, generate, extend, and
// download the result. Everything after sign-in goes through the same API
// routes the UI uses, from the browser's cookie context, so the deployed
// middleware, webhook and pipeline are all exercised for real.
//
// Env: BASE_URL, CLERK_SECRET_KEY, E2E_EMAIL (optional), DURATION_S (4),
// EXTEND_S (4). Playwright must be resolvable from this file's directory.

import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const BASE = (process.env.BASE_URL || "https://dev.remerged.click").replace(/\/$/, "");
const CLERK = process.env.CLERK_SECRET_KEY;
const EMAIL = process.env.E2E_EMAIL || `e2e+${Date.now()}@remerged.click`;
const DURATION_S = Number(process.env.DURATION_S || 4);
const EXTEND_S = Number(process.env.EXTEND_S || 4);
const OUT = process.env.E2E_OUT || "e2e-out";
mkdirSync(OUT, { recursive: true });

const summary = { base: BASE, email: EMAIL, steps: {} };
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function step(name, data) {
  summary.steps[name] = { ...(summary.steps[name] || {}), ...data };
  log(name, JSON.stringify(data));
}

async function clerk(path, init = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${CLERK}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`clerk ${path}: ${res.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// Fill a Stripe Checkout page with the standard test card and submit.
async function payOnCheckout(page, label) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.screenshot({ path: `${OUT}/${label}-checkout.png`, fullPage: true });
  const fill = async (sel, val) => {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      if (await el.isVisible().catch(() => false)) await el.fill(val);
    }
  };
  await fill("#email", EMAIL);
  await fill("#cardNumber", "4242424242424242");
  await fill("#cardExpiry", "12/34");
  await fill("#cardCvc", "123");
  await fill("#billingName", "E2E Test");
  const country = page.locator("#billingCountry");
  if (await country.count()) await country.selectOption("US").catch(() => {});
  await fill("#billingPostalCode", "94107");
  // Decline Link enrolment if offered, so the flow stays a plain card payment.
  const linkOptOut = page.locator('input[name="enableStripePass"]');
  if (await linkOptOut.count()) await linkOptOut.uncheck().catch(() => {});
  await page.screenshot({ path: `${OUT}/${label}-filled.png`, fullPage: true });
  const submit = page.locator('button[type="submit"], .SubmitButton').first();
  await submit.click();
  await page.waitForURL((u) => u.origin === BASE, { timeout: 120_000 });
  await page.screenshot({ path: `${OUT}/${label}-return.png`, fullPage: true });
  return page.url();
}

async function api(ctx, method, path, body) {
  const res = await ctx.request.fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json: j };
}

async function waitFor(desc, fn, { timeoutMs, everyMs = 5_000 }) {
  const s = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - s > timeoutMs) throw new Error(`timed out waiting for ${desc}`);
    await sleep(everyMs);
  }
}

async function pollJob(ctx, id, label) {
  const s = Date.now();
  let last = "";
  const job = await waitFor(`${label} job ${id}`, async () => {
    const r = await api(ctx, "GET", `/api/jobs/${id}`);
    if (!r.ok) throw new Error(`${label}: poll ${r.status} ${JSON.stringify(r.json)}`);
    const j = r.json.job;
    if (j.status !== last) {
      last = j.status;
      log(label, `status=${j.status} at ${((Date.now() - s) / 1000).toFixed(0)}s`);
    }
    return j.status === "ready" || j.status === "failed" ? j : null;
  }, { timeoutMs: 30 * 60_000, everyMs: 5_000 });
  job.elapsedS = Math.round((Date.now() - s) / 1000);
  return job;
}

async function probe(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${name}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const p = `${OUT}/${name}.mp4`;
  writeFileSync(p, buf);
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", p], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}");
  const st = j.streams?.[0] || {};
  return { bytes: buf.length, width: st.width, height: st.height, fps: st.r_frame_rate,
           durationS: j.format?.duration ? +Number(j.format.duration).toFixed(2) : undefined,
           contentType: res.headers.get("content-type") };
}

async function main() {
  if (!CLERK) throw new Error("CLERK_SECRET_KEY not set");

  // 1. Sign up: a Clerk user plus a one-time sign-in token.
  const existing = await clerk(`/users?email_address=${encodeURIComponent(EMAIL)}&limit=1`);
  const user = existing[0] || (await clerk("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [EMAIL], skip_password_requirement: true, skip_password_checks: true }),
  }));
  const token = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id, expires_in_seconds: 900 }),
  });
  step("signup", { clerkUserId: user.id, created: !existing[0] });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // Diagnostics that survive without the screenshot artifact: console errors
  // and failed requests, plus where the page ended up on failure.
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url().slice(0, 200)} -> ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.request().method()} ${r.url().slice(0, 200)} -> HTTP ${r.status()}`); });
  try {
    // 2. Sign in through the real <SignIn/> page consuming the ticket.
    await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(token.token)}`);
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60_000 });
    await page.screenshot({ path: `${OUT}/signed-in.png`, fullPage: true });
    const me = await waitFor("session", async () => {
      const r = await api(ctx, "GET", "/api/me");
      return r.json.user ? r.json : null;
    }, { timeoutMs: 30_000, everyMs: 2_000 });
    step("signin", { auth: me.auth, email: me.user.email, membership: me.user.membership, balance: me.user.balanceCredits });

    // 3. Membership via Stripe Checkout with a test card; the webhook activates it.
    if (!me.user.membershipActive) {
      const sub = await api(ctx, "POST", "/api/billing/subscribe", { plan: "monthly" });
      if (!sub.ok) throw new Error(`subscribe: ${sub.status} ${JSON.stringify(sub.json)}`);
      await page.goto(sub.json.url);
      const back = await payOnCheckout(page, "join");
      const after = await waitFor("membership via webhook", async () => {
        const r = await api(ctx, "GET", "/api/me");
        return r.json.user?.membershipActive ? r.json.user : null;
      }, { timeoutMs: 120_000, everyMs: 3_000 });
      step("join", { returnedTo: back, membership: after.membership, renewsAt: after.membershipRenewsAt });
    } else step("join", { skipped: "already active" });

    // 4. Top-up $10 via Stripe Checkout; the webhook credits it.
    const before = (await api(ctx, "GET", "/api/me")).json.user.balanceCredits;
    const top = await api(ctx, "POST", "/api/billing/topup", { usd: 10 });
    if (!top.ok) throw new Error(`topup: ${top.status} ${JSON.stringify(top.json)}`);
    await page.goto(top.json.url);
    const back2 = await payOnCheckout(page, "topup");
    const bal = await waitFor("top-up via webhook", async () => {
      const r = await api(ctx, "GET", "/api/me");
      return r.json.user.balanceCredits > before ? r.json.user.balanceCredits : null;
    }, { timeoutMs: 120_000, everyMs: 3_000 });
    step("topup", { returnedTo: back2, balanceBefore: before, balanceAfter: bal });

    // 5. Generate (480p -> upscaled 1080p, the default mode).
    const gen = await api(ctx, "POST", "/api/jobs", {
      prompt: "A red vintage bicycle leaning against a sunlit stone wall, leaves drifting past, gentle camera push-in",
      model: "seedance-2.5", durationS: DURATION_S, aspect: "16:9", audio: false,
      mode: "upscaled-1080p", upscaleFactor: 2, seed: 12345,
    });
    if (gen.status !== 201) throw new Error(`generate: ${gen.status} ${JSON.stringify(gen.json)}`);
    const job = await pollJob(ctx, gen.json.id, "generate");
    step("generate", { id: job.id, status: job.status, quoteCredits: job.quote_credits, elapsedS: job.elapsedS, error: job.error });
    if (job.status !== "ready") throw new Error(`generation failed: ${job.error}`);
    step("generate", { media: await probe(job.video_url, "generated") });

    // 6. Extend the finished clip.
    const ext = await api(ctx, "POST", `/api/jobs/${job.id}/extend`, { prompt: "", durationS: EXTEND_S });
    if (ext.status !== 201 && ext.status !== 200) throw new Error(`extend: ${ext.status} ${JSON.stringify(ext.json)}`);
    const ejob = await pollJob(ctx, ext.json.id, "extend");
    step("extend", { id: ejob.id, status: ejob.status, quoteCredits: ejob.quote_credits, elapsedS: ejob.elapsedS, error: ejob.error });
    if (ejob.status !== "ready") throw new Error(`extension failed: ${ejob.error}`);

    // 7. Download: the presented URL must serve the file.
    step("download", { media: await probe(ejob.video_url, "extended") });

    // 8. Job page renders the player.
    await page.goto(`${BASE}/jobs/${ejob.id}`);
    await page.locator("video").first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: `${OUT}/job-page.png`, fullPage: true });
    const final = (await api(ctx, "GET", "/api/me")).json.user;
    step("final", { balanceCredits: final.balanceCredits, ledger: final.ledger.slice(0, 6).map((l) => `${l.kind} ${l.delta_credits} ${l.memo ?? ""}`) });
    summary.ok = true;
  } catch (e) {
    summary.ok = false;
    summary.error = String(e);
    await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
    summary.failurePage = {
      url: page.url(),
      title: await page.title().catch(() => null),
      bodyText: await page.evaluate(() => document.body?.innerText?.slice(0, 1500)).catch(() => null),
    };
    log("FAILED", summary.error);
  } finally {
    summary.consoleErrors = consoleErrors.slice(0, 30);
    summary.failedRequests = failedRequests.slice(0, 30);
    await browser.close();
  }
  console.log("\n===== SUMMARY =====\n" + JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```json\n" + JSON.stringify(summary, null, 2) + "\n```\n");
  }
  process.exitCode = summary.ok ? 0 : 1;
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exitCode = 1;
});
