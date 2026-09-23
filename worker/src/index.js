// Cloudflare Worker: HLS / audio stream relay for ORBIS FM.
// Mirrors the dev-server proxy in vite.config.js so the same
// `/__streampxy/{scheme}/{host}{pathname}{search}` URL scheme works on
// static hosting (GitHub Pages) where no server middleware exists.

const PROXY_PREFIX = '/__streampxy/';

function wrapPlaylistUrl(raw, baseScheme, baseHost, origin) {
  let abs;
  if (/^https?:\/\//i.test(raw)) {
    abs = raw;
  } else if (raw.startsWith('/')) {
    abs = `${baseScheme}://${baseHost}${raw}`;
  } else {
    return raw; // relative URI resolves against the current (proxied) URL
  }
  const u = new URL(abs);
  return `${origin}${PROXY_PREFIX}${u.protocol === 'http:' ? 'http' : 'https'}/${u.host}${u.pathname}${u.search}`;
}

function rewriteManifest(text, scheme, host, origin) {
  return text
    .split('\n')
    .map((line) => {
      if (!line || line.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (m, uri) => `URI="${wrapPlaylistUrl(uri, scheme, host, origin)}"`);
      }
      return wrapPlaylistUrl(line.trim(), scheme, host, origin);
    })
    .join('\n');
}

function corsHeaders(extra = {}) {
  const h = new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Range, Content-Type',
    'access-control-expose-headers': 'Content-Length, Content-Range',
  });
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (!url.pathname.startsWith(PROXY_PREFIX)) {
      return new Response('ORBIS FM stream relay', { status: 200, headers: corsHeaders() });
    }

    const rest = decodeURIComponent(url.pathname.slice(PROXY_PREFIX.length));
    const m = rest.match(/^(https?)\/([^/]+)(\/.*)?$/);
    if (!m) {
      return new Response('bad proxy url', { status: 400, headers: corsHeaders() });
    }
    const [, scheme, host, path = '/'] = m;
    const target = `${scheme}://${host}${path}${url.search}`;
    const origin = `${url.protocol}//${url.host}`;

    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: {
          'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0 OrbisFm',
          Accept: request.headers.get('accept') || '*/*',
          ...(request.headers.get('range') ? { Range: request.headers.get('range') } : {}),
        },
        redirect: 'follow',
      });

      const ctype = upstream.headers.get('content-type') || '';
      const isManifest = /mpegurl|m3u8/i.test(ctype) || /\.m3u8(\?|$)/i.test(path);

      const passHeaders = new Headers();
      for (const [k, v] of upstream.headers) {
        if (['content-type', 'cache-control', 'content-length', 'accept-ranges', 'content-range'].some((p) => k.toLowerCase().startsWith(p)) || k.toLowerCase().startsWith('icy-')) {
          passHeaders.set(k, v);
        }
      }
      const headers = corsHeaders();
      for (const [k, v] of passHeaders) headers.set(k, v);

      if (isManifest) {
        const text = await upstream.text();
        const body = rewriteManifest(text, scheme, host, origin);
        headers.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
        headers.set('content-length', new TextEncoder().encode(body).length.toString());
        return new Response(body, { status: upstream.status, headers });
      }

      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (err) {
      return new Response('proxy error: ' + (err && err.message ? err.message : String(err)), {
        status: 502,
        headers: corsHeaders(),
      });
    }
  },
};
