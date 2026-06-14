// Home view: Spotify-style landing — greeting, quick actions, shelves built from
// the local library, plus Spotify-powered playlists when connected.
// (The "New releases" shelf was removed: Spotify's Feb 2026 dev-mode migration
// deleted /browse/new-releases with no replacement.)
import { state, setSettings, songGenres, emit } from './store.js';
import { $, esc } from './utils.js';
import { toast } from './ui.js';
import * as auth from './auth.js';
import * as lib from './library.js';
import * as player from './player.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ---------- tiles ----------
function songTile(s) {
  const playing = s.uri && player.nowPlayingUri() === s.uri;
  return `<div class="h-tile" data-hid="${esc(s.id)}" role="button" tabindex="0"
      aria-label="${esc(s.name)} by ${esc(s.artists.map(a => a.name).join(', '))}">
    ${s.album.imgLg || s.album.img
      ? `<img class="art" src="${esc(s.album.imgLg || s.album.img)}" alt="" loading="lazy">`
      : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
    ${s.uri ? `<button class="btn-icon h-play${playing ? ' is-playing' : ''}" data-h-play="${esc(s.id)}" aria-label="${playing ? 'Pause' : 'Play'} ${esc(s.name)}"><svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg></button>` : ''}
    <div class="h-name">${esc(s.name)}</div>
    <div class="h-sub">${esc(s.artists[0]?.name || '')}</div>
    ${s.rating != null ? `<span class="rating-in has-val h-rate" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>` : ''}
  </div>`;
}

function artistTile(name, count, avg) {
  return `<div class="h-tile h-artist" data-h-artist="${esc(name)}" role="button" tabindex="0" aria-label="Browse ${esc(name)}">
    <span class="h-avatar" style="--ah:${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 360}">${esc(name.slice(0, 2).toUpperCase())}</span>
    <div class="h-name">${esc(name)}</div>
    <div class="h-sub">${count} song${count === 1 ? '' : 's'}${avg != null ? ` · avg ${avg}` : ''}</div>
  </div>`;
}

function shelf(title, inner, hint = '') {
  if (!inner) return '';
  return `<section class="h-shelf">
    <header><h3>${title}</h3>${hint ? `<span class="hint">${hint}</span>` : ''}</header>
    <div class="h-row">${inner}</div>
  </section>`;
}

// ---------- data slices ----------
const allSongs = () => state.order.map(id => state.songs[id]).filter(Boolean);

function topArtists(songs, n = 12) {
  const map = {};
  for (const s of songs) {
    const name = s.artists[0]?.name;
    if (!name) continue;
    (map[name] = map[name] || { count: 0, ratings: [] }).count++;
    if (s.rating != null) map[name].ratings.push(s.rating);
  }
  return Object.entries(map).sort((a, b) => b[1].count - a[1].count).slice(0, n)
    .map(([name, d]) => [name, d.count, d.ratings.length ? Math.round(d.ratings.reduce((a, r) => a + r, 0) / d.ratings.length) : null]);
}

