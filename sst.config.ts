/// <reference path="./.sst/platform/config.d.ts" />

// Remerged infrastructure. Stages: `dev` -> dev.remerged.click,
// `prod` -> remerged.click (+ www redirect). Deployed from GitHub Actions
// via OIDC (.github/workflows/deploy.yml); secrets come from SSM Parameter
// Store under /remerged/<stage>/*.

export default $config({
  app(input) {
    return {
      name: "remerged",
      removal: input?.stage === "prod" ? "retain" : "remove",
      protect: input?.stage === "prod",
      home: "aws",
      providers: { aws: { region: "us-east-1" } },
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

    const domain =
      $app.stage === "prod"
        ? { name: "remerged.click", redirects: ["www.remerged.click"] }
        : { name: `${$app.stage}.remerged.click` };

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
        server: { timeout: "120 seconds", memory: "1536 MB" },
      },
    });

    // Every minute, nudge in-flight jobs forward so generation completes even
    // when nobody has the job page open.
    new sst.aws.Cron("AdvanceJobs", {
      schedule: "rate(1 minute)",
      function: {
        handler: "functions/advance.handler",
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
    if ($app.stage === (process.env.MAIL_STAGE || "dev")) {
      const mailDomain = "remerged.click";
      const account = aws.getCallerIdentityOutput();
      const zone = aws.route53.getZoneOutput({ name: mailDomain });
      const inbound = new sst.aws.Bucket("Inbound", {
        transform: {
          // Let SES write received messages into inbound/ (appended to the
          // policy SST already manages for the bucket).
          policy: (args) => {
            args.policy = $resolve([args.policy, args.bucket, account.accountId]).apply(
              ([policy, bucket, acct]) => {
                const doc = JSON.parse(String(policy));
                doc.Statement.push({
                  Effect: "Allow",
                  Principal: { Service: "ses.amazonaws.com" },
                  Action: "s3:PutObject",
                  Resource: `arn:aws:s3:::${bucket}/inbound/*`,
                  Condition: { StringEquals: { "aws:Referer": acct } },
                });
                return JSON.stringify(doc);
              }
            );
          },
        },
      });
      const forwarder = new sst.aws.Function("MailForwarder", {
        handler: "functions/mail-forward.handler",
        timeout: "30 seconds",
        link: [inbound],
        permissions: [{ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: ["*"] }],
        environment: {
          INBOUND_BUCKET: inbound.name,
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
        s3Actions: [{ bucketName: inbound.name, objectKeyPrefix: "inbound/", position: 1 }],
        lambdaActions: [{ functionArn: forwarder.arn, invocationType: "Event", position: 2 }],
      });
      new aws.route53.Record("MailMx", {
        zoneId: zone.zoneId,
        name: mailDomain,
        type: "MX",
        ttl: 300,
        records: ["10 inbound-smtp.us-east-1.amazonaws.com"],
      });
    }

    return { url: site.url, bucket: media.name };
  },
});
