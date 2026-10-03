import Fastify from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';

const ROOM_PATH = /^\/ws\/rooms\/([A-Za-z0-9-]{1,32})$/;

/** Builds the server without listening, so tests can inject requests. */
export function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/api/health', async () => ({ ok: true }));

  // Rooms: echo for now (P1). P9 replaces this with the room state machine.
  const wss = new WebSocketServer({ noServer: true });
  app.server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const match = ROOM_PATH.exec(path);
    if (!match) {
      socket.destroy();
      return;
    }
    const code = match[1]!.toUpperCase();
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: 'hello', room: code }));
      ws.on('message', (data) => ws.send(data.toString()));
    });
  });
  app.addHook('onClose', (_instance, done) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => done());
  });

  return app;
}
