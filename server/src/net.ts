// LAN address discovery and public base URL for QR join links.
// Ported from pocket-rivals server/index.js (MIT).
import os from 'node:os';

const VIRTUAL = /virtual|vbox|vmware|vethernet|wsl|docker|hyper-v|loopback|tailscale|zerotier|utun|bridge/i;

/** Addresses phones on the same Wi-Fi might reach, best first; virtual adapters last. */
export function lanAddresses(): string[] {
  const candidates: { address: string; score: number }[] = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      let score = 0;
      if (VIRTUAL.test(name)) score -= 10;
      if (/wi-?fi|wlan|wireless|^en\d|^eth|ethernet/i.test(name)) score += 5;
      if (/^192\.168\.56\./.test(i.address)) score -= 10; // VirtualBox host-only default
      if (/^(192\.168|10)\./.test(i.address)) score += 1;
      candidates.push({ address: i.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((c) => c.address);
}

export const lanAddress = () => lanAddresses()[0] ?? 'localhost';

/**
 * Base URL that phones should open. PUBLIC_URL (our domain or a tunnel) wins;
 * a localhost request is rewritten to the LAN address so a QR scanned off the TV works.
 * The port comes from the request (5173 via the Vite proxy in dev, the server port in prod).
 */
export function publicBase(opts: { host?: string; protocol: string; port: number; publicUrl?: string }): string {
  if (opts.publicUrl) return opts.publicUrl.replace(/\/$/, '');
  const host = opts.host ?? `localhost:${opts.port}`;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/.exec(host);
  if (local) return `${opts.protocol}://${lanAddress()}:${local[2] ?? opts.port}`;
  return `${opts.protocol}://${host}`;
}

export const joinUrl = (base: string, code: string) => `${base}/r/${encodeURIComponent(code.toUpperCase())}`;
