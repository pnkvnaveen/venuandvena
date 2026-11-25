// The Venu & Vena website's Worker. The pages are static files in dist/ (built from site/);
// this script only handles what a static file cannot:
//   /             keeps the "newest video" card current from the channel's public feed
//   /thumb/<id>   serves a YouTube thumbnail from our own address, so a visitor's browser
//                 never contacts Google until they tap play
// Every response gets the same strict security headers: the browser may load files only
// from this site, plus the youtube-nocookie.com player after a tap.

const CHANNEL = 'UCk5NIPTjIx66AJ1riKgn8qQ';
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    'frame-src https://www.youtube-nocookie.com',
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
  // YouTube's player needs to know which site embeds it, so the referrer is the site's
  // address only (never the page path or anything else).
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function secure(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  r.headers.delete('Set-Cookie');
  return r;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/thumb/')) return secure(await thumbnail(url, ctx));
    if (url.pathname.startsWith('/api/')) return secure(new Response('Not found', { status: 404 }));
    const page = await env.ASSETS.fetch(request);
    if (url.pathname === '/' && page.ok && request.method === 'GET') {
      return secure(await withNewest(page));
    }
    return secure(page);
  },
};

// ---------------------------------------------------------------- thumbnails

// m 320x180, h 640x480 (16:9 picture with bars, cropped on the page), l 1280x720, s tall (Shorts).
const SIZES = { m: ['mqdefault.jpg'], h: ['sddefault.jpg', 'hqdefault.jpg'], l: ['hq720.jpg', 'hqdefault.jpg'], s: ['oardefault.jpg', 'hqdefault.jpg'] };

async function thumbnail(url, ctx) {
  const [, , id, size = 'm'] = url.pathname.split('/');
  if (!VIDEO_ID.test(id || '') || !SIZES[size]) return new Response('Not found', { status: 404 });
  const cache = caches.default;
  const key = new Request(`https://thumb.cache/${id}/${size}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  for (const file of SIZES[size]) {
    const up = await fetch(`https://i.ytimg.com/vi/${id}/${file}`, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!up.ok) continue;
    const out = new Response(up.body, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    });
    ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  }
  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------- newest video

// The newest public episode in the channel's feed (Shorts and the trailer left out), or null.
export function newestFromFeed(xml) {
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const raw = (entry.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const published = (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const title = decode(raw);
    if (!id || !VIDEO_ID.test(id) || /#shorts/i.test(title) || !title.includes(' | ')) continue;
    const parts = title.split(' | ');
    const series = (parts.find((p) => p.endsWith(' with Venu & Vena')) || '').replace(' with Venu & Vena', '');
    return { id, title: parts[0].trim(), series, published: published.slice(0, 10) };
  }
  return null;
}

function decode(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function withNewest(page) {
  let newest = null;
  try {
    const feed = await fetch(FEED, { cf: { cacheTtl: 1800, cacheEverything: true } });
    if (feed.ok) newest = newestFromFeed(await feed.text());
  } catch {
    newest = null;
  }
  if (!newest) return page;
  let stale = false;
  return new HTMLRewriter()
    .on('[data-newest]', {
      element(el) {
        // Only replace the built-in card when the feed has something newer.
        const builtId = el.getAttribute('data-newest');
        const builtDate = el.getAttribute('data-published') || '';
        stale = builtId !== newest.id && newest.published >= builtDate;
        if (stale) el.setAttribute('data-newest', newest.id);
      },
    })
    .on('[data-newest] a[data-yt]', {
      element(el) {
        if (!stale) return;
        el.setAttribute('data-yt', newest.id);
        el.setAttribute('href', `https://www.youtube.com/watch?v=${newest.id}`);
        el.setAttribute('aria-label', `Play ${newest.title}`);
      },
    })
    .on('[data-newest] img', {
      element(el) {
        if (!stale) return;
        el.setAttribute('src', `/thumb/${newest.id}/l`);
        el.setAttribute('srcset', ['m 320w', 'h 640w', 'l 1280w'].map((x) => `/thumb/${newest.id}/${x}`).join(', '));
      },
    })
    .on('[data-newest] [data-newest-title]', {
      element(el) {
        if (stale) el.setInnerContent(newest.title);
      },
    })
    .on('[data-newest] [data-newest-series]', {
      element(el) {
        if (stale && newest.series) el.setInnerContent(newest.series);
      },
    })
    .transform(page);
}
