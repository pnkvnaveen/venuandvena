// The HTML for a video, shared by the build (scripts/build.mjs) and the Worker (src/worker.js),
// so a card the Worker adds for a just-published episode looks the same as a built one.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
export const playlistUrl = (id) => `https://www.youtube.com/playlist?list=${id}`;
export const CHANNEL_URL = 'https://www.youtube.com/@venuandvena';

const PLAY = '<span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg></span>';

// A video that plays on the page after a tap. Without JavaScript it is a plain link to YouTube.
// size: m (small 16:9 card), l (big 16:9, with smaller copies for phones), s (tall Short).
export function player(v, { size = 'm', label = v.title, lazy = true } = {}) {
  const id = esc(v.id);
  const dims = { m: [320, 180], l: [1280, 720], s: [405, 720] }[size];
  const srcset =
    size === 'l'
      ? ` srcset="/thumb/${id}/m 320w, /thumb/${id}/h 640w, /thumb/${id}/l 1280w" sizes="(min-width: 900px) 620px, calc(100vw - 52px)"`
      : '';
  return `<div class="player${size === 's' ? ' tall' : ''}${size === 'l' ? '' : ' small'}">
  <a class="player-link" href="${watchUrl(v.id)}" data-yt="${id}" aria-label="Play ${esc(label)}">
    <img src="/thumb/${id}/${size}"${srcset} alt="" width="${dims[0]}" height="${dims[1]}"${lazy ? ' loading="lazy"' : ''} decoding="async">
    ${PLAY}
  </a>
</div>`;
}

export function minutes(n) {
  return n >= 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`;
}

export function episodeCard(v) {
  return `<li class="ep" data-id="${esc(v.id)}">
  ${player(v)}
  <p class="ep-title">${esc(v.title)}</p>${v.minutes ? `\n  <p class="ep-meta">${minutes(v.minutes)}</p>` : ''}
</li>`;
}

export function shortCard(v) {
  return `<li class="ep short" data-id="${esc(v.id)}">
  ${player(v, { size: 's' })}
  <p class="ep-title">${esc(v.title)}</p>
</li>`;
}

export function count(n) {
  return n ? `${n} episode${n === 1 ? '' : 's'}` : 'Coming soon';
}
