"use client";

import { useEffect } from "react";

// The pages anyone can read before they have an account are white whatever
// the system theme: the landing page, pricing, and the help centre. They are
// the shop window, the footage on them is graded for a light surround, and a
// price list that changes colour between two visits looks like two different
// companies.
//
// The tokens live on the root element, and the header and footer in the
// layout read them too, so the override has to go there rather than on the
// page's own box. Set on mount, removed on the way out, so the product
// itself follows the viewer's preference as before.
export default function ForceLight() {
  useEffect(() => {
    document.documentElement.classList.add("force-light");
    return () => document.documentElement.classList.remove("force-light");
  }, []);
  // The marker is what makes it instant: it is in the document the server
  // sends, so the stylesheet's :root:has() rule applies before the first
  // paint. The effect above is the fallback, and it cannot run early enough
  // on its own — which is why the page flashed dark and then went white.
  return <span className="force-light-now hidden" aria-hidden />;
}
