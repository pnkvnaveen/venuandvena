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
import { CHANNEL_URL, count, episodeCard, esc, minutes, player, playlistUrl, shortCard } from '../src/cards.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'dist');
const videos = JSON.parse(readFileSync(join(SITE, 'data', 'videos.json'), 'utf8'));

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
    return `  <li><a class="tile tile-${look.color}" href="/videos#${s.slug}">
    <span class="tile-art" aria-hidden="true">${look.glyph}</span>
    <span class="tile-name">${esc(s.name)}</span>
    <span class="tile-count" data-count="${esc(s.slug)}">${count(s.episodes.length)}</span>
  </a></li>`;
  })
  .join('\n')}${
  videos.full_show
    ? `
  <li><a class="tile tile-paper" href="/videos#full-show">
    <span class="tile-art" aria-hidden="true"><span class="glyph glyph-sm ink">A to Z</span></span>
    <span class="tile-name">The full A to Z show</span>
    <span class="tile-count">${minutes(videos.full_show.minutes)}</span>
  </a></li>`
    : ''
}
</ul>`;
  },
  'channel-url': () => CHANNEL_URL,
  'series-chips'() {
    const chips = videos.series.map((s) => `<a href="#${esc(s.slug)}">${esc(s.name)}</a>`);
    if (videos.full_show) chips.push('<a href="#full-show">A to Z show</a>');
    chips.push('<a href="#shorts">Shorts</a>');
    return `<nav class="chips" aria-label="Series">${chips.join('')}</nav>`;
  },
  'series-rows'() {
    return videos.series
      .map((s) => {
        const look = SERIES_LOOK[s.slug] || { color: 'paper' };
        return `<section class="series" id="${esc(s.slug)}" aria-labelledby="h-${esc(s.slug)}">
  <div class="series-head">
    <span class="series-badge tile-${look.color}" aria-hidden="true"></span>
    <div>
      <h2 id="h-${esc(s.slug)}">${esc(s.name)}</h2>
      <p class="series-blurb">${esc(s.blurb)} <span class="series-count" data-count="${esc(s.slug)}">${count(s.episodes.length)}</span></p>
    </div>
  </div>
  <ul class="row" role="list" data-row="${esc(s.slug)}">
${s.episodes.map(episodeCard).join('\n')}
  </ul>${s.episodes.length ? '' : `\n  <p class="row-empty" data-empty="${esc(s.slug)}">New episodes are on their way. Follow the channel to see them first.</p>`}
  <p class="more"><a href="${playlistUrl(s.playlist)}">Open ${esc(s.name)} on YouTube</a></p>
</section>`;
      })
      .join('\n');
  },
  'full-show'() {
    const v = videos.full_show;
    if (!v) return '';
    return `<section class="series" id="full-show" aria-labelledby="h-full-show">
  <h2 id="h-full-show">The full A to Z show</h2>
  <p class="series-blurb">All 26 letters in one show, ${minutes(v.minutes)} long. Good for a quiet afternoon together.</p>
  <article class="newest card">
    ${player(v, { size: 'l', label: 'the full A to Z show' })}
    <div class="newest-text"><h3>${esc(v.title)}</h3></div>
  </article>
</section>`;
  },
  shorts() {
    return `<section class="series" id="shorts" aria-labelledby="h-shorts">
  <h2 id="h-shorts">Shorts</h2>
  <p class="series-blurb">One-minute moments from the episodes, made for phones.</p>
  <ul class="row row-tall" role="list" data-row="shorts">
${videos.shorts.map(shortCard).join('\n')}
  </ul>
  <p class="more"><a href="${CHANNEL_URL}/shorts">All Shorts on YouTube</a></p>
</section>`;
  },
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
  mkdirSync(join(OUT, 'data'), { recursive: true });
  cpSync(join(SITE, 'data', 'videos.json'), join(OUT, 'data', 'videos.json'));
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
