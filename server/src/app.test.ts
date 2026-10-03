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

  it('echoes on /ws/rooms/:code', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/rooms/abcd`);
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', (data) => {
        messages.push(data.toString());
        if (messages.length === 1) ws.send('{"type":"ping"}');
        else resolve();
      });
    });
    ws.close();
    expect(JSON.parse(messages[0]!)).toEqual({ type: 'hello', room: 'ABCD' });
    expect(messages[1]).toBe('{"type":"ping"}');
  });
});
