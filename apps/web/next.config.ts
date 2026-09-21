import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@hunter/ui", "@hunter/core", "@hunter/ai", "@hunter/adapters", "@hunter/config"],
};

export default nextConfig;
