"use client";

import { useEffect, useState } from "react";
import { fetchMe } from "@/lib/me-client";

// Parts of a cached page that are for people who do not have an account
// yet: the example clips and the pitch under the composer. A member has
// seen them; their composer is the box and nothing else. The page is the
// same document for everyone, so the choice is made in the browser, and
// nothing is drawn until it is known.
export default function VisitorOnly({ children }: { children: React.ReactNode }) {
  const [visitor, setVisitor] = useState<boolean | null>(null);
  useEffect(() => {
    fetchMe().then(({ user }) => setVisitor(!user));
  }, []);
  if (!visitor) return null;
  return <>{children}</>;
}
