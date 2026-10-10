import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Neon uses ws on the server; preserve its native optional-module loading.
  serverExternalPackages: ["ws"],
};

export default nextConfig;
