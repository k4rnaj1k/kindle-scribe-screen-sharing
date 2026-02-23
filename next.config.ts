import type { NextConfig } from "next";

const isTauri = process.env.TAURI_BUILD === "true";

const nextConfig: NextConfig = {
  output: isTauri ? 'export' : undefined,
  images: {
    unoptimized: true,
  }
};

export default nextConfig;
