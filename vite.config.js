import { defineConfig } from 'vite';

// Some broadcasters (e.g. CNR, NHK relays) serve HLS manifests without a
// browser-friendly CORS policy, so hls.js running on localhost cannot fetch
// them. This middleware relays those streams and rewrites playlist URIs so
// every follow-up request stays inside the relay. Active in dev and preview.
const PROXY_PREFIX = '/__streampxy/';

function wrapPlaylistUrl(raw, baseScheme, baseHost) {
  let abs;
  if (/^https?:\/\//i.test(raw)) {
    abs = raw;
  } else if (raw.startsWith('/')) {
    abs = `${baseScheme}://${baseHost}${raw}`;
  } else {
    return raw; // relative URI resolves against the current (proxied) URL
  }
  const u = new URL(abs);
  return `${PROXY_PREFIX}${u.protocol === 'http:' ? 'http' : 'https'}/${u.host}${u.pathname}${u.search}`;
}

function rewriteManifest(text, scheme, host) {
  return text
    .split('\n')
    .map((line) => {
      if (!line || line.startsWith('#')) {
        // rewrite URI="..." attributes inside tags (keys, maps, media)
        return line.replace(/URI="([^"]+)"/gi, (m, uri) => `URI="${wrapPlaylistUrl(uri, scheme, host)}"`);
      }
      return wrapPlaylistUrl(line.trim(), scheme, host);
    })
    .join('\n');
}

function streamProxyHandler() {
  return async (req, res, next) => {
    const url = req.url || '';
    if (!url.startsWith(PROXY_PREFIX)) return next();

    const rest = decodeURIComponent(url.slice(PROXY_PREFIX.length));
    const m = rest.match(/^(https?)\/([^/]+)(\/.*)?$/);
    if (!m) {
      res.statusCode = 400;
      return res.end('bad proxy url');
    }
    const [, scheme, host, path = '/'] = m;
    const target = `${scheme}://${host}${path}`;

    try {
      const upstream = await fetch(target, {
        headers: {
          'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 OrbisFm',
          Accept: '*/*',
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
        redirect: 'follow',
      });

      const ctype = upstream.headers.get('content-type') || '';
      const isManifest = /mpegurl|m3u8/i.test(ctype) || /\.m3u8(\?|$)/i.test(path);

      const passHeaders = [
        'content-type', 'cache-control', 'content-length',
        'accept-ranges', 'content-range', 'icy-',
      ];
      for (const [k, v] of upstream.headers) {
        if (passHeaders.some((p) => k.toLowerCase().startsWith(p))) {
          res.setHeader(k, v);
        }
      }
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS');
      res.statusCode = upstream.status;

      if (isManifest) {
        const text = await upstream.text();
        const body = rewriteManifest(text, scheme, host);
        res.setHeader('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('content-length', Buffer.byteLength(body));
        res.end(body);
      } else {
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.end(buf);
      }
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('access-control-allow-origin', '*');
      res.end('proxy error: ' + (err && err.message));
    }
  };
}

function streamProxyPlugin() {
  return {
    name: 'orbis-stream-proxy',
    configureServer(server) {
      server.middlewares.use(streamProxyHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(streamProxyHandler());
    },
  };
}

export default defineConfig({
  plugins: [streamProxyPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
});
