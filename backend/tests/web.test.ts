import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The web app served by the API (single container). No database needed.
describe('web app', () => {
  let app: import('express').Express;
  let dir: string;
  const js = 'console.log("hello from the app bundle");'.repeat(40);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'billflow-web-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.mkdirSync(path.join(dir, 'icons'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>BillFlow</title>');
    fs.writeFileSync(path.join(dir, 'sw.js'), 'self.skipWaiting();');
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"name":"BillFlow"}');
    fs.writeFileSync(path.join(dir, 'icons', 'billflow-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), js);
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js.gz'), zlib.gzipSync(js));
    app = (await import('../src/app')).createApp({ webDir: dir });
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('serves the app shell with web security headers and no long caching', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<title>BillFlow</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('falls back to index.html for app pages, but not for missing files', async () => {
    const page = await request(app).get('/bills/0d6a3c1e-1111-4222-8333-944455556666');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>BillFlow</title>');
    expect((await request(app).get('/assets/missing-123.js')).status).toBe(404);
    expect((await request(app).get('/favicon.ico')).status).toBe(404);
  });

  it('caches fingerprinted assets forever and sends them compressed when accepted', async () => {
    const gz = await request(app).get('/assets/index-abc123.js').set('Accept-Encoding', 'gzip');
    expect(gz.status).toBe(200);
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gz.headers['content-type']).toMatch(/javascript/);
    expect(gz.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(gz.headers.vary).toMatch(/Accept-Encoding/);
    expect(gz.text).toBe(js); // supertest decompresses

    const plain = await request(app).get('/assets/index-abc123.js').set('Accept-Encoding', 'identity');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.text).toBe(js);
  });

  it('never caches the service worker and serves the manifest type', async () => {
    const sw = await request(app).get('/sw.js');
    expect(sw.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    expect(sw.headers['service-worker-allowed']).toBe('/');
    const manifest = await request(app).get('/manifest.webmanifest');
    expect(manifest.headers['content-type']).toMatch(/application\/manifest\+json/);
    const icon = await request(app).get('/icons/billflow-192.png');
    expect(icon.headers['content-type']).toBe('image/png');
  });

  it('keeps API behaviour: JSON 404s, no-store, API security policy', async () => {
    expect((await request(app).get('/api/v1/nope')).status).toBe(401); // unknown API routes still need a sign-in
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('answers the container health check', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok\n');
  });

  it('does not serve files outside the web folder', async () => {
    // Only files found in the folder at startup are served; other paths get the app shell or a 404.
    const passwd = await request(app).get('/..%2f..%2fetc%2fpasswd');
    expect(passwd.text).not.toContain('root:');
    expect(passwd.text).toContain('<title>BillFlow</title>');
    expect((await request(app).get('/%2e%2e/package.json')).status).toBe(404);
    expect((await request(app).get('/..%2f..%2fpackage.json')).status).toBe(404);
  });
});
