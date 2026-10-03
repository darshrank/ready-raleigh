// Self-signed HTTPS so phones on the LAN count as a "secure context"
// (browsers only allow mic/camera on HTTPS). Cached in .cert/ and
// regenerated when the machine's LAN addresses change.
// Ported from pocket-rivals server/tls.js (MIT).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';

const CERT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.cert');
const CERT_FILE = path.join(CERT_DIR, 'cert.json');
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Cert {
  key: string;
  cert: string;
  hosts: string[];
  expiresAt: number;
}

export async function loadOrCreateCert(ips: string[]): Promise<Cert> {
  const hosts = ['localhost', '127.0.0.1', ...ips].sort();
  try {
    const cached = JSON.parse(fs.readFileSync(CERT_FILE, 'utf8')) as Cert;
    const fresh = Date.now() < cached.expiresAt - DAY_MS;
    if (fresh && JSON.stringify(cached.hosts) === JSON.stringify(hosts)) return cached;
  } catch {}

  const expiresAt = Date.now() + 30 * DAY_MS;
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Ready Raleigh (local)' }], {
    notAfterDate: new Date(expiresAt),
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: hosts.map((h) => (/^[\d.]+$/.test(h) ? { type: 7 as const, ip: h } : { type: 2 as const, value: h })),
      },
    ],
  });
  const cert: Cert = { key: pems.private, cert: pems.cert, hosts, expiresAt };
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_FILE, JSON.stringify(cert));
  return cert;
}
