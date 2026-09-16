import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow an alternate build dir (e.g. for verification builds that must not
  // clobber a running dev server's .next). Defaults to the standard ".next".
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Pin tracing root to web/ so the monorepo package.json at .. doesn't trigger a warning.
  outputFileTracingRoot: __dirname,
  // Allow large file uploads (PDFs, PPTX with media can easily exceed 10MB)
  experimental: {
    middlewareClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
