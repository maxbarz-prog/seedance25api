import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module used only by the local sqlite backend; keep it out of the
  // server bundle so Lambda builds (DB_BACKEND=dynamo) never load it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
