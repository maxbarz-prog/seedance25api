"use client";

import { useEffect } from "react";

// The landing page is white whatever the system theme — it is the shop
// window, and its footage is graded for a light surround. The tokens live
// on the root element, and the header and footer in the layout read them
// too, so the override has to go there rather than on the page's own box.
// Set on mount, removed on the way out, so every page after the front
// door follows the viewer's preference as before.
export default function ForceLight() {
  useEffect(() => {
    document.documentElement.classList.add("force-light");
    return () => document.documentElement.classList.remove("force-light");
  }, []);
  return null;
}
