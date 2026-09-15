"use client";

import { usePathname } from "next/navigation";

// The content column. Five-xl (1024px) everywhere inside the product: the
// composer, the library, the account page all read best at that width. The
// landing page gets 1600px: it is a shop window, its footage is the point,
// and on a wide monitor it should fill the same space the sites it is
// measured against fill — Runway's column is about that.
//
// A client component reading the pathname rather than a class toggled on
// mount: the width is known at render, so the server sends the right one
// and nothing shifts after hydration.
export function pageWidthClass(pathname: string | null): string {
  return pathname === "/" ? "max-w-[100rem]" : "max-w-5xl";
}

export default function PageWidth({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  return <div className={`mx-auto ${pageWidthClass(pathname)} ${className}`}>{children}</div>;
}
