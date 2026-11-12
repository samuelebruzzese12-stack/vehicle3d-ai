import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "draco3dgltf", "gltf-validator"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
