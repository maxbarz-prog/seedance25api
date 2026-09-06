/// <reference path="./.sst/platform/config.d.ts" />

// Remerged infrastructure. Stages: `dev` -> dev.remerged.click,
// `prod` -> remerged.click. Deployed from GitHub Actions via OIDC
// (.github/workflows/deploy.yml); secrets come from SSM Parameter Store
// under /remerged/<stage>/*.

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
      fields: { id: "string", email: "string" },
      primaryIndex: { hashKey: "id" },
      globalIndexes: { email: { hashKey: "email" } },
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

    const site = new sst.aws.Nextjs("Web", {
      path: "web",
      link: [users, ledger, jobs],
      domain: {
        name: $app.stage === "prod" ? "remerged.click" : `${$app.stage}.remerged.click`,
      },
      environment: {
        DB_BACKEND: "dynamo",
        TABLE_USERS: users.name,
        TABLE_LEDGER: ledger.name,
        TABLE_JOBS: jobs.name,
        SESSION_SECRET: process.env.SESSION_SECRET ?? "",
        ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? "",
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
        PROVIDER_MODE: process.env.PROVIDER_MODE ?? "",
        BYTEPLUS_API_KEY: process.env.BYTEPLUS_API_KEY ?? "",
        TOPAZ_API_KEY: process.env.TOPAZ_API_KEY ?? "",
        MOCK_BILLING: process.env.MOCK_BILLING ?? "",
      },
    });

    return { url: site.url };
  },
});
