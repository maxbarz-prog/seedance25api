#!/usr/bin/env node
// The audit diary is a record, not state. The whole design rests on one rule:
// nothing the product does may read it. An account deleted and remade with the
// same address has to behave exactly as it did the first time, and the moment
// some sign-up check consults the diary "just to see", that stops being true
// and the record starts changing outcomes.
//
// A comment cannot enforce that, so this does. It fails the build if anything
// outside the allowed files reads the diary or hashes an address to look one
// up. Run by `npm run lint` in web/.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..", "web");

// The diary itself, its store, and the one admin route that shows a timeline.
const ALLOWED = new Set(
  [
    "lib/audit.ts",
    "lib/db.ts",
    "lib/data/types.ts",
    "lib/data/dynamo.ts",
    "lib/data/sqlite.ts",
    "app/api/admin/audit/route.ts",
  ].map((p) => p.split("/").join(sep))
);

// Reading it, or computing the hash that would let you.
const READERS = /\b(auditTimeline|auditMonth|auditForMonth|subjectOf)\b/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

const offenders = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (ALLOWED.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    if (READERS.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

if (offenders.length) {
  console.error("The audit diary may only be read by the admin timeline.");
  console.error("These read it, or hash an address to look one up:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    "\nIf the product needs to know something, it belongs in a live table.\n" +
      "See the rules at the top of web/lib/audit.ts."
  );
  process.exit(1);
}

console.log("audit diary: no readers outside the admin timeline.");
