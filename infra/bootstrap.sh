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

# SMTP credentials so the owner can "Send mail as" support@ from Gmail via
# SES. Created once; username/password stored under /remerged/mail/*.
if ! aws ssm get-parameter --name "/remerged/mail/SMTP_PASSWORD" --region "$REGION" >/dev/null 2>&1; then
  USER_NAME="remerged-ses-smtp"
  aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1 || aws iam create-user --user-name "$USER_NAME" >/dev/null
  aws iam put-user-policy --user-name "$USER_NAME" --policy-name ses-send --policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ses:SendRawEmail","ses:SendEmail"],"Resource":"*"}]}'
  KEY_JSON=$(aws iam create-access-key --user-name "$USER_NAME")
  AK=$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKey"]["AccessKeyId"])')
  SK=$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["AccessKey"]["SecretAccessKey"])')
  SMTP_PW=$(python3 - "$SK" "$REGION" <<'PY'
import hmac, hashlib, base64, sys
secret, region = sys.argv[1], sys.argv[2]
def sign(key, msg): return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
k = sign(("AWS4" + secret).encode("utf-8"), "11111111")
k = sign(k, region); k = sign(k, "ses"); k = sign(k, "aws4_request"); k = sign(k, "SendRawEmail")
print(base64.b64encode(b"\x04" + k).decode("utf-8"))
PY
)
  aws ssm put-parameter --name "/remerged/mail/SMTP_USERNAME" --value "$AK" --type String --region "$REGION" >/dev/null
  aws ssm put-parameter --name "/remerged/mail/SMTP_PASSWORD" --value "$SMTP_PW" --type SecureString --region "$REGION" >/dev/null
  aws ssm put-parameter --name "/remerged/mail/SMTP_HOST" --value "email-smtp.$REGION.amazonaws.com" --type String --region "$REGION" >/dev/null
  echo "created SES SMTP credentials"
fi
