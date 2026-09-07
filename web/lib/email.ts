import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SITE_NAME } from "./config";

// Transactional email via SES. Without EMAIL_FROM configured (local dev),
// messages are logged instead of sent so flows stay testable.

const FROM = process.env.EMAIL_FROM;
let _ses: SESv2Client | null = null;

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!FROM) {
    console.log(`[email:mock] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  if (!_ses) _ses = new SESv2Client({});
  await _ses.send(
    new SendEmailCommand({
      FromEmailAddress: `${SITE_NAME} <${FROM}>`,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Text: { Data: text } },
        },
      },
    })
  );
}
