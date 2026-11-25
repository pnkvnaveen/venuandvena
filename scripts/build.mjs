// Builds the site into dist/ from site/. No dependencies: plain Node.
//
//   site/layout.html        the shared page: header, footer, {{content}}
//   site/pages/**.html      one file per page; a comment at the top sets its title and menu
//   site/data/videos.json   the channel's public videos (tools/sync_videos.py)
//   site/css, js, img, fonts, _headers, robots.txt   copied as they are
//
// A page file at pages/about.html is served at /about, pages/echopals/privacy.html at
// /echopals/privacy. A page whose header says "layout: none" is copied unchanged.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'dist');
const videos = JSON.parse(readFileSync(join(SITE, 'data', 'videos.json'), 'utf8'));
const CHANNEL_URL = 'https://www.youtube.com/@venuandvena';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------- series look

// Each series gets a cut-paper tile: a colour and a big shape or glyph.
const SERIES_LOOK = {
  alphabet: { color: 'red', glyph: '<span class="glyph">A</span>' },
  numbers: { color: 'sky', glyph: '<span class="glyph">1</span>' },
  'number-games': { color: 'sun', glyph: '<span class="glyph glyph-sm">1+2</span>' },
  colours: {
    color: 'paper',
    glyph:
      '<svg class="glyph-svg" viewBox="0 0 120 80" aria-hidden="true"><circle cx="34" cy="44" r="24" fill="#DE5446"/><circle cx="62" cy="30" r="22" fill="#FAC450"/><circle cx="88" cy="48" r="22" fill="#4F8FC0"/></svg>',
  },
  shapes: {
    color: 'grass',
    glyph:
      '<svg class="glyph-svg" viewBox="0 0 120 80" aria-hidden="true"><path d="M8 70 L32 22 L56 70 Z" fill="#FFF7E6"/><circle cx="78" cy="30" r="18" fill="#FFF7E6"/><rect x="66" y="52" width="40" height="22" rx="3" fill="#FFF7E6"/></svg>',
  },
  'animal-friends': {
    color: 'venu',
    glyph:
      '<svg class="glyph-svg" viewBox="0 0 120 80" aria-hidden="true"><g fill="#FFF7E6"><ellipse cx="60" cy="52" rx="20" ry="17"/><ellipse cx="34" cy="34" rx="8" ry="11"/><ellipse cx="50" cy="20" rx="8" ry="11"/><ellipse cx="70" cy="20" rx="8" ry="11"/><ellipse cx="86" cy="34" rx="8" ry="11"/></g></svg>',
  },
  'abc-words': { color: 'vena', glyph: '<span class="glyph glyph-sm">abc</span>' },
};

const playlistUrl = (id) => `https://www.youtube.com/playlist?list=${id}`;
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// A video that plays on the page after a tap. Without JavaScript it is a plain link to YouTube.
function player(v, { size = 'm', label = v.title, lazy = true } = {}) {
  return `<div class="player">
  <a class="player-link" href="${watchUrl(v.id)}" data-yt="${esc(v.id)}" aria-label="Play ${esc(label)}">
    <img src="/thumb/${esc(v.id)}/${size}"${
      size === 'l' ? ` srcset="/thumb/${esc(v.id)}/m 320w, /thumb/${esc(v.id)}/h 640w, /thumb/${esc(v.id)}/l 1280w" sizes="(min-width: 900px) 620px, calc(100vw - 52px)"` : ''
    } alt="" width="${size === 'l' ? 1280 : 320}" height="${size === 'l' ? 720 : 180}"${lazy ? ' loading="lazy"' : ''} decoding="async">
    <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg></span>
  </a>
</div>`;
}

const BLOCKS = {
  newest() {
    const v = videos.newest;
    if (!v) return '';
    const s = videos.series.find((x) => x.slug === v.series);
    return `<article class="newest card" data-newest="${esc(v.id)}" data-published="${esc(v.published)}">
  ${player(v, { size: 'l', lazy: false })}
  <div class="newest-text">
    <p class="eyebrow" data-newest-series>${esc(s ? s.name : '')}</p>
    <h3 data-newest-title>${esc(v.title)}</h3>
  </div>
</article>`;
  },
  'series-tiles'() {
    return `<ul class="tiles" role="list">
${videos.series
  .map((s) => {
    const look = SERIES_LOOK[s.slug] || { color: 'paper', glyph: '' };
    const n = s.episodes.length;
    const count = n ? `${n} episode${n === 1 ? '' : 's'}` : 'Coming soon';
    return `  <li><a class="tile tile-${look.color}" href="/videos#${s.slug}">
    <span class="tile-art" aria-hidden="true">${look.glyph}</span>
    <span class="tile-name">${esc(s.name)}</span>
    <span class="tile-count">${count}</span>
  </a></li>`;
  })
  .join('\n')}${
  videos.full_show
    ? `
  <li><a class="tile tile-paper" href="/videos#full-show">
    <span class="tile-art" aria-hidden="true"><span class="glyph glyph-sm ink">A to Z</span></span>
    <span class="tile-name">The full A to Z show</span>
    <span class="tile-count">${videos.full_show.minutes} minutes</span>
  </a></li>`
    : ''
}
</ul>`;
  },
  'channel-url': () => CHANNEL_URL,
};

// ---------------------------------------------------------------- pages

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function meta(src) {
  const m = src.match(/^<!--([\s\S]*?)-->\s*/);
  const out = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta: out, body: m ? src.slice(m[0].length) : src };
}

function fill(text, vars) {
  return text.replace(/\{\{\s*([\w:-]+)\s*\}\}/g, (all, key) => {
    if (key in vars) return vars[key];
    if (key in BLOCKS) return BLOCKS[key]();
    throw new Error(`Unknown {{${key}}}`);
  });
}

function hash(file) {
  return createHash('sha256').update(readFileSync(join(SITE, file))).digest('hex').slice(0, 10);
}

export function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const d of ['css', 'js', 'img', 'fonts', 'studio']) cpSync(join(SITE, d), join(OUT, d), { recursive: true });
  for (const f of ['_headers', 'robots.txt']) cpSync(join(SITE, f), join(OUT, f));
  cpSync(join(SITE, 'img', 'favicon.png'), join(OUT, 'favicon.png'));

  const layout = readFileSync(join(SITE, 'layout.html'), 'utf8');
  const version = { css: hash('css/site.css'), js: hash('js/site.js') };
  const pages = walk(join(SITE, 'pages')).filter((p) => p.endsWith('.html'));
  for (const file of pages) {
    const rel = relative(join(SITE, 'pages'), file);
    const { meta: m, body } = meta(readFileSync(file, 'utf8'));
    let html;
    if (m.layout === 'none') {
      html = body;
    } else {
      const path = '/' + rel.replace(/\.html$/, '').replace(/(^|\/)index$/, '');
      const vars = {
        title: esc(m.title ? `${m.title} · Venu & Vena` : 'Venu & Vena: little adventures, big discoveries'),
        description: esc(m.description || ''),
        path: path === '/' ? '/' : path.replace(/\/$/, ''),
        'body-class': esc(m.class || ''),
        'css-version': version.css,
        'js-version': version.js,
        year: String(new Date().getFullYear()),
      };
      for (const item of ['videos', 'apps', 'about', 'feedback']) {
        vars[`nav:${item}`] = m.nav === item ? ' aria-current="page"' : '';
      }
      vars.content = fill(body, vars);
      html = fill(layout, vars);
    }
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
  }
  console.log(`built ${pages.length} pages into dist/`);
}

build();
