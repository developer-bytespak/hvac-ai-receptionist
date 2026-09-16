import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The demo bootstraps its own database on first request, so every API route
  // is dynamic and nothing is prerendered against a database at build time.
  typescript: { ignoreBuildErrors: false },
  /**
   * Both database drivers must be required at runtime rather than bundled.
   * PGlite locates its WebAssembly and its Postgres data file relative to its
   * own module URL, and a bundled copy loses that reference, which surfaces as
   * ERR_INVALID_ARG_TYPE on the first query. Leaving them external also keeps
   * the pg native bindings intact.
   */
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
