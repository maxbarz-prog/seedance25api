#!/usr/bin/env node
// Probes candidate dependency-status endpoints so the admin status page is
// wired to URLs that actually exist and actually answer, rather than to
// plausible-looking guesses. Run from a GitHub runner (this repo's sandbox
// cannot reach these hosts). Free: no generation, no writes.
//
// Two families:
//   vendor   public status pages (is the vendor having an incident?)
//   provider our authenticated API reachability, WITHOUT generating anything
//            (distinguishes "our key/config is wrong" from "they are down")

const TIMEOUT_MS = 8000;

async function probe(name, url, init = {}) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      name,
      url,
      status: res.status,
      ms: Date.now() - t0,
      contentType: res.headers.get("content-type")?.split(";")[0],
      // Statuspage-style payloads expose status.indicator / status.description.
      indicator: json?.status?.indicator ?? json?.page?.status ?? undefined,
      description: json?.status?.description ?? undefined,
      keys: json && typeof json === "object" ? Object.keys(json).slice(0, 8) : undefined,
      sample: json ? JSON.stringify(json).slice(0, 220) : text.slice(0, 160).replace(/\s+/g, " "),
    };
  } catch (e) {
    return { name, url, error: String(e?.name === "AbortError" ? "timeout" : e).slice(0, 160), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const ARK = process.env.BYTEPLUS_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3";
const FAL_MODEL = process.env.FAL_UPSCALER_MODEL || "fal-ai/bytedance-upscaler/upscale/video";
const FAL_APP = FAL_MODEL.split("/").slice(0, 2).join("/");

const vendors = [
  ["stripe", "https://status.stripe.com/api/v2/status.json"],
  ["clerk", "https://status.clerk.com/api/v2/status.json"],
  ["clerk-alt", "https://status.clerk.dev/api/v2/status.json"],
  ["fal", "https://status.fal.ai/api/v2/status.json"],
  ["fal-alt", "https://fal-ai.statuspage.io/api/v2/status.json"],
  ["byteplus", "https://status.byteplus.com/api/v2/status.json"],
  ["volcengine", "https://status.volcengine.com/api/v2/status.json"],
  ["aws-health", "https://health.aws.amazon.com/public/currentevents"],
  ["aws-legacy", "https://status.aws.amazon.com/data.json"],
  ["google-cloud", "https://status.cloud.google.com/incidents.json"],
  ["google-workspace", "https://www.google.com/appsstatus/dashboard/incidents.json"],
  ["cloudflare", "https://www.cloudflarestatus.com/api/v2/status.json"],
  ["github", "https://www.githubstatus.com/api/v2/status.json"],
  ["openai-unused", "https://status.openai.com/api/v2/status.json"],
];

async function main() {
  const out = { vendors: [], providers: [] };

  out.vendors = await Promise.all(vendors.map(([n, u]) => probe(n, u)));

  // --- authenticated reachability, no generation ---
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    out.providers.push(
      await probe("stripe:balance", "https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${stripeKey}` },
      })
    );
  }
  const clerkKey = process.env.CLERK_SECRET_KEY;
  if (clerkKey) {
    out.providers.push(
      await probe("clerk:users", "https://api.clerk.com/v1/users?limit=1", {
        headers: { Authorization: `Bearer ${clerkKey}` },
      })
    );
  }
  const ark = process.env.BYTEPLUS_API_KEY;
  if (ark) {
    const h = { Authorization: `Bearer ${ark}`, "Content-Type": "application/json" };
    // A task id that cannot exist: a 404 proves the key authenticates and the
    // service answers, while a 401/403 means our key is the problem. Neither
    // creates a task, so neither costs anything.
    out.providers.push(await probe("ark:bogus-task", `${ARK}/contents/generations/tasks/cgt-00000000000000-00000`, { headers: h }));
    // Does a task-list endpoint exist? Would be a cleaner liveness probe.
    out.providers.push(await probe("ark:list-tasks", `${ARK}/contents/generations/tasks?page_size=1`, { headers: h }));
    // Does a model catalogue exist? Would let us detect a deprecated model id.
    out.providers.push(await probe("ark:models", `${ARK}/models`, { headers: h }));
  }
  const fal = process.env.FAL_KEY;
  if (fal) {
    const h = { Authorization: `Key ${fal}` };
    out.providers.push(await probe("fal:bogus-request", `https://queue.fal.run/${FAL_APP}/requests/00000000-0000-0000-0000-000000000000/status`, { headers: h }));
    out.providers.push(await probe("fal:app-meta", `https://fal.run/${FAL_MODEL}`, { headers: h, method: "GET" }));
  }

  // The model catalogue: which video models this account may actually call.
  // Used to choose what to offer members rather than guessing from docs.
  if (ark) {
    const r = await probe("ark:catalogue", `${ARK}/models`, {
      headers: { Authorization: `Bearer ${ark}`, "Content-Type": "application/json" },
    });
    try {
      const res = await fetch(`${ARK}/models`, { headers: { Authorization: `Bearer ${ark}` } });
      const body = await res.json();
      const all = body?.data ?? [];
      out.catalogue = {
        total: all.length,
        byDomain: all.reduce((acc, m) => ((acc[m.domain || "?"] = (acc[m.domain || "?"] || 0) + 1), acc), {}),
        video: all
          .filter((m) => /video|seedance|dreamina/i.test(`${m.id} ${m.domain ?? ""}`))
          .map((m) => ({ id: m.id, domain: m.domain, created: m.created })),
      };
    } catch (e) {
      out.catalogue = { error: String(e).slice(0, 200), probe: r };
    }
  }

  console.log(JSON.stringify(out, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```json\n" + JSON.stringify(out, null, 2) + "\n```\n");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exitCode = 1;
});
