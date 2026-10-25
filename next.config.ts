import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Windows installer (scripts/windows/package.ps1) ships the self-contained server; normal
  // `next start` (taqseem.bat, development) does not use it.
  // It builds into its own folder, so packaging never touches the build a running website uses.
  ...(process.env.TAQSEEM_STANDALONE
    ? { output: "standalone" as const, distDir: ".next-package" }
    : {}),
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Excel/CSV imports go through server actions; files are limited to 2 MB in the app.
    serverActions: { bodySizeLimit: "3mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
