import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module used only by the local sqlite backend; keep it out of the
  // server bundle so Lambda builds (DB_BACKEND=dynamo) never load it.
  // ffmpeg-static resolves its binary at runtime, so it stays external and
  // the binary is traced into the server bundle explicitly.
  serverExternalPackages: ["better-sqlite3", "ffmpeg-static"],
  outputFileTracingIncludes: {
    "/**/*": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  // The browser-side hardening that costs nothing and every audit asks for.
  // No Content-Security-Policy here: Clerk and Stripe inject scripts and
  // frames of their own, and a CSP that has to allow all of it is a list to
  // maintain for little protection. frame-ancestors alone is what stops the
  // page being embedded and click-jacked, and needs no allow-list.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
