import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/** This machine's LAN addresses, so phones on the same Wi-Fi can load the dev server. */
const lanHosts = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n!.address);

const nextConfig: NextConfig = {
  // deck.gl's interleaved MapLibre overlay can only attach to the map's WebGL context once,
  // and Strict Mode's double mount attaches it twice.
  reactStrictMode: false,
  allowedDevOrigins: [...lanHosts, "*.local"],
  // a stray lockfile at the repo root would otherwise make Turbopack treat the repo as the workspace
  turbopack: { root: __dirname },
};

export default nextConfig;
