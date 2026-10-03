// The address phones on the same Wi-Fi can reach, for the room QR code.
// Ported from the aum branch (pocket-rivals server/index.js, MIT).
import os from 'node:os';

const VIRTUAL = /virtual|vbox|vmware|vethernet|wsl|docker|hyper-v|loopback|tailscale|zerotier|utun|bridge/i;

/** LAN IPv4 addresses, best guess first (Wi-Fi/Ethernet before virtual adapters). */
export function lanAddresses(): string[] {
  const found: { address: string; score: number }[] = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      let score = 0;
      if (VIRTUAL.test(name)) score -= 10;
      if (/wi-?fi|wlan|wireless|^en\d|^eth|ethernet/i.test(name)) score += 5;
      if (/^192\.168\.56\./.test(i.address)) score -= 10; // VirtualBox host-only default
      if (/^(192\.168|10)\./.test(i.address)) score += 1;
      found.push({ address: i.address, score });
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.address);
}
