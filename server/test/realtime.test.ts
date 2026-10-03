// End-to-end over a real Socket.IO connection: start solo, play all rounds, reach results.
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, PublicState, ServerToClientEvents } from '@rr/shared';
import { attachRealtime, sanitizeSettings } from '../src/realtime.ts';
import { rooms } from '../src/rooms.ts';
import { loadRounds } from '../src/pack.ts';

let server: http.Server;
let client: Socket<ServerToClientEvents, ClientToServerEvents>;
const states: PublicState[] = [];
const haveBank = (() => { try { loadRounds('crabtree'); return true; } catch { return false; } })();

before(async () => {
  server = http.createServer();
  const io = new Server(server);
  attachRealtime(io as never);
  await new Promise<void>((r) => server.listen(0, r));
  client = connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { transports: ['websocket'] });
  client.on('state', (s) => states.push(s));
  await new Promise((r) => client.on('connect', () => r(null)));
});
after(() => {
  client.close();
  server.close();
});

const emit = <E extends keyof ClientToServerEvents>(ev: E, payload: Parameters<ClientToServerEvents[E]>[0]) =>
  new Promise<any>((resolve) => (client.emit as any)(ev, payload, resolve));
const waitFor = async (pred: (s: PublicState) => boolean, ms = 8000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const s = states.at(-1);
    if (s && pred(s)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout; last phase ${states.at(-1)?.phase}`);
};

test('settings are sanitized to allowed values', () => {
  assert.deepEqual(sanitizeSettings({ rounds: 99, timerS: 1, rules: 'cheat' as never, area: '../etc' }), { area: 'crabtree', rounds: 5, timerS: 60, rules: 'normal' });
});

test('solo game over sockets: 3 rounds to results', { skip: !haveBank && 'crabtree pack not built' }, async () => {
  const res = await emit('solo:start', { name: 'Tester', settings: { rounds: 3, timerS: 30 } });
  assert.ok(res.ok, JSON.stringify(res));
  for (let i = 0; i < 3; i++) {
    const s = await waitFor((s) => s.phase === 'play' && s.roundIndex === i);
    assert.ok(s.round && !('truth' in s.round));
    const guess = s.round!.input.kind === 'pin' ? { point: s.round!.camera.center } : { value: 2 };
    assert.ok((await emit('round:lock', guess)).ok);
    const r = await waitFor((s) => s.phase === 'reveal' && s.roundIndex === i);
    assert.ok(r.reveal!.truth);
    assert.ok(r.reveal!.results[0]!.score.final >= 0);
    assert.ok((await emit('round:next', {})).ok);
  }
  const end = await waitFor((s) => s.phase === 'results');
  assert.equal(end.history.length, 3);
  assert.equal(end.players[0]!.score, end.history.reduce((a, h) => a + h.results[0]!.score.final, 0));
  const bad = await emit('round:lock', { value: 1 });
  assert.ok(bad.error);
  rooms.clear();
});

test('party over sockets: 3 phones + TV; TV sees every guess; a phone resumes after reconnecting', { skip: !haveBank && 'crabtree pack not built' }, async () => {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mk = async () => {
    const c = connect(url, { transports: ['websocket'], forceNew: true });
    const st: PublicState[] = [];
    c.on('state', (s) => st.push(s));
    await new Promise((r) => c.on('connect', () => r(null)));
    const call = (ev: string, p: unknown) => new Promise<any>((res) => (c.emit as any)(ev, p, res));
    const wait = async (pred: (s: PublicState) => boolean) => {
      const t = Date.now();
      while (Date.now() - t < 8000) {
        const s = st.at(-1);
        if (s && pred(s)) return s;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`timeout, phase ${st.at(-1)?.phase}`);
    };
    return { c, st, call, wait };
  };
  const host = await mk();
  const created = await host.call('room:create', { name: 'Host', settings: { rounds: 3, timerS: 30 } });
  assert.ok(created.ok, JSON.stringify(created));
  const tv = await mk();
  assert.ok((await tv.call('tv:watch', { code: created.code })).ok);
  const p2 = await mk();
  const p3 = await mk();
  const j2 = await p2.call('room:join', { code: created.code.toLowerCase(), name: 'Ana' });
  const j3 = await p3.call('room:join', { code: created.code, name: 'Ben' });
  assert.ok(j2.ok && j3.ok);
  await p2.call('player:ready', { ready: true });
  await p3.call('player:ready', { ready: true });
  const lobby = await tv.wait((s) => s.players.length === 3 && s.players.every((p) => p.ready));
  assert.equal(lobby.you, null, 'TV is not a player');
  assert.equal(lobby.tvConnected, true);
  assert.match(lobby.joinUrl, new RegExp(`/r/${created.code}$`));
  assert.ok((await host.call('room:start', {})).ok);

  const phones = [host, p2, p3];
  for (let i = 0; i < 3; i++) {
    const s = await host.wait((x) => x.phase === 'play' && x.roundIndex === i);
    if (i === 1) {
      // Kill Ben's connection mid-round and come back with the stored session.
      p3.c.disconnect();
      const again = await mk();
      assert.ok((await again.call('room:resume', { code: created.code, playerId: j3.playerId })).ok);
      phones[2] = again;
      const back = await again.wait((x) => x.phase === 'play' && x.roundIndex === 1 && x.you === 2);
      assert.equal(back.players[2]!.connected, true);
    }
    for (const [k, ph] of phones.entries()) {
      const g = s.round!.input.kind === 'pin' ? { point: s.round!.camera.center } : { value: k + 1 };
      assert.ok((await ph.call('round:lock', g)).ok);
    }
    const rv = await tv.wait((x) => x.phase === 'reveal' && x.roundIndex === i);
    assert.equal(rv.reveal!.results.length, 3, 'TV gets all three guesses');
    assert.ok(rv.reveal!.results.every((r) => r.guess));
    assert.ok((await p2.call('round:next', {})).error, 'only the host continues');
    assert.ok((await host.call('round:next', {})).ok);
  }
  const end = await tv.wait((x) => x.phase === 'results');
  for (const p of end.players) {
    assert.equal(p.score, end.history.reduce((a, h) => a + (h.results.find((r) => r.seat === p.seat)?.score.final ?? 0), 0), 'scoreboard = server per-round sum');
  }
  for (const ph of [host, tv, p2, ...phones.slice(2)]) ph.c.close();
  rooms.clear();
});
