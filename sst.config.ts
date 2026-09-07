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
    const jobs = new sst.aws.Dynamo("Jobs", {
      fields: { id: "string", user_id: "string", created_at: "number" },
      primaryIndex: { hashKey: "id" },
      globalIndexes: { user: { hashKey: "user_id", rangeKey: "created_at" } },
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
      BYTEPLUS_API_KEY: process.env.BYTEPLUS_API_KEY ?? "",
      TOPAZ_API_KEY: process.env.TOPAZ_API_KEY ?? "",
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

    return { url: site.url, bucket: media.name };
  },
});
