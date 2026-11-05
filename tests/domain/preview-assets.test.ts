import { expect, test } from 'vitest';
import { createPreviewAssets } from '../../src/worker/preview-assets.ts';

const assets = {
  '/index.html': {
    base64: btoa('<main>Reflection preview</main>'),
    mime: 'text/html',
    size: 31,
    sha256: '1'.repeat(64),
  },
  '/assets/app-1234abcd.js': {
    base64: btoa('export const ready = true;'),
    mime: 'application/javascript',
    size: 26,
    sha256: '2'.repeat(64),
  },
};
const request = (path: string, init?: RequestInit) =>
  new Request(`https://reflection-preview.example.com${path}`, init);

test('preview root and document navigation receive exact HTML without caching', async () => {
  const fetcher = createPreviewAssets(assets);
  for (const path of ['/', '/astrology/pattern', '/readings/saved-edition']) {
    const response = await fetcher.fetch(request(path, { headers: { Accept: 'text/html' } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<main>Reflection preview</main>');
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
});

test('hashed assets preserve exact bytes, MIME, ETag and immutable caching for GET and HEAD', async () => {
  const fetcher = createPreviewAssets(assets);
  const get = await fetcher.fetch(request('/assets/app-1234abcd.js'));
  expect(await get.text()).toBe('export const ready = true;');
  expect(get.headers.get('Content-Type')).toBe('application/javascript');
  expect(get.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  expect(get.headers.get('ETag')).toBe(`"${'2'.repeat(64)}"`);
  const head = await fetcher.fetch(request('/assets/app-1234abcd.js', { method: 'HEAD' }));
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(head.headers.get('Content-Length')).toBe('26');
  expect(head.headers.get('ETag')).toBe(get.headers.get('ETag'));
  const unchanged = await fetcher.fetch(
    request('/assets/app-1234abcd.js', { headers: { 'If-None-Match': get.headers.get('ETag')! } }),
  );
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe('');
});

test('unknown static files and API paths cannot receive the SPA document', async () => {
  const fetcher = createPreviewAssets(assets);
  for (const path of ['/assets/missing.js', '/missing.svg', '/api/v1/me', '/health']) {
    const response = await fetcher.fetch(request(path, { headers: { Accept: 'text/html' } }));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Reflection preview');
  }
  expect(
    (await fetcher.fetch(request('/unknown', { headers: { Accept: 'application/json' } }))).status,
  ).toBe(404);
});

test('unsupported methods and ambiguous encoded paths fail without serving an asset', async () => {
  const fetcher = createPreviewAssets(assets);
  const post = await fetcher.fetch(request('/', { method: 'POST' }));
  expect(post.status).toBe(405);
  expect(post.headers.get('Allow')).toBe('GET, HEAD');
  for (const path of [
    '/assets%2fapp-1234abcd.js',
    '/%252e%252e/secret',
    '/bad%00name',
    '/bad%ZZname',
  ]) {
    expect((await fetcher.fetch(request(path, { headers: { Accept: 'text/html' } }))).status).toBe(
      400,
    );
  }
});
