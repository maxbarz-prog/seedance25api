// Sign-in and sign-up: no header, no footer, no column. The page is the
// whole viewport — footage on one side, the form on the other.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="force-light min-h-screen bg-surface text-ink">{children}</div>;
}
