// Tap to play: a video shows our own copy of its thumbnail, and the YouTube player
// (youtube-nocookie.com) loads only when someone taps it. Without this script the
// thumbnail is a plain link to the video on YouTube.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-yt]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const id = link.dataset.yt;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
  event.preventDefault();
  const frame = document.createElement('iframe');
  frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
  frame.title = link.getAttribute('aria-label') || 'Video';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  link.replaceWith(frame);
  frame.focus();
});
