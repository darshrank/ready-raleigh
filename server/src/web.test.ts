import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from './app';
import { registerWeb } from './web';

const dist = mkdtempSync(join(tmpdir(), 'web-'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Mayday Mayor</title>');
mkdirSync(join(dist, 'data'));
writeFileSync(join(dist, 'data', 'meta.json'), '{"ok":true}');
const app = buildServer();
afterAll(() => app.close());

describe('registerWeb', () => {
  it('serves the built app, client routes and data, and keeps /api answers', async () => {
    expect(await registerWeb(app, dist)).toBe(true);
    expect((await app.inject('/')).body).toContain('Mayday Mayor');
    expect((await app.inject('/play/ABCD')).body).toContain('Mayday Mayor');
    expect((await app.inject('/data/meta.json')).json()).toEqual({ ok: true });
    expect((await app.inject('/data/missing.json')).statusCode).toBe(404);
    expect((await app.inject('/api/nope')).statusCode).toBe(404);
    expect((await app.inject('/api/health')).json().ok).toBe(true);
  });

  it('stays off without a build', async () => {
    expect(await registerWeb(buildServer(), join(dist, 'none'))).toBe(false);
  });
});
