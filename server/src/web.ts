// In production the server also serves the built app (app/dist), so the game, /api and /ws share
// one origin and one domain. In dev Vite serves the app and proxies /api and /ws here instead.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export const APP_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'dist');

/** Serves the built app when it exists; client routes (/solo, /play/ABCD...) get index.html. */
export async function registerWeb(app: FastifyInstance, dir = APP_DIST): Promise<boolean> {
  if (!existsSync(join(dir, 'index.html'))) return false;
  await app.register(fastifyStatic, { root: dir, wildcard: false, maxAge: '1h' });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/ws/') || req.url.startsWith('/data/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
  return true;
}
