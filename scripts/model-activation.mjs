#!/usr/bin/env node
// Which video models can this account actually call?
//
// Being on the provider's price list does not mean the account may use it:
// an unactivated model answers 404 ModelNotOpen. That is invisible until a
// member picks the model and their generation fails, so it is worth knowing
// before we offer one.
//
// FREE. Nothing is generated. Each model is probed with a deliberately
// invalid request, and the error tells us what we need:
//
//   404 ModelNotOpen   -> not activated on this account
//   400 InvalidParameter (or similar) -> activated; the request was refused
//                                        on its parameters, so no task was
//                                        created and nothing was billed
//
// The invalid parameter is a duration no model accepts. If a model ever did
// accept it, the submit would create a task — so the guard is deliberately
// far outside any documented range.

const ARK = process.env.BYTEPLUS_API_BASE || "https://ark.ap-southeast.bytepluses.com/api/v3";

const MODELS = [
  ["seedance-2.5", "dreamina-seedance-2-5-260628"],
  ["seedance-2.0", "dreamina-seedance-2-0-260128"],
  ["seedance-2.0-fast", "dreamina-seedance-2-0-fast-260128"],
  ["seedance-2.0-mini", "dreamina-seedance-2-0-mini-260615"],
  ["seedance-1.5-pro", "seedance-1-5-pro-251215"],
  ["seedance-1.0-pro", "seedance-1-0-pro-250528"],
  ["seedance-1.0-pro-fast", "seedance-1-0-pro-fast-251015"],
  ["seedance-1.0-lite-t2v", "seedance-1-0-lite-t2v-250428"],
  ["seedance-1.0-lite-i2v", "seedance-1-0-lite-i2v-250428"],
];

// No model documents a duration anywhere near this, so the request is
// rejected on its parameters before any work is scheduled.
const IMPOSSIBLE_DURATION = 9999;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}
const headers = () => ({
  Authorization: `Bearer ${need("BYTEPLUS_API_KEY")}`,
  "Content-Type": "application/json",
});

async function req(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, ok: res.ok, json, text };
}

async function probe(id, upstream) {
  const r = await req(`${ARK}/contents/generations/tasks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: upstream,
      content: [{ type: "text", text: "activation probe — not intended to run" }],
      resolution: "480p",
      ratio: "16:9",
      duration: IMPOSSIBLE_DURATION,
    }),
  });
  const code = r.json?.error?.code || "";
  const message = (r.json?.error?.message || r.text || "").slice(0, 160);

  // Should never happen: the duration is outside every documented range. If
  // it does, cancel immediately and say so loudly — that is real money.
  if (r.ok && r.json?.id) {
    await req(`${ARK}/contents/generations/tasks/${r.json.id}`, {
      method: "DELETE", headers: headers(),
    }).catch(() => {});
    return { id, upstream, activated: true, note: `PROBE CREATED A TASK (${r.json.id}) — cancelled`, spent: true };
  }
  if (r.status === 404 || /ModelNotOpen/i.test(code)) {
    return { id, upstream, activated: false, note: "not activated on this account" };
  }
  return { id, upstream, activated: true, note: `${r.status} ${code}: ${message}` };
}

async function main() {
  const catalogue = await req(`${ARK}/models`, { headers: headers() });
  const listed = (catalogue.json?.data ?? []).map((m) => m.id);

  const rows = [];
  for (const [id, upstream] of MODELS) {
    rows.push({ ...(await probe(id, upstream)), inCatalogue: listed.includes(upstream) });
  }

  const on = rows.filter((r) => r.activated).map((r) => r.id);
  const off = rows.filter((r) => !r.activated).map((r) => r.id);

  const md = [
    "| Model | Upstream id | Callable | Detail |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | \`${r.upstream}\` | ${r.activated ? "yes" : "**NO**"} | ${r.note} |`),
    "",
    `Callable: ${on.length ? on.join(", ") : "none"}`,
    `Not activated: ${off.length ? off.join(", ") : "none"}`,
    "",
    "Not activated means a member choosing it gets a failed generation. Activate in the Ark Console (Model activation), or drop it from MODEL_IDS in web/lib/config.ts.",
  ].join("\n");

  console.log("\n" + md + "\n");
  console.log(JSON.stringify({ listed, rows }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
  if (rows.some((r) => r.spent)) process.exitCode = 1;
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exitCode = 1;
});
