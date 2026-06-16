// Global Spotify catalog search. Find ANY track and play it or queue it WITHOUT
// importing it into the library — "+ Library" is the only action that ingests.
// Keeps results in memory and converts to app records on demand so playback
// never pollutes the user's library (the whole point of this surface).
import { searchTracks } from './api.js';
import { normalizeTrack, importSearchResults } from './library.js';
import * as player from './player.js';
import { openModal, toast } from './ui.js';
import { esc, fmtMs, debounce } from './utils.js';

const cache = new Map();   // lowercased query -> raw track[] (session-only)
let results = [];          // raw tracks backing the current render

export function openCatalogSearch() {
  const m = openModal(`
    <div class="cat-search">
      <input type="search" id="cat-q" class="input" autofocus autocomplete="off"
        placeholder="Search all of Spotify…" aria-label="Search Spotify catalog">
      <ul id="cat-results" class="cat-list" aria-live="polite"></ul>
    </div>`, { title: 'Search Spotify', wide: true });

  const input = m.root.querySelector('#cat-q');
  const list = m.root.querySelector('#cat-results');
  let token = 0;            // drops stale responses when typing fast

  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { results = []; list.innerHTML = ''; return; }
    const mine = ++token;
    list.innerHTML = '<li class="cat-hint">Searching…</li>';
    try {
      let raw = cache.get(q.toLowerCase());
      if (!raw) { raw = await searchTracks(q, 20); cache.set(q.toLowerCase(), raw); }
      if (mine !== token) return;                 // a newer query superseded this one
      results = raw;
      render(list);
    } catch (e) {
      if (mine !== token) return;
      list.innerHTML = `<li class="cat-hint">${esc(e.message || 'Search failed')}</li>`;
    }
  }, 300);

  input.addEventListener('input', run);
  list.addEventListener('click', onAction);
}

function render(list) {
  if (!results.length) { list.innerHTML = '<li class="cat-hint">No tracks found</li>'; return; }
  list.innerHTML = results.map((t, i) => {
    const imgs = t.album?.images || [];
    const art = imgs[imgs.length - 1]?.url || '';
    const artists = (t.artists || []).map(a => a.name).join(', ');
    return `<li class="cat-row" data-i="${i}">
      ${art ? `<img class="cat-art" src="${esc(art)}" alt="">` : '<span class="cat-art cat-art-ph"></span>'}
      <span class="cat-meta"><span class="cat-name">${esc(t.name)}</span>
        <span class="cat-sub">${esc(artists)}</span></span>
      <span class="cat-dur">${fmtMs(t.duration_ms || 0)}</span>
      <button class="btn-icon sm" data-act="play" title="Play" aria-label="Play"><svg><use href="#i-play"/></svg></button>
      <button class="btn-icon sm" data-act="queue" title="Add to queue" aria-label="Add to queue"><svg><use href="#i-queue"/></svg></button>
      <button class="btn-icon sm" data-act="lib" title="Add to library" aria-label="Add to library"><svg><use href="#i-plus"/></svg></button>
    </li>`;
  }).join('');
}

async function onAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const raw = results[+btn.closest('[data-i]').dataset.i];
  if (!raw) return;
  try {
    if (btn.dataset.act === 'play') {
      // Play the whole result set as a queue, starting from the clicked track.
      const recs = results.map(t => normalizeTrack(t)).filter(Boolean);
      const idx = recs.findIndex(r => r.id === raw.id);
      await player.playList(recs, Math.max(0, idx));
      toast('Playing ' + raw.name, 'ok');
    } else if (btn.dataset.act === 'queue') {
      await player.enqueue(normalizeTrack(raw));
      toast('Added to queue', 'ok');
    } else if (btn.dataset.act === 'lib') {
      const r = importSearchResults([raw]);
      toast(r.added ? 'Added to library' : 'Already in library', r.added ? 'ok' : 'info');
    }
  } catch (err) {
    toast(err.message, 'err', 5000);
  }
}
