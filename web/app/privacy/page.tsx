import { PRIVACY, LEGAL_UPDATED } from "@/lib/legal";

export default function Page() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-3xl font-semibold">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <div className="mt-8 space-y-6">
        {PRIVACY.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="font-medium">{heading}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
