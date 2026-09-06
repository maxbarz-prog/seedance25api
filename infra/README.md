# Remerge infrastructure

AWS deploys run from GitHub Actions using OIDC — no long-lived AWS keys are
stored in GitHub, in Claude's environment, or anywhere else. Claude operates
AWS by pushing code and triggering workflows; every deploy is audited in the
Actions log.

## One-time bootstrap (account owner, ~5 minutes)

1. AWS Console → **CloudFormation** → Create stack → *With new resources* →
   **Upload a template file** → upload `infra/github-oidc.yaml` → Next.
2. Stack name: `remerge-github-oidc`. Leave the parameter at its default.
3. Next → Next → tick the *"I acknowledge that AWS CloudFormation might create
   IAM resources with custom names"* box → Submit.
4. When the stack shows CREATE_COMPLETE, open its **Outputs** tab and copy
   `DeployRoleArn` (looks like
   `arn:aws:iam::123456789012:role/remerge-github-deploy`). The ARN is not a
   secret.
5. GitHub repo → Settings → Secrets and variables → Actions → **Variables** →
   New repository variable: name `AWS_DEPLOY_ROLE_ARN`, value = that ARN.
   (Or just paste the ARN to Claude, who can set it up.)

Verification: run the **AWS access check** workflow (Actions tab → AWS access
check → Run workflow). It should print the account and the assumed role.

## Cleanup from the earlier approach

The `claude-deployer` IAM user and its access key are superseded by this role.
Delete the access key (IAM → Users → claude-deployer → Security credentials)
and optionally the user itself; also remove the AWS_* environment variables
from the Claude environment settings — they can't be used for signing there.
