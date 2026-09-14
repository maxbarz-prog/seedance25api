"use client";

import Link from "next/link";
import { track } from "@/lib/track-client";

// Every way into the product from the landing page goes through here, so
// the report can say which one people actually press.
export default function Cta({
  where,
  children,
  className = "",
  href = "/create",
}: {
  where: string;
  children: React.ReactNode;
  className?: string;
  href?: string;
}) {
  return (
    <Link href={href} onClick={() => track("cta_clicked", { where })} className={className}>
      {children}
    </Link>
  );
}
