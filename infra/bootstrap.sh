#!/usr/bin/env bash
# Idempotent per-stage bootstrap, run by the deploy workflow before `sst deploy`.
# Creates what a stage needs that isn't in code: random secrets (only if
# absent), the SES sending identity for the domain with DKIM records in
# Route 53, and the EMAIL_FROM parameter. Safe to re-run every deploy.
set -euo pipefail

STAGE="${1:?stage}"
DOMAIN="remerged.click"
REGION="us-east-1"
PREFIX="/remerged/$STAGE"

ensure_secret() {
  local name="$1"
  if ! aws ssm get-parameter --name "$PREFIX/$name" --region "$REGION" >/dev/null 2>&1; then
    local value
    value=$(openssl rand -hex 32)
    aws ssm put-parameter --name "$PREFIX/$name" --value "$value" \
      --type SecureString --region "$REGION" >/dev/null
    echo "created $PREFIX/$name"
  fi
}

ensure_param() {
  local name="$1" value="$2"
  if ! aws ssm get-parameter --name "$PREFIX/$name" --region "$REGION" >/dev/null 2>&1; then
    aws ssm put-parameter --name "$PREFIX/$name" --value "$value" \
      --type String --region "$REGION" >/dev/null
    echo "created $PREFIX/$name"
  fi
}

ensure_secret SESSION_SECRET
ensure_secret CRON_SECRET

# SES domain identity with Easy DKIM; DKIM CNAMEs upserted into the hosted zone.
if ! aws sesv2 get-email-identity --email-identity "$DOMAIN" --region "$REGION" >/dev/null 2>&1; then
  aws sesv2 create-email-identity --email-identity "$DOMAIN" --region "$REGION" >/dev/null
  echo "created SES identity $DOMAIN"
fi
TOKENS=$(aws sesv2 get-email-identity --email-identity "$DOMAIN" --region "$REGION" \
  --query 'DkimAttributes.Tokens' --output text)
ZONE_ID=$(aws route53 list-hosted-zones --query "HostedZones[?Name=='$DOMAIN.'].Id" --output text)
if [ -n "$TOKENS" ] && [ -n "$ZONE_ID" ]; then
  CHANGES="["
  for t in $TOKENS; do
    CHANGES+="{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$t._domainkey.$DOMAIN\",\"Type\":\"CNAME\",\"TTL\":1800,\"ResourceRecords\":[{\"Value\":\"$t.dkim.amazonses.com\"}]}},"
  done
  CHANGES="${CHANGES%,}]"
  aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --change-batch "{\"Changes\":$CHANGES}" >/dev/null
  echo "DKIM records upserted"
fi

ensure_param EMAIL_FROM "no-reply@$DOMAIN"
