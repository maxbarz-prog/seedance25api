/// <reference path="./.sst/platform/config.d.ts" />

// Remerged infrastructure. Stages: `dev` -> dev.remerged.ai,
// `prod` -> remerged.ai (+ www redirect). Deployed from GitHub Actions
// via OIDC (.github/workflows/deploy.yml); secrets come from SSM Parameter
// Store under /remerged/<stage>/*.
//
// DNS lives at CLOUDFLARE, not Route 53. remerged.ai is registered with
// Cloudflare Registrar, which requires its own nameservers as a condition of
// selling at cost — so the zone cannot be delegated to Route 53 without
// moving the registration. Everything else still runs on AWS; only the
// records live at Cloudflare, and SST writes them through
// sst.cloudflare.dns() using the CLOUDFLARE_API_TOKEN repository secret.
//
// remerged.click is registered in Route 53 and now serves nothing: not the
// site, not auth, not mail. It is not even redirected to remerged.ai — with
// no users, no inbound links and no rankings there is nothing to preserve,
// and a redirect spanning two DNS providers is real complexity for no gain.

export default $config({
  app(input) {
    return {
      name: "remerged",
      removal: input?.stage === "prod" ? "retain" : "remove",
      protect: input?.stage === "prod",
      home: "aws",
      providers: {
        aws: { region: "us-east-1" },
        // Authenticates from CLOUDFLARE_API_TOKEN, a GitHub Actions secret
        // rather than an SSM parameter: only the deploy needs it, and it must
        // never reach the Lambda environment.
        cloudflare: true,
      },
    };
  },
  async run() {
    const users = new sst.aws.Dynamo("Users", {
      fields: {
        id: "string",
        email: "string",
        stripe_customer_id: "string",
        reset_token_hash: "string",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        email: { hashKey: "email" },
        stripe: { hashKey: "stripe_customer_id" },
        reset: { hashKey: "reset_token_hash" },
      },
    });
    const ledger = new sst.aws.Dynamo("Ledger", {
      fields: { pk: "string", sk: "string" },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
    });
    // `pending` is a sparse index key: the attribute exists only while a job
    // is unfinished, so the index holds just the work queue rather than every
    // job ever created. The cron reads that instead of scanning the table.
    const jobs = new sst.aws.Dynamo("Jobs", {
      fields: { id: "string", user_id: "string", created_at: "number", pending: "string" },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        user: { hashKey: "user_id", rangeKey: "created_at" },
        pending: { hashKey: "pending", rangeKey: "created_at" },
      },
    });

    // Private bucket: videos and reference images, served via presigned URLs.
    const media = new sst.aws.Bucket("Media", {
      cors: {
        allowMethods: ["GET", "PUT"],
        allowOrigins: ["*"],
        allowHeaders: ["*"],
      },
    });

    // `help.<domain>` is an alias on the same distribution rather than a
    // second site: the help centre is pages in this app, reading live prices
    // from the same code that charges people. Middleware redirects the alias
    // to /help on the canonical host, so there is one URL per article.
    //
    // `dns` applies to every name in this block, which is why they must all
    // sit in the same Cloudflare zone.
    const dns = sst.cloudflare.dns();
    const domain =
      $app.stage === "prod"
        ? {
            name: "remerged.ai",
            redirects: ["www.remerged.ai"],
            aliases: ["help.remerged.ai"],
            dns,
          }
        : {
            name: `${$app.stage}.remerged.ai`,
            aliases: [`help.${$app.stage}.remerged.ai`],
            dns,
          };

    const environment = {
      DB_BACKEND: "dynamo",
      TABLE_USERS: users.name,
      TABLE_LEDGER: ledger.name,
      TABLE_JOBS: jobs.name,
      VIDEO_BUCKET: media.name,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "",
      CRON_SECRET: process.env.CRON_SECRET ?? "",
      ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? "",
      EMAIL_FROM: process.env.EMAIL_FROM ?? "",
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
      PROVIDER_MODE: process.env.PROVIDER_MODE ?? "",
      // How many jobs the minute cron advances in parallel. Tunable from SSM
      // without a code change if a provider's create-rate limit needs respecting.
      PIPELINE_CONCURRENCY: process.env.PIPELINE_CONCURRENCY ?? "",
      BYTEPLUS_API_KEY: process.env.BYTEPLUS_API_KEY ?? "",
      TOPAZ_API_KEY: process.env.TOPAZ_API_KEY ?? "",
      FAL_KEY: process.env.FAL_KEY ?? "",
      MOCK_BILLING: process.env.MOCK_BILLING ?? "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? "",
      COST_SD25_480P_PER_SEC: process.env.COST_SD25_480P_PER_SEC ?? "",
      COST_SD25_1080P_PER_SEC: process.env.COST_SD25_1080P_PER_SEC ?? "",
      COST_SD20_480P_PER_SEC: process.env.COST_SD20_480P_PER_SEC ?? "",
      COST_SD20_1080P_PER_SEC: process.env.COST_SD20_1080P_PER_SEC ?? "",
      COST_SD20_FAST_480P_PER_SEC: process.env.COST_SD20_FAST_480P_PER_SEC ?? "",
      COST_SD20_FAST_1080P_PER_SEC: process.env.COST_SD20_FAST_1080P_PER_SEC ?? "",
      COST_UPSCALE_2X_PER_SEC: process.env.COST_UPSCALE_2X_PER_SEC ?? "",
      COST_UPSCALE_4X_PER_SEC: process.env.COST_UPSCALE_4X_PER_SEC ?? "",
    };

    const site = new sst.aws.Nextjs("Web", {
      path: "web",
      link: [users, ledger, jobs, media],
      domain,
      environment,
      permissions: [{ actions: ["ses:SendEmail"], resources: ["*"] }],
      transform: {
        // nodejs22.x rather than the default: the AWS SDK v3 drops support for
        // Node 20 in January 2027, and the running Lambda already warns about
        // it on every cold start.
        server: { timeout: "120 seconds", memory: "1536 MB", runtime: "nodejs22.x" },
      },
    });

    // Every minute, nudge in-flight jobs forward so generation completes even
    // when nobody has the job page open.
    new sst.aws.Cron("AdvanceJobs", {
      schedule: "rate(1 minute)",
      function: {
        handler: "functions/advance.handler",
        runtime: "nodejs22.x",
        timeout: "60 seconds",
        environment: {
          SITE_URL: $interpolate`https://${domain.name}`,
          CRON_SECRET: process.env.CRON_SECRET ?? "",
        },
      },
    });

    // Support mailbox: SES receives support@<domain>, stores to S3, and a
    // forwarder re-sends to the private inbox. Receipt rules are account-
    // global, so exactly one stage owns them (MAIL_STAGE, default dev until
    // prod exists).
    //
    // One address, on remerged.ai. remerged.click received support mail until
    // tonight and does not any more: there are no members and nothing was ever
    // sent to it, so keeping it alive would only mean a second address nobody
    // reads. Its MX is gone with this, which bounces anything addressed there
    // at the sender rather than accepting it silently.
    //
    // The remerged.ai records are NOT created here — the SES identity, DKIM,
    // MX, SPF and DMARC come from .github/workflows/mail-domain.yml, which
    // writes into Cloudflare and waits for SES to verify. Run that first.
    if ($app.stage === (process.env.MAIL_STAGE || "dev")) {
      const mailDomain = "remerged.ai";
      const account = aws.getCallerIdentityOutput();
      // A plain S3 bucket, not sst.aws.Bucket, because this one needs a bucket
      // policy and SST owns that decision for its own component. SST only
      // instantiates a policy resource when the bucket needs one, and for a
      // private bucket it creates none — so `transform.policy` is never
      // invoked and silently grants nothing, while adding an
      // aws.s3.BucketPolicy alongside it fails with "the bucket already has a
      // policy attached". Neither is visible until SES bounces the mail:
      // Send 2, Delivery 2, Bounce 2, and no object in the bucket.
      //
      // Owning the two resources outright is duller and does what it says.
      const inbound = new aws.s3.BucketV2("Inbound", { forceDestroy: true });
      new aws.s3.BucketPublicAccessBlock("InboundPublicAccessBlock", {
        bucket: inbound.bucket,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      });
      // Let SES write received messages into inbound/. Two statements because
      // SES changed how it identifies itself: aws:SourceAccount with
      // aws:SourceArn is the form AWS documents now, aws:Referer the one it
      // documented for years. Either satisfies the grant, and both pin it to
      // this account so the bucket is never writable by another account's SES
      // that happens to know the name.
      const inboundPolicy = new aws.s3.BucketPolicy("InboundSesWrite", {
        bucket: inbound.bucket,
        policy: $resolve([inbound.bucket, account.accountId]).apply(([bucket, acct]) => {
          const resource = `arn:aws:s3:::${bucket}/inbound/*`;
          const principal = { Service: "ses.amazonaws.com" };
          return JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "AllowSESPutsBySource",
                Effect: "Allow",
                Principal: principal,
                Action: "s3:PutObject",
                Resource: resource,
                Condition: {
                  StringEquals: { "aws:SourceAccount": acct },
                  StringLike: { "aws:SourceArn": `arn:aws:ses:us-east-1:${acct}:*` },
                },
              },
              {
                Sid: "AllowSESPutsByReferer",
                Effect: "Allow",
                Principal: principal,
                Action: "s3:PutObject",
                Resource: resource,
                Condition: { StringEquals: { "aws:Referer": acct } },
              },
            ],
          });
        }),
      });
      const forwarder = new sst.aws.Function("MailForwarder", {
        handler: "functions/mail-forward.handler",
        runtime: "nodejs22.x",
        timeout: "30 seconds",
        // No `link`: inbound is a plain bucket, so say what the function may
        // do with it. It reads the name from the environment either way.
        permissions: [
          { actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: ["*"] },
          { actions: ["s3:GetObject"], resources: [$interpolate`${inbound.arn}/*`] },
        ],
        environment: {
          INBOUND_BUCKET: inbound.bucket,
          INBOUND_PREFIX: "inbound/",
          MAIL_FROM: `support@${mailDomain}`,
          FORWARD_TO:
            process.env.SUPPORT_FORWARD_TO ||
            (process.env.ADMIN_EMAILS ?? "").split(",")[0].trim(),
        },
      });
      new aws.lambda.Permission("MailForwarderSesInvoke", {
        action: "lambda:InvokeFunction",
        function: forwarder.name,
        principal: "ses.amazonaws.com",
        sourceAccount: account.accountId,
      });
      const ruleSet = new aws.ses.ReceiptRuleSet("MailRuleSet", { ruleSetName: "remerged" });
      new aws.ses.ActiveReceiptRuleSet("MailRuleSetActive", { ruleSetName: ruleSet.ruleSetName });
      new aws.ses.ReceiptRule("SupportRule", {
        ruleSetName: ruleSet.ruleSetName,
        name: "support",
        recipients: [`support@${mailDomain}`],
        enabled: true,
        scanEnabled: true,
        s3Actions: [{ bucketName: inbound.bucket, objectKeyPrefix: "inbound/", position: 1 }],
        lambdaActions: [{ functionArn: forwarder.arn, invocationType: "Event", position: 2 }],
        // SES test-writes to the bucket while creating or updating the rule, so
        // the grant has to exist first. Nothing in the arguments says so.
      }, { dependsOn: [inboundPolicy] });
    }

    return { url: site.url, bucket: media.name };
  },
});
