import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

// Inbound mail forwarder. SES stores each message for support@ in S3 and
// invokes this function; we re-send the raw message to the private inbox
// with our own domain as the envelope/From (SES requires a verified sender)
// and the original sender in Reply-To, so replying from the inbox goes back
// to the customer. The private address never appears in outgoing headers.

const s3 = new S3Client({});
const ses = new SESv2Client({});

const BUCKET = process.env.INBOUND_BUCKET!;
const PREFIX = process.env.INBOUND_PREFIX || "inbound/";
const FORWARD_TO = process.env.FORWARD_TO!;
const MAIL_FROM = process.env.MAIL_FROM!; // e.g. support@remerged.ai

interface SesEvent {
  Records: { ses: { mail: { messageId: string; source: string; commonHeaders?: { from?: string[]; subject?: string } } } }[];
}

export const handler = async (event: SesEvent) => {
  for (const record of event.Records) {
    const { messageId, source, commonHeaders } = record.ses.mail;
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${messageId}` }));
    const raw = await obj.Body!.transformToString("utf-8");

    const originalFrom = commonHeaders?.from?.[0] ?? source;
    // Split headers from body at the first blank line.
    const split = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
    const idx = raw.indexOf(split);
    const headerBlock = idx >= 0 ? raw.slice(0, idx) : raw;
    const body = idx >= 0 ? raw.slice(idx) : "";

    // Drop headers that would fail or fight our re-send; keep the rest.
    const dropped = /^(from|to|cc|bcc|reply-to|return-path|sender|dkim-signature|message-id|received|x-ses-.*|authentication-results|received-spf):/i;
    const kept: string[] = [];
    let current = "";
    for (const line of headerBlock.split(/\r?\n/)) {
      if (/^[ \t]/.test(line)) {
        current += "\r\n" + line; // folded continuation
        continue;
      }
      if (current) kept.push(current);
      current = line;
    }
    if (current) kept.push(current);
    const filtered = kept.filter((h) => !dropped.test(h));

    const display = originalFrom.replace(/[<>"]/g, "").trim();
    const headers = [
      `From: "${display} via Remerged" <${MAIL_FROM}>`,
      `Reply-To: ${originalFrom}`,
      `To: ${FORWARD_TO}`,
      ...filtered,
    ].join("\r\n");

    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: MAIL_FROM,
        Destination: { ToAddresses: [FORWARD_TO] },
        Content: { Raw: { Data: Buffer.from(headers + body) } },
      })
    );
  }
  return { forwarded: event.Records.length };
};
