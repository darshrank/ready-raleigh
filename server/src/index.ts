// Server entry. Ported from pocket-rivals server/index.js (MIT): HTTP/HTTPS start,
// LAN banner, Socket.IO wiring. Rooms and phases arrive in M3/M4.
import http from 'node:http';
import https from 'node:https';
import { Server } from 'socket.io';
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from '@rr/shared';
import { createApp } from './app.ts';
import { lanAddress, lanAddresses } from './net.ts';
import { attachRealtime } from './realtime.ts';
import { loadOrCreateCert } from './tls.ts';

const PORT = Number(process.env.PORT) || 3000;
const USE_HTTPS = /^(1|true|yes|on)$/i.test(process.env.HTTPS ?? '');
const PROTO = USE_HTTPS ? 'https' : 'http';
const PUBLIC_URL = process.env.PUBLIC_URL || undefined;

async function start() {
  const app = createApp({ port: PORT, protocol: PROTO, publicUrl: PUBLIC_URL });
  const server = USE_HTTPS
    ? https.createServer(await loadOrCreateCert(lanAddresses()), app)
    : http.createServer(app);

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(server, {
    maxHttpBufferSize: 6e6,
  });
  attachRealtime(io, { port: PORT, protocol: PROTO, publicUrl: PUBLIC_URL });

  server.listen(PORT, () => {
    console.log('\n  Ready Raleigh server is live');
    console.log(`  Local:   ${PROTO}://localhost:${PORT}`);
    console.log(`  Phones:  ${PUBLIC_URL ?? `${PROTO}://${lanAddress()}:${PORT}`}`);
    console.log(`  AI:      ${process.env.GEMINI_API_KEY ? 'Gemini' : 'mock (set GEMINI_API_KEY in .env)'}\n`);
  });
}

start();
