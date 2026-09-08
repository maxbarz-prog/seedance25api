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
};

export default nextConfig;
