// Cron target: asks the site to advance all in-flight jobs. Keeping the
// logic inside the Next.js app (one deployable) means the Lambda here is a
// tiny authenticated trigger, nothing more.
export const handler = async () => {
  const res = await fetch(`${process.env.SITE_URL}/api/cron/advance`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`advance failed: ${res.status} ${body}`);
  return body;
};
