import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { findMoneyIssues, MoneyIssue } from "./reconcile";
import { modelTimings } from "./timing";
import {
  AddLedgerOpts,
  AdminData,
  AuditEntry,
  AdminJobRow,
  AdminUserRow,
  BillingInterval,
  DataStore,
  Event,
  Job,
  JobStatus,
  LedgerEntry,
  MemberCount,
  Membership,
  OnboardingFields,
  User,
} from "./types";

// AWS store. Tables (created by sst.config.ts):
//   users:  pk id;               GSI "email"  (hashKey email),
//                                GSI "stripe" (hashKey stripe_customer_id),
//                                GSI "reset"  (hashKey reset_token_hash)
//   ledger: pk pk, sk sk         (pk = user id, sk = createdAt#id;
//                                 idempotency guards live at pk = ext#<id>)
//   jobs:   pk id;               GSI "user"    (hashKey user_id, rangeKey created_at),
//                                GSI "pending" (hashKey pending, rangeKey created_at)
//   events: pk day, sk sk        (day = UTC date, sk = createdAt#id; TTL on `expires`)
// Admin aggregation scans tables — fine at MVP scale, revisit past ~10k rows.
//
// The "pending" index is sparse: PENDING_KEY is written while a job is
// unfinished and removed the moment it reaches ready or failed, so the index
// contains only the live work queue. The minute cron reads it with a Query;
// it used to Scan the whole jobs table, which grew with every job ever made.
// Every status transition goes through claimJob or updateJob, so keeping the
// attribute correct in those two places keeps the whole invariant.

// Single partition value for the sparse work-queue index. One partition is
// right here: the index only ever holds unfinished jobs, and the cron wants
// all of them in creation order.
const PENDING_KEY = "1";

function isLive(status: JobStatus): boolean {
  return status !== "ready" && status !== "failed";
}

const USERS = process.env.TABLE_USERS!;
const LEDGER = process.env.TABLE_LEDGER!;
// Reserved ledger partition for global state; user ids are uuids, so no
// real user can occupy it.
const SYSTEM_PK = "system";
const JOBS = process.env.TABLE_JOBS!;
const EVENTS = process.env.TABLE_EVENTS!;
const AUDIT = process.env.TABLE_AUDIT!;
// Growth events are kept for half a year. The report reads 90 days at most;
// the rest is headroom for a question nobody has asked yet, not an archive.
const EVENT_TTL_S = 180 * 86_400;

export class DynamoStore implements DataStore {
  private doc: DynamoDBDocumentClient;

  constructor() {
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    const u: User = {
      id: randomUUID(),
      email: email.toLowerCase().trim(),
      password_hash: passwordHash,
      membership: "free",
      membership_renews_at: null,
      stripe_customer_id: null,
      balance_credits: 0,
      granted_credits: 0,
      billing_interval: null,
      deactivated_at: null,
      cancel_at_period_end: false,
      created_at: Date.now(),
    };
    // `stripe_customer_id` is the hash key of the "stripe" GSI, and DynamoDB
    // rejects an item whose index key attribute is NULL ("Type mismatch for
    // Index Key ... Expected: S Actual: NULL"). An absent attribute is fine —
    // the item simply isn't indexed — so it is omitted until a customer id
    // exists. Same reasoning as the REMOVE in setStripeIds.
    const { stripe_customer_id: _unindexed, ...item } = u;
    void _unindexed;
    await this.doc.send(new PutCommand({ TableName: USERS, Item: item }));
    return u;
  }