// ---------- render ----------
export function render() {
  const root = $('#view');
  const songs = allSongs();
  const rated = songs.filter(s => s.rating != null);
  const unrated = songs.length - rated.length;
  const avg = rated.length ? Math.round(rated.reduce((a, s) => a + s.rating, 0) / rated.length) : null;

  if (!songs.length) {
    root.innerHTML = `<div class="h-home"><div class="h-hero">
      <h2>${greeting()} 👋</h2>
      <p class="hint">Your library is empty — connect Spotify and import some music, or explore with sample data.</p>
      <div class="empty-actions">
        <button class="btn btn-spotify" data-es="connect"><svg><use href="#i-spotify"/></svg>Connect Spotify</button>
        <button class="btn btn-primary" data-es="import"><svg><use href="#i-download"/></svg>Import music</button>
        <button class="btn" data-es="sample">Load sample data</button>
      </div></div></div>`;
    return;
  }

  const recent = [...songs].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '')).slice(0, 12);
  const best = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 12);
  const rising = [...rated].filter(s => s.ratedAt).sort((a, b) => b.ratedAt.localeCompare(a.ratedAt)).slice(0, 12);
  const genres = {};
  for (const s of songs) for (const g of songGenres(s)) if (g !== 'Unknown genre') genres[g] = (genres[g] || 0) + 1;
  const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const pls = state.spotifyPlaylists || [];
  const plShelf = pls.length ? pls.slice(0, 12).map(p => `
    <div class="h-tile" data-h-pl="${esc(p.id)}" role="button" tabindex="0" aria-label="Open playlist ${esc(p.name)}">
      ${p.img ? `<img class="art" src="${esc(p.img)}" alt="" loading="lazy">` : '<span class="art art-ph"><svg><use href="#i-playlist"/></svg></span>'}
      <div class="h-name">${esc(p.name)}</div>
      <div class="h-sub">${p.total ?? '?'} tracks</div>
    </div>`).join('') : '';

  root.innerHTML = `<div class="h-home">
    <div class="h-hero">
      <h2>${greeting()}${auth.getProfile()?.display_name ? ', ' + esc(auth.getProfile().display_name.split(' ')[0]) : ''} 👋</h2>
      <div class="h-stats">
        <span class="h-stat"><b>${songs.length}</b> songs</span>
        <span class="h-stat"><b>${rated.length}</b> rated</span>
        ${avg != null ? `<span class="h-stat"><b>${avg}</b> avg rating</span>` : ''}
        <span class="h-stat"><b>${state.groups.length}</b> groups</span>
      </div>
    </div>
    <div class="h-actions">
      <button class="h-action" data-h-act="faceoff"><svg><use href="#i-zap"/></svg><span><b>Face-off</b><i>Settle a battle</i></span></button>
      <button class="h-action" data-h-act="import"><svg><use href="#i-download"/></svg><span><b>Import</b><i>Bring in more music</i></span></button>
      ${unrated ? `<button class="h-action" data-h-act="backlog"><svg><use href="#i-edit"/></svg><span><b>Rate backlog</b><i>${unrated} unrated</i></span></button>` : ''}
      <button class="h-action" data-h-act="shuffle"><svg><use href="#i-music"/></svg><span><b>Surprise me</b><i>Random pick</i></span></button>
    </div>
    ${topGenres.length ? `<div class="h-genres">${topGenres.map(([g, n]) => `<button class="chip h-genre" data-h-genre="${esc(g)}">${esc(g)} <span class="hint">${n}</span></button>`).join('')}</div>` : ''}
    ${shelf('Jump back in', recent.map(songTile).join(''), 'recently added')}
    ${rising.length >= 3 ? shelf('On the rise', rising.map(songTile).join(''), 'recently rated') : ''}
    ${best.length ? shelf('Your top songs', best.map(songTile).join('')) : ''}
    ${shelf('Your artists', topArtists(songs).map(a => artistTile(...a)).join(''))}
    ${plShelf ? shelf('Your playlists', plShelf, 'from Spotify') : ''}
  </div>`;
}

// ---------- events (bound once) ----------
export function init() {
  const root = $('#view');
  root.addEventListener('click', e => {
    if (state.settings.view !== 'home') return;
    const play = e.target.closest('[data-h-play]');
    if (play) {
      e.stopPropagation();
      const s = state.songs[play.dataset.hPlay];
      if (!s?.uri) return;
      if (player.currentUri() === s.uri) player.toggle();
      else player.playList([s], 0).catch(err => toast(err.message, 'err'));
      return;
    }
    const tile = e.target.closest('[data-hid]');
    if (tile) { emit('song-detail', tile.dataset.hid); return; }
    const artist = e.target.closest('[data-h-artist]');
    if (artist) { setSettings({ view: 'library', groupMode: 'none', search: artist.dataset.hArtist }); return; }
    const genre = e.target.closest('[data-h-genre]');
    if (genre) { setSettings({ view: 'library', groupMode: 'genre', search: '' }); requestAnimationFrame(() => $(`[data-bucket="genre:${CSS.escape(genre.dataset.hGenre)}"]`)?.scrollIntoView({ block: 'start' })); return; }
    const pl = e.target.closest('[data-h-pl]');
    if (pl) { emit('open-playlist', pl.dataset.hPl); return; }
    const album = e.target.closest('[data-h-album]');
    if (album) {
      album.classList.add('is-busy');
      lib.importAlbum(album.dataset.hAlbum)
        .then(r => toast(`${album.dataset.n}: ${r.added} added, ${r.skipped} already in library`, 'ok'))
        .catch(err => toast(err.message, 'err'))
        .finally(() => album.classList.remove('is-busy'));
      return;
    }
    const act = e.target.closest('[data-h-act]');
    if (act) {
      const a = act.dataset.hAct;
      if (a === 'faceoff') setSettings({ view: 'faceoff' });
      if (a === 'import') emit('empty-action', 'import');
      if (a === 'backlog') setSettings({ view: 'library', ratedFilter: 'unrated', groupMode: 'none' });
      if (a === 'shuffle') {
        const ids = Object.keys(state.songs);
        if (ids.length) emit('song-detail', ids[Math.floor(Math.random() * ids.length)]);
      }
    }
  });
  root.addEventListener('keydown', e => {
    if (state.settings.view !== 'home') return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-hid], [data-h-artist], [data-h-pl], [data-h-album]')) {
      e.preventDefault();
      e.target.click();
    }
  });
}
