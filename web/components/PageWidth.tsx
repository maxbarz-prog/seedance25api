"use client";

import { usePathname } from "next/navigation";

// The content column. Five-xl (1024px) everywhere inside the product: the
// composer, the library, the account page all read best at that width. The
// landing page gets seven-xl (1280px): it is a shop window, its footage is
// the point, and at 1024 the hero looked like a thumbnail on a wide screen.
//
// A client component reading the pathname rather than a class toggled on
// mount: the width is known at render, so the server sends the right one
// and nothing shifts after hydration.
export function pageWidthClass(pathname: string | null): string {
  return pathname === "/" ? "max-w-7xl" : "max-w-5xl";
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
