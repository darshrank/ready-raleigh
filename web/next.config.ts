import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // deck.gl's interleaved MapLibre overlay can only attach to the map's WebGL context once,
  // and Strict Mode's double mount attaches it twice.
  reactStrictMode: false,
  // Static export: the Cloudflare Worker serves out/ and hosts the multiplayer rooms.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
