import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapBearing } from '@rr/shared';
import { joinUrl, publicBase } from '../src/net.ts';

test('PUBLIC_URL wins and loses its trailing slash', () => {
  assert.equal(publicBase({ host: 'localhost:3000', protocol: 'http', port: 3000, publicUrl: 'https://readyraleigh.org/' }), 'https://readyraleigh.org');
});

test('non-local host is kept as-is', () => {
  assert.equal(publicBase({ host: '192.168.1.20:3000', protocol: 'http', port: 3000 }), 'http://192.168.1.20:3000');
});

test('localhost is rewritten to the LAN address, keeping the request port', () => {
  assert.match(publicBase({ host: 'localhost:5173', protocol: 'http', port: 3000 }), /^http:\/\/[^/]+:5173$/);
  assert.doesNotMatch(publicBase({ host: 'localhost:5173', protocol: 'http', port: 3000 }), /localhost/);
});

test('join URL uses /r/CODE, uppercased', () => {
  assert.equal(joinUrl('https://x.org', 'abcd'), 'https://x.org/r/ABCD');
});

test('bearing snaps to 45° steps in (-180, 180]', () => {
  assert.equal(snapBearing(0), 0);
  assert.equal(snapBearing(22), 0);
  assert.equal(snapBearing(23), 45);
  assert.equal(snapBearing(-100), -90);
  assert.equal(snapBearing(170), 180);
  assert.equal(snapBearing(-170), 180);
  assert.equal(snapBearing(400), 45);
});
