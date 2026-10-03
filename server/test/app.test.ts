import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';

let server: Server;
let url: string;

before(async () => {
  server = createApp({ port: 0, protocol: 'http', publicUrl: 'https://example.org' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('/api/health responds', async () => {
  const res = await fetch(`${url}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('/api/info reports PUBLIC_URL as base', async () => {
  const body = (await (await fetch(`${url}/api/info`)).json()) as { base: string };
  assert.equal(body.base, 'https://example.org');
});

test('/qr returns a PNG for a valid code and 400 otherwise', async () => {
  const ok = await fetch(`${url}/qr/C9W3.png`);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${url}/qr/AB1.png`)).status, 400);
});

test('/packs serves pack files with range support but never work/ files', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { PACKS_DIR } = await import('../src/app.ts');
  mkdirSync(`${PACKS_DIR}/testarea/work`, { recursive: true });
  writeFileSync(`${PACKS_DIR}/testarea/stages.json`, '{"ok":true}');
  writeFileSync(`${PACKS_DIR}/testarea/work/secret.json`, '{}');
  const ok = await fetch(`${url}/packs/testarea/stages.json`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(ok.status, 206);
  assert.equal(await ok.text(), '{"ok');
  assert.equal((await fetch(`${url}/packs/testarea/work/secret.json`)).status, 404);
  // fetch() normalizes "..", so send the raw path with node:http.
  const { request } = await import('node:http');
  const raw = await new Promise<number>((resolve) => {
    request(`${url}/packs/testarea/../../package.json`, { path: '/packs/testarea/../../package.json' }, (r) => resolve(r.statusCode ?? 0)).end();
  });
  assert.equal(raw, 404);
  const { rmSync } = await import('node:fs');
  rmSync(`${PACKS_DIR}/testarea`, { recursive: true });
});
