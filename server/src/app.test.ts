import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildServer } from './app';

const app = buildServer();
afterAll(() => app.close());

describe('server', () => {
  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /api/join-base reports where phones can join', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/join-base' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['lan', 'publicUrl']);
  });

  it('opens a room on /ws/rooms/:code (P9 replaced the P1 echo; rooms.test.ts covers games)', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/rooms/abcd`);
    const first = await new Promise<string>((resolve, reject) => {
      ws.on('error', reject);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Host', candidate: 'peep-17', create: true })));
      ws.on('message', (data) => {
        const msg = data.toString();
        if (JSON.parse(msg).t === 'state') resolve(msg);
      });
    });
    ws.close();
    expect(JSON.parse(first)).toMatchObject({ t: 'state', state: { code: 'ABCD', phase: 'lobby', you: 0, hostSeat: 0 } });
  });
});
