// Checks the built site (run `npm run check`, which builds first):
//  1. no page loads anything from another site (scripts, styles, images, fonts, frames);
//     plain links out (<a href>) are fine
//  2. every page has a title, a description and one <h1>
//  3. the Worker picks the newest episode from the channel feed correctly
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { additions, newestFromFeed, parseFeed } from '../src/worker.js';

const DIST = new URL('../dist/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let problems = 0;
const fail = (msg) => { problems++; console.error('FAIL', msg); };

for (const file of walk(DIST)) {
  if (file.endsWith('.html')) {
    const html = readFileSync(file, 'utf8');
    const rel = file.slice(DIST.length);
    for (const m of html.matchAll(/<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*?\b(src|href|srcset|data)="([^"]+)"/gi)) {
      if (/rel="canonical"/.test(m[0])) continue; // the page's own address, not a download
      if (/^(https?:)?\/\//i.test(m[3])) fail(`${rel}: <${m[1]}> loads ${m[3]}`);
    }
    if (/style="/i.test(html) || /<style\b/i.test(html)) fail(`${rel}: inline styles are blocked by the security policy`);
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(`${rel}: inline scripts are blocked by the security policy`);
    if (rel.startsWith('studio/')) continue; // the old app pages, kept unchanged
    if (!/<title>[^<]+<\/title>/.test(html)) fail(`${rel}: no <title>`);
    if (!/<meta name="description" content="[^"]+">/.test(html)) fail(`${rel}: no description`);
    if ((html.match(/<h1\b/g) || []).length !== 1) fail(`${rel}: needs exactly one <h1>`);
  }
  if (file.endsWith('.css')) {
    const css = readFileSync(file, 'utf8');
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)/g)) {
      if (/^(https?:)?\/\//i.test(m[1])) fail(`${file}: loads ${m[1]}`);
    }
    if (/@import/.test(css)) fail(`${file}: @import`);
  }
}

const feed = `<feed><entry><yt:videoId>AAAAAAAAAAA</yt:videoId><title>Hop! | Venu &amp; Vena #Shorts</title><published>2026-11-25T06:30:00+00:00</published></entry>
<entry><yt:videoId>4tEcUF1olMw</yt:videoId><title>Bug Hunt: Garden Bugs for Kids | Animal Friends with Venu &amp; Vena | Episode 6</title><published>2026-11-24T11:30:00+00:00</published></entry></feed>`;
assert.deepEqual(newestFromFeed(feed), {
  id: '4tEcUF1olMw', title: 'Bug Hunt: Garden Bugs for Kids', series: 'Animal Friends', published: '2026-11-24',
});
assert.equal(newestFromFeed('<feed></feed>'), null);
const catalogue = { series: [{ slug: 'animal-friends', name: 'Animal Friends', episodes: [] }], shorts: [] };
const added = additions(parseFeed(feed), catalogue);
assert.deepEqual(added.series['animal-friends'].map((e) => e.id), ['4tEcUF1olMw']);
assert.deepEqual(added.shorts.map((e) => e.id), ['AAAAAAAAAAA']);
catalogue.series[0].episodes.push({ id: '4tEcUF1olMw' });
assert.equal(additions(parseFeed(feed), catalogue).series['animal-friends'], undefined);

if (problems) process.exit(1);
console.log('check passed');
