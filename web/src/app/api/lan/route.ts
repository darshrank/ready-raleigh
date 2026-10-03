import { networkInterfaces } from "node:os";

export const dynamic = "force-dynamic";

/** The machine's LAN address, so a room QR code opened on localhost still works on phones. */
export function GET() {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n!.address);
  const lan = ips.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) ?? ips[0] ?? null;
  return Response.json({ ip: lan });
}
