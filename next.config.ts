import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The AI analyst reads its instructions and background files from
   * `knowledge/` at request time. File tracing cannot see a path built at
   * runtime, so without this the folder is missing from the deployed function
   * and the analyst has no instructions in production.
   */
  outputFileTracingIncludes: {
    "/api/ai/analysis": ["./knowledge/**/*.md"],
    "/ai": ["./knowledge/**/*.md"],
  },
};

export default nextConfig;
