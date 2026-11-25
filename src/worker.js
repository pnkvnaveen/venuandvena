// The Venu & Vena website's Worker. The pages are static files in dist/ (built from site/);
// this script only handles what a static file cannot:
//   / and /videos  add episodes and Shorts that went public after the last build, read from
//                  the channel's public feed, so a daily upload shows up without a new build
//   /thumb/<id>    serves a YouTube thumbnail from our own address, so a visitor's browser
//                  never contacts Google until they tap play
// Every response gets the same strict security headers: the browser may load files only
// from this site, plus the youtube-nocookie.com player after a tap.

import { count, episodeCard, shortCard } from './cards.js';

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
    if ((url.pathname === '/' || url.pathname === '/videos') && page.ok && request.method === 'GET') {
      return secure(await withLatest(page, env, request));
    }
    return secure(page);
  },
};

// ---------------------------------------------------------------- thumbnails

// m 320x180, h 640x480 (16:9 picture with bars, cropped on the page), l 1280x720, s tall (Shorts).
const SIZES = {
  m: ['mqdefault.jpg'],
  h: ['sddefault.jpg', 'hqdefault.jpg'],
  l: ['hq720.jpg', 'hqdefault.jpg'],
  s: ['oardefault.jpg', 'hqdefault.jpg'],
};

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

// ---------------------------------------------------------------- the channel feed

function decode(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// The feed's videos, newest first: {id, title, published, short, series} where series is the
// series name from the title ("... | Animal Friends with Venu & Vena | Episode 6").
export function parseFeed(xml) {
  const out = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const full = decode((entry.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    const published = ((entry.match(/<published>([^<]+)<\/published>/) || [])[1] || '').slice(0, 10);
    if (!id || !VIDEO_ID.test(id)) continue;
    const short = /#shorts/i.test(full);
    const parts = full.replace(/\s*#shorts\b/i, '').split(' | ');
    const series = (parts.find((p) => p.endsWith(' with Venu & Vena')) || '').replace(' with Venu & Vena', '');
    out.push({ id, title: parts[0].trim(), published, short, series });
  }
  return out;
}

// The newest public episode in the feed (Shorts and the trailer left out), or null.
export function newestFromFeed(xml) {
  const v = parseFeed(xml).find((e) => !e.short && e.series);
  return v ? { id: v.id, title: v.title, series: v.series, published: v.published } : null;
}

// What the feed has that the built catalogue does not: new episodes per series slug, new Shorts.
export function additions(entries, catalogue) {
  const known = new Set();
  for (const s of catalogue.series) for (const e of s.episodes) known.add(e.id);
  for (const e of catalogue.shorts) known.add(e.id);
  for (const k of ['full_show', 'trailer']) if (catalogue[k]) known.add(catalogue[k].id);
  const slugOf = Object.fromEntries(catalogue.series.map((s) => [s.name, s.slug]));
  const series = {};
  const shorts = [];
  for (const e of [...entries].reverse()) {  // oldest first, so new episodes keep playlist order
    if (known.has(e.id)) continue;
    if (e.short) shorts.unshift(e);
    else if (slugOf[e.series]) (series[slugOf[e.series]] ||= []).push({ ...e, slug: slugOf[e.series] });
  }
  return { series, shorts };
}

async function latest(env, request) {
  try {
    const [feed, data] = await Promise.all([
      // FEED_URL is only for local testing (.dev.vars); the live site always reads YouTube.
      fetch(env.FEED_URL || FEED, { cf: { cacheTtl: 1800, cacheEverything: true } }),
      env.ASSETS.fetch(new Request(new URL('/data/videos.json', request.url))),
    ]);
    if (!feed.ok || !data.ok) return null;
    const entries = parseFeed(await feed.text());
    const catalogue = await data.json();
    return { entries, catalogue, added: additions(entries, catalogue) };
  } catch {
    return null;
  }
}

async function withLatest(page, env, request) {
  const live = await latest(env, request);
  if (!live) return page;
  const { catalogue, added } = live;
  const newest = live.entries.find((e) => !e.short && e.series);
  const counts = Object.fromEntries(
    catalogue.series.map((s) => [s.slug, s.episodes.length + (added.series[s.slug] || []).length]),
  );
  let stale = false;
  return new HTMLRewriter()
    // Home: the newest-episode card, only when the feed has something newer than the build.
    .on('[data-newest]', {
      element(el) {
        stale = !!newest && el.getAttribute('data-newest') !== newest.id && newest.published >= (el.getAttribute('data-published') || '');
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
        if (stale) el.setInnerContent(newest.series);
      },
    })
    // Home tiles and Videos headings: episode counts.
    .on('[data-count]', {
      element(el) {
        const slug = el.getAttribute('data-count');
        if (slug in counts && (added.series[slug] || []).length) el.setInnerContent(count(counts[slug]));
      },
    })
    // Videos: new cards at the end of their series row, new Shorts at the front.
    .on('[data-row]', {
      element(el) {
        const slug = el.getAttribute('data-row');
        if (slug === 'shorts') {
          if (added.shorts.length) el.prepend(added.shorts.map(shortCard).join('\n'), { html: true });
        } else if ((added.series[slug] || []).length) {
          el.append(added.series[slug].map(episodeCard).join('\n'), { html: true });
        }
      },
    })
    .on('[data-empty]', {
      element(el) {
        if ((added.series[el.getAttribute('data-empty')] || []).length) el.remove();
      },
    })
    .transform(page);
}

