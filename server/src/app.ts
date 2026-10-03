import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import QRCode from 'qrcode';
import { joinUrl, publicBase } from './net.ts';

export interface AppConfig {
  port: number;
  protocol: 'http' | 'https';
  publicUrl?: string;
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
/** Location packs built by the pipeline (pipeline/out/<area>/...). */
export const PACKS_DIR = process.env.PACKS_DIR ?? path.join(ROOT, 'pipeline', 'out');

export function createApp(cfg: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression()); // pack JSON/GeoJSON compresses ~5×
  const base = (req: express.Request) =>
    publicBase({ host: req.get('host'), protocol: cfg.protocol, port: cfg.port, publicUrl: cfg.publicUrl });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/info', (req, res) => {
    res.json({ base: base(req), aiLive: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.get('/qr/:code.png', async (req, res) => {
    const code = req.params.code;
    if (!/^[A-Za-z2-9]{4}$/.test(code)) {
      res.sendStatus(400);
      return;
    }
    res.type('png').send(await QRCode.toBuffer(joinUrl(base(req), code), { margin: 1, width: 360 }));
  });

  // Location packs: read-only, never the pipeline's work/ intermediates. Range requests (PMTiles) supported.
  app.use('/packs', (req, res, next) => {
    if (!/^\/[a-z0-9_-]+\/(?!work\/)[\w./-]+$/.test(req.path) || req.path.includes('..')) {
      res.sendStatus(404);
      return;
    }
    next();
  });
  app.use('/packs', express.static(PACKS_DIR, { index: false, maxAge: '1h', fallthrough: false }));

  // Production: serve the built client (dev uses the Vite server, which proxies /api and /socket.io here).
  app.use(express.static(CLIENT_DIST));
  // Client-side routes (/debug/flood, /r/CODE, /tv/CODE …) fall back to the SPA shell.
  app.get(/^\/(?!api|packs|qr|socket\.io).*/, (_req, res, next) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => err && next());
  });

  return app;
}
