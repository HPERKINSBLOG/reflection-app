/** Exact public build assets embedded only in the hosted development-preview package. */
export interface PreviewAsset {
  base64: string;
  mime: string;
  size: number;
  sha256: string;
}

export function createPreviewAssets(assets: Readonly<Record<string, PreviewAsset>>) {
  const decoded = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    async fetch(request: Request): Promise<Response> {
      if (!['GET', 'HEAD'].includes(request.method))
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const url = new URL(request.url);
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return new Response('Invalid asset path', { status: 400 });
      }
      if (
        /%2f|%5c/i.test(url.pathname) ||
        /[\\%]/.test(path) ||
        Array.from(path).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        path.split('/').some((part) => part === '.' || part === '..')
      )
        return new Response('Invalid asset path', { status: 400 });
      // API, health and missing static requests always remain outside SPA fallback.
      const reserved = /^\/(?:api|health|assets)(?:\/|$)/.test(path);
      let asset = path === '/' ? assets['/index.html'] : assets[path];
      if (!asset && !reserved && !/\.[^/]+$/.test(path)) {
        const html = (request.headers.get('Accept') ?? '')
          .split(',')
          .some(
            (part) =>
              /^\s*text\/html\s*(?:;|$)/i.test(part) && !/;\s*q=0(?:\.0+)?\s*(?:;|$)/i.test(part),
          );
        if (html) asset = assets['/index.html'];
      }
      if (!asset || /^\/(?:api|health)(?:\/|$)/.test(path))
        return new Response('Asset not found', { status: 404 });
      const etag = `"${asset.sha256}"`;
      const headers = new Headers({
        'Content-Type': asset.mime,
        'Content-Length': String(asset.size),
        'Cache-Control': asset.mime.startsWith('text/html')
          ? 'no-store'
          : /-[\w-]{8,}\.[\w.]+$/.test(path)
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=0, must-revalidate',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
      });
      if (
        (request.headers.get('If-None-Match') ?? '')
          .split(',')
          .some((value) => ['*', etag, `W/${etag}`].includes(value.trim()))
      )
        return new Response(null, { status: 304, headers });
      if (request.method === 'HEAD') return new Response(null, { headers });
      let bytes = decoded.get(asset.sha256);
      if (!bytes) {
        const binary = atob(asset.base64);
        if (binary.length !== asset.size) throw new Error('Preview asset size mismatch');
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        decoded.set(asset.sha256, bytes);
      }
      return new Response(bytes, { headers });
    },
  };
}