  async userByEmail(email: string): Promise<User | undefined> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: USERS,
        IndexName: "email",
        KeyConditionExpression: "email = :e",
        ExpressionAttributeValues: { ":e": email.toLowerCase().trim() },
        Limit: 1,
      })
    );
    return r.Items?.[0] as User | undefined;
  }

  async userById(id: string): Promise<User | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: USERS, Key: { id } }));
    return r.Item as User | undefined;
  }

  async setMembership(
    userId: string,
    membership: Membership,
    renewsAt: number | null,
    interval?: BillingInterval | null
  ) {
    await this.doc.send(
      new UpdateCommand({
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression:
          "SET membership = :m, membership_renews_at = :r, billing_interval = :i",
        ExpressionAttributeValues: {
          ":m": membership,
          ":r": renewsAt,
          ":i": interval ?? null,
        },
      })
    );
  }

  async setStripeIds(userId: string, customerId: string | null, subscriptionId: string | null) {
    // Clearing an id must REMOVE the attribute rather than set it to NULL:
    // stripe_customer_id backs the "stripe" GSI and DynamoDB rejects a NULL
    // index key. Kept symmetric for the subscription id.
    const sets: string[] = [];
    const removes: string[] = [];
    const values: Record<string, string> = {};
    for (const [attr, slot, value] of [
      ["stripe_customer_id", ":c", customerId],
      ["stripe_subscription_id", ":s", subscriptionId],
    ] as const) {
      if (value === null) {
        removes.push(attr);
      } else {
        sets.push(`${attr} = ${slot}`);
        values[slot] = value;
      }
    }
    const expression = [
      sets.length ? `SET ${sets.join(", ")}` : "",
      removes.length ? `REMOVE ${removes.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    await this.doc.send(
      new UpdateCommand({
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression: expression,
        ...(sets.length ? { ExpressionAttributeValues: values } : {}),
      })
    );
  }

  async userByStripeCustomer(customerId: string): Promise<User | undefined> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: USERS,
        IndexName: "stripe",
        KeyConditionExpression: "stripe_customer_id = :c",
        ExpressionAttributeValues: { ":c": customerId },
        Limit: 1,
      })
    );
    return r.Items?.[0] as User | undefined;
  }

  async setResetToken(userId: string, tokenHash: string | null, expiresAt: number | null) {
    await this.doc.send(
      new UpdateCommand({
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression: tokenHash
          ? "SET reset_token_hash = :h, reset_expires_at = :e"
          : "REMOVE reset_token_hash, reset_expires_at",
        ExpressionAttributeValues: tokenHash ? { ":h": tokenHash, ":e": expiresAt } : undefined,
      })
    );
  }

  async userByResetToken(tokenHash: string): Promise<User | undefined> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: USERS,
        IndexName: "reset",
        KeyConditionExpression: "reset_token_hash = :h",
        ExpressionAttributeValues: { ":h": tokenHash },
        Limit: 1,
      })
    );
    return r.Items?.[0] as User | undefined;
  }

  async setPassword(userId: string, passwordHash: string) {
    await this.doc.send(
      new UpdateCommand({
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression: "SET password_hash = :p",
        ExpressionAttributeValues: { ":p": passwordHash },
      })
    );
  }

  private async queryLedger(userId: string, limit?: number, forward = false) {
    const items: LedgerEntry[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: LEDGER,
          KeyConditionExpression: "pk = :u",
          ExpressionAttributeValues: { ":u": userId },
          ScanIndexForward: forward,
          Limit: limit,
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...((r.Items ?? []) as LedgerEntry[]));
      lastKey = r.LastEvaluatedKey;
      if (limit !== undefined && items.length >= limit) break;
    } while (lastKey);
    return limit !== undefined ? items.slice(0, limit) : items;
  }

  // Reads the running total off the user row. Summing the whole ledger on
  // every page load meant a member's account page got slower the more they
  // used the product. The fallback covers rows written before the running
  // balance existed and disappears the first time they transact.
  async setDeactivated(userId: string, at: number | null) {
    await this.doc.send(
      new UpdateCommand({
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression: "SET deactivated_at = :a",
        ExpressionAttributeValues: { ":a": at },
      })
    );
  }

  async setCancelAtPeriodEnd(userId: string, value: boolean) {
    await this.doc.send(
      new UpdateCommand({
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression: "SET cancel_at_period_end = :v",
        ExpressionAttributeValues: { ":v": value },
      })
    );
  }

  async deleteUser(userId: string) {
    // Jobs and ledger entries first, the user row last. If this is
    // interrupted the account still exists and can be deleted again; the
    // reverse would strand rows nothing points at.
    const jobs = await this.jobsFor(userId, 10000);
    for (const j of jobs) {
      await this.doc.send(new DeleteCommand({ TableName: JOBS, Key: { id: j.id } }));
    }
    const entries = (await this.queryLedger(userId)) as (LedgerEntry & {
      pk?: string;
      sk?: string;
    })[];
    for (const e of entries) {
      if (!e.pk || !e.sk) continue;
      await this.doc.send(
        new DeleteCommand({ TableName: LEDGER, Key: { pk: e.pk, sk: e.sk } })
      );
    }
    await this.doc.send(new DeleteCommand({ TableName: USERS, Key: { id: userId } }));
  }

  async balance(userId: string): Promise<number> {
    const u = await this.userById(userId);
    if (u && typeof u.balance_credits === "number") return u.balance_credits;
    return this.sumLedger(userId);
  }

  private async sumLedger(userId: string): Promise<number> {
    const items = await this.queryLedger(userId);
    return items.reduce((acc, e) => acc + (e.delta_credits ?? 0), 0);
  }

  // A user whose row predates the running balance has no attribute to add to,
  // and an ADD would silently start them from zero. Seed it from the ledger
  // first; the conditional write makes a concurrent seed harmless, and every
  // writer does this before adding, so no delta can be applied to a missing
  // attribute.
  private async ensureBalance(userId: string): Promise<void> {
    const u = await this.userById(userId);
    if (!u || typeof u.balance_credits === "number") return;
    const sum = await this.sumLedger(userId);
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: USERS,
          Key: { id: userId },
          UpdateExpression: "SET balance_credits = :b",
          ConditionExpression: "attribute_not_exists(balance_credits)",
          ExpressionAttributeValues: { ":b": sum },
        })
      );
    } catch (err) {
      if (!String(err).includes("ConditionalCheckFailed")) throw err;
    }
  }

  async addLedger(
    userId: string,
    deltaCredits: number,
    kind: string,
    opts: AddLedgerOpts = {}
  ): Promise<LedgerEntry | null> {
    const e: LedgerEntry = {
      id: randomUUID(),
      user_id: userId,
      delta_credits: Math.round(deltaCredits),
      kind,
      job_id: opts.jobId ?? null,
      memo: opts.memo ?? null,
      external_id: opts.externalId ?? null,
      granted_delta: opts.grantedDelta ? Math.round(opts.grantedDelta) : null,
      created_at: Date.now(),
    };
    const item = { ...e, pk: userId, sk: `${String(e.created_at).padStart(15, "0")}#${e.id}` };
    await this.ensureBalance(userId);
    // The ledger row and the running balance move together, so a crash cannot
    // leave the cached total disagreeing with the entries behind it.
    // A grant or an expiry also moves the granted half of the balance. ADD
    // treats a missing attribute as zero, so rows written before tiers need
    // no backfill.
    const granted = e.granted_delta ?? 0;
    // A spend that must not overdraw carries its own condition, evaluated by
    // DynamoDB against the balance at the moment of the write — not the one
    // the caller read a few milliseconds earlier. Two concurrent charges
    // that both fit individually but not together: the second one fails.
    const guard = opts.requireFunds && e.delta_credits < 0;
    const applyBalance = {
      Update: {
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression: granted
          ? "ADD balance_credits :d, granted_credits :g"
          : "ADD balance_credits :d",
        ...(guard ? { ConditionExpression: "balance_credits >= :need" } : {}),
        ExpressionAttributeValues: {
          ":d": e.delta_credits,
          ...(granted ? { ":g": granted } : {}),
          ...(guard ? { ":need": -e.delta_credits } : {}),
        },
      },
    };
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            // Idempotency guard for externally-triggered credits (a Stripe
            // checkout session): a replayed webhook cancels the whole
            // transaction, so neither the entry nor the balance is applied.
            ...(opts.externalId
              ? [
                  {
                    Put: {
                      TableName: LEDGER,
                      Item: { pk: `ext#${opts.externalId}`, sk: "guard" },
                      ConditionExpression: "attribute_not_exists(pk)",
                    },
                  },
                ]
              : []),
            { Put: { TableName: LEDGER, Item: item } },
            applyBalance,
          ],
        })
      );
    } catch (err: unknown) {
      // Either guard tripping cancels the whole transaction: a replayed
      // external id, or a spend the balance does not cover.
      if ((opts.externalId || guard) && String(err).includes("TransactionCanceled")) return null;
      throw err;
    }
    return e;
  }

  async ledgerFor(userId: string, limit = 50): Promise<LedgerEntry[]> {
    return this.queryLedger(userId, limit);
  }

  async createJob(j: Omit<Job, "created_at" | "updated_at">): Promise<Job> {
    const now = Date.now();
    const job: Job = { ...j, created_at: now, updated_at: now };
    const item = isLive(job.status) ? { ...job, pending: PENDING_KEY } : job;
    await this.doc.send(new PutCommand({ TableName: JOBS, Item: item }));
    return job;
  }

  async jobById(id: string): Promise<Job | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: JOBS, Key: { id } }));
    return r.Item as Job | undefined;
  }

  async jobsFor(userId: string, limit = 100): Promise<Job[]> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: JOBS,
        IndexName: "user",
        KeyConditionExpression: "user_id = :u",
        ExpressionAttributeValues: { ":u": userId },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
    return (r.Items ?? []) as Job[];
  }

  async updateJob(id: string, fields: Partial<Job>) {
    const keys = Object.keys(fields).filter((k) => k !== "id");
    if (keys.length === 0) return;
    const names: Record<string, string> = { "#updated_at": "updated_at" };
    const values: Record<string, unknown> = { ":updated_at": Date.now() };
    const sets: string[] = ["#updated_at = :updated_at"];
    for (const k of keys) {
      names[`#${k}`] = k;
      values[`:${k}`] = (fields as Record<string, unknown>)[k];
      sets.push(`#${k} = :${k}`);
    }
    // Keep the sparse work-queue key in step whenever a status is written
    // here (fail() is the path that matters).
    let remove = "";
    if (fields.status !== undefined) {
      names["#p"] = "pending";
      if (isLive(fields.status)) {
        values[":p"] = PENDING_KEY;
        sets.push("#p = :p");
      } else {
        remove = " REMOVE #p";
      }
    }
    await this.doc.send(
      new UpdateCommand({
        TableName: JOBS,
        Key: { id },
        UpdateExpression: `SET ${sets.join(", ")}${remove}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  }

  async claimJob(id: string, from: JobStatus, to: JobStatus): Promise<boolean> {
    const live = isLive(to);
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: JOBS,
          Key: { id },
          UpdateExpression: live
            ? "SET #s = :to, updated_at = :now, #p = :p"
            : "SET #s = :to, updated_at = :now REMOVE #p",
          ConditionExpression: "#s = :from",
          ExpressionAttributeNames: { "#s": "status", "#p": "pending" },
          ExpressionAttributeValues: live
            ? { ":to": to, ":from": from, ":now": Date.now(), ":p": PENDING_KEY }
            : { ":to": to, ":from": from, ":now": Date.now() },
        })
      );
      return true;
    } catch (err: unknown) {
      if (String(err).includes("ConditionalCheckFailed")) return false;
      throw err;
    }
  }

  // Oldest first, straight off the sparse index: cost is proportional to the
  // number of unfinished jobs, not to how many have ever been created.
  async jobsInFlight(limit = 200): Promise<Job[]> {
    const items: Job[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: JOBS,
          IndexName: "pending",
          KeyConditionExpression: "#p = :p",
          ExpressionAttributeNames: { "#p": "pending" },
          ExpressionAttributeValues: { ":p": PENDING_KEY },
          ScanIndexForward: true,
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...((r.Items ?? []) as Job[]));
      lastKey = r.LastEvaluatedKey;
    } while (lastKey && items.length < limit);
    return items.slice(0, limit);
  }

  async deleteJob(id: string) {
    await this.doc.send(new DeleteCommand({ TableName: JOBS, Key: { id } }));
  }

  async storageUsedBytes(userId: string): Promise<number> {
    const jobs = await this.jobsFor(userId, 1000);
    return jobs
      .filter((j) => j.status === "ready")
      .reduce((acc, j) => acc + (j.size_bytes ?? 0), 0);
  }

  private async scanAll<T>(table: string, limit: number): Promise<T[]> {
    const items: T[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new ScanCommand({ TableName: table, ExclusiveStartKey: lastKey })
      );
      items.push(...((r.Items ?? []) as T[]));
      lastKey = r.LastEvaluatedKey;
    } while (lastKey && items.length < limit);
    return items.slice(0, limit);
  }

  // Global operational state lives in the ledger table under a reserved
  // partition, which no user id can collide with (user ids are uuids).
  async getSystem(key: string): Promise<string | undefined> {
    const r = await this.doc.send(
      new GetCommand({ TableName: LEDGER, Key: { pk: SYSTEM_PK, sk: key } })
    );
    return (r.Item as { v?: string } | undefined)?.v;
  }

  async setSystem(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.doc.send(
        new DeleteCommand({ TableName: LEDGER, Key: { pk: SYSTEM_PK, sk: key } })
      );
      return;
    }
    await this.doc.send(
      new PutCommand({ TableName: LEDGER, Item: { pk: SYSTEM_PK, sk: key, v: value } })
    );
  }

  async setSystemIfAbsent(key: string, value: string): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: LEDGER,
          Item: { pk: SYSTEM_PK, sk: key, v: value },
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
      return true;
    } catch (err) {
      if (String(err).includes("ConditionalCheckFailed")) return false;
      throw err;
    }
  }

  async addSystemCounter(key: string, delta: number): Promise<number> {
    const r = await this.doc.send(
      new UpdateCommand({
        TableName: LEDGER,
        Key: { pk: SYSTEM_PK, sk: key },
        UpdateExpression: "ADD n :d",
        ExpressionAttributeValues: { ":d": delta },
        ReturnValues: "UPDATED_NEW",
      })
    );
    return Number((r.Attributes as { n?: number } | undefined)?.n ?? 0);
  }

  async listSystem(prefix: string): Promise<{ key: string; value: string }[]> {
    const out: { key: string; value: string }[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: LEDGER,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": SYSTEM_PK, ":p": prefix },
          ExclusiveStartKey: start,
        })
      );
      for (const item of (r.Items ?? []) as { sk: string; v?: string }[]) {
        if (item.v !== undefined) out.push({ key: item.sk, value: item.v });
      }
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }

  async setOnboarding(userId: string, fields: OnboardingFields): Promise<void> {
    const keys = Object.keys(fields) as (keyof OnboardingFields)[];
    if (!keys.length) return;
    await this.doc.send(
      new UpdateCommand({
        TableName: USERS,
        Key: { id: userId },
        UpdateExpression: "SET " + keys.map((k) => `#${k} = :${k}`).join(", "),
        ExpressionAttributeNames: Object.fromEntries(keys.map((k) => [`#${k}`, k])),
        ExpressionAttributeValues: Object.fromEntries(keys.map((k) => [`:${k}`, fields[k] ?? null])),
      })
    );
  }

  async addEvents(events: Event[]): Promise<void> {
    // BatchWrite takes 25 at a time and may hand some back unprocessed under
    // load; those are retried once and then dropped. An event is a tally
    // mark, not money — losing one under pressure beats failing the request
    // that carried it.
    const items = events.map((e) => ({
      ...e,
      sk: `${String(e.created_at).padStart(15, "0")}#${e.id}`,
      expires: Math.floor(e.created_at / 1000) + EVENT_TTL_S,
    }));
    for (let i = 0; i < items.length; i += 25) {
      let batch = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
      for (let attempt = 0; attempt < 2 && batch.length; attempt++) {
        const r = await this.doc.send(
          new BatchWriteCommand({ RequestItems: { [EVENTS]: batch } })
        );
        const left = r.UnprocessedItems?.[EVENTS] ?? [];
        batch = left as typeof batch;
      }
      if (batch.length) console.warn(`events: ${batch.length} dropped after retry`);
    }
  }

  // The audit diary. Written one line at a time rather than in batches: these
  // are rare, and unlike a growth event, losing one is not acceptable — a
  // dropped line is a hole in a record somebody will later rely on. So this
  // one throws on failure and lets lib/audit.ts decide what to do about it.
  async addAudit(entries: AuditEntry[]): Promise<void> {
    for (const e of entries) {
      await this.doc.send(
        new PutCommand({
          TableName: AUDIT,
          // `expires` rides on the entry: retention is the diary's policy
          // (lib/audit.ts), not the store's, and it differs by kind.
          Item: { ...e, sk: `${String(e.at).padStart(15, "0")}#${e.id}` },
        })
      );
    }
  }

  async auditForMonth(bucket: string, limit = 5000): Promise<AuditEntry[]> {
    const out: AuditEntry[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: AUDIT,
          KeyConditionExpression: "#b = :b",
          ExpressionAttributeNames: { "#b": "bucket" },
          ExpressionAttributeValues: { ":b": bucket },
          ExclusiveStartKey,
          Limit: Math.min(1000, limit - out.length),
        })
      );
      for (const it of r.Items ?? []) {
        // `sk` is the store's own ordering key and means nothing outside it.
        // `expires` stays: a reader is entitled to see when a line goes.
        const e = { ...(it as AuditEntry & { sk?: string }) };
        delete e.sk;
        out.push(e);
      }
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey && out.length < limit);
    return out;
  }

  async eventsForDay(day: string, limit = 50000): Promise<Event[]> {
    const out: Event[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: EVENTS,
          KeyConditionExpression: "#d = :d",
          ExpressionAttributeNames: { "#d": "day" },
          ExpressionAttributeValues: { ":d": day },
          ExclusiveStartKey,
          Limit: Math.min(1000, limit - out.length),
        })
      );
      for (const it of r.Items ?? []) {
        const e = { ...(it as Event & { sk?: string; expires?: number }) };
        delete e.sk;
        delete e.expires;
        out.push(e);
      }
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey && out.length < limit);
    return out;
  }

  async moneyIssues(): Promise<MoneyIssue[]> {
    const [ledger, jobs] = await Promise.all([
      this.scanAll<LedgerEntry & { pk: string }>(LEDGER, 20000),
      this.scanAll<Job>(JOBS, 10000),
    ]);
    const entries = ledger.filter(
      (e) => !String(e.pk).startsWith("ext#") && String(e.pk) !== SYSTEM_PK
    );
    return findMoneyIssues(jobs, entries);
  }

  async allUsers(limit = 20000): Promise<User[]> {
    return this.scanAll<User>(USERS, limit);
  }

  async adminData(): Promise<AdminData> {
    const now = Date.now();
    const [users, ledger, jobs] = await Promise.all([
      this.scanAll<User>(USERS, 5000),
      this.scanAll<LedgerEntry & { pk: string }>(LEDGER, 20000),
      this.scanAll<Job>(JOBS, 10000),
    ]);
    // Real ledger entries only: the table also holds webhook idempotency
    // guards and the reserved system partition, neither of which is money.
    const entries = ledger.filter(
      (e) => !String(e.pk).startsWith("ext#") && String(e.pk) !== SYSTEM_PK
    );
    const sum = (kind: string) =>
      entries.filter((e) => e.kind === kind).reduce((a, e) => a + Math.abs(e.delta_credits), 0);
    // Paid members still inside their period, grouped by plan and interval.
    // "free" and the pre-tier "none" are not memberships and are excluded;
    // the legacy "monthly"/"annual" values map onto standard, matching
    // lib/plan.ts.
    const memberCounts = new Map<string, MemberCount>();
    for (const u of users) {
      if ((u.membership_renews_at ?? 0) <= now) continue;
      const m = u.membership as string;
      if (m === "free" || m === "none") continue;
      const plan = m === "monthly" || m === "annual" ? "standard" : m;
      const interval: BillingInterval =
        u.billing_interval ?? (m === "annual" ? "year" : "month");
      const key = `${plan}#${interval}`;
      const row = memberCounts.get(key) ?? { plan, interval, count: 0 };
      row.count++;
      memberCounts.set(key, row);
    }

    const balances = new Map<string, number>();
    for (const e of entries) {
      balances.set(e.user_id, (balances.get(e.user_id) ?? 0) + e.delta_credits);
    }
    const jobsByUser = new Map<string, Job[]>();
    for (const j of jobs) {
      const arr = jobsByUser.get(j.user_id) ?? [];
      arr.push(j);
      jobsByUser.set(j.user_id, arr);
    }
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const userRows: AdminUserRow[] = users
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 200)
      .map((u) => ({
        id: u.id,
        email: u.email,
        membership: u.membership,
        membership_renews_at: u.membership_renews_at,
        created_at: u.created_at,
        balance_credits: balances.get(u.id) ?? 0,
        jobs_count: (jobsByUser.get(u.id) ?? []).length,
        storage_bytes: (jobsByUser.get(u.id) ?? [])
          .filter((j) => j.status === "ready")
          .reduce((a, j) => a + (j.size_bytes ?? 0), 0),
      }));

    const jobRows: AdminJobRow[] = jobs
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 100)
      .map((j) => ({
        id: j.id,
        email: emailById.get(j.user_id) ?? j.user_id,
        prompt: j.prompt,
        duration_s: j.duration_s,
        mode: j.mode,
        status: j.status,
        quote_credits: j.quote_credits,
        created_at: j.created_at,
      }));

    return {
      userCount: users.length,
      members: [...memberCounts.values()],
      creditsPurchased: sum("topup") + sum("adjustment"),
      creditsSpent: sum("charge"),
      creditsRefunded: sum("refund"),
      jobsReady: jobs.filter((j) => j.status === "ready").length,
      jobsFailed: jobs.filter((j) => j.status === "failed").length,
      jobsInFlight: jobs.filter((j) => ["queued", "generating", "upscaling"].includes(j.status))
        .length,
      users: userRows,
      jobs: jobRows,
      modelTiming: modelTimings(jobs),
    };
  }
}
