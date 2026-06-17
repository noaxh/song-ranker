// Playlist Overview view (Stage B, items 3 + 4 unified). Clicking any playlist —
// a Spotify playlist, an imported group, or a virtual feed (Liked / Recently
// played) — opens this full view instead of force-importing. Tracks resolve to
// app records (never ingested); Play streams, only "Import" ingests.
// Design: Spotify skeleton, Apple polish — see docs/playlist-overview-wireframe.svg.
import { state, setSettings } from './store.js';
import { $, esc, fmtMs, hashHue, announce } from './utils.js';
import * as api from './api.js';
import * as lib from './library.js';
import * as player from './player.js';
import * as auth from './auth.js';
import { ctxMenu, toast } from './ui.js';

// Cache the last resolved target so player/settings re-renders don't refetch.
let cacheKey = null;            // `${type}:${id}`
let cacheData = null;           // { records, raws }
let loadToken = 0;              // drops stale fetch responses

const keyOf = t => `${t.type}:${t.id || ''}`;

// ---------- track resolution ----------
async function resolve(target) {
  if (target.type === 'group') {
    const g = state.groups.find(x => x.id === target.id);
    const records = (g?.songIds || []).map(id => state.songs[id]).filter(s => s?.uri);
    return { records, raws: records };          // group entries are already records
  }
  let items = [];
  if (target.type === 'spotify') items = await api.getPlaylistItems(target.id);
  else if (target.type === 'liked') items = await api.getLikedTracks({ maxItems: 200 });
  else if (target.type === 'recent') items = (await api.getRecentlyPlayed())?.items || [];

  const seen = new Set();
  const records = [], raws = [];
  for (const it of items) {
    const raw = it?.item ?? it?.track;
    const at = it?.added_at ?? it?.played_at;
    const rec = lib.normalizeTrack(raw, at);
    if (!rec) continue;                          // podcast / local → dropped
    if (target.type === 'recent') {              // replays repeat — dedupe by uri
      if (seen.has(rec.uri)) continue;
      seen.add(rec.uri);
    }
    records.push(rec); raws.push(raw);
  }
  return { records, raws };
}

// ---------- formatters ----------
function fmtTotal(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h} hr ${m} min`;
}
function fmtDate(iso) {
  const d = Date.parse(iso);
  if (!d) return '';
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

const KIND_LABEL = { spotify: 'Playlist', group: 'Group', liked: 'Playlist', recent: 'Recently played' };

// ---------- markup ----------
function artHtml(target, hue) {
  if (target.type === 'liked') return `<div class="pl-art pl-art-liked"><svg><use href="#i-heart"/></svg></div>`;
  if (target.type === 'recent') return `<div class="pl-art pl-art-recent"><svg><use href="#i-refresh"/></svg></div>`;
  if (target.img) return `<img class="pl-art" src="${esc(target.img)}" alt="">`;
  return `<div class="pl-art pl-art-gen" style="--h:${hue}"><svg><use href="#i-music"/></svg></div>`;
}

function heroHtml(target, records) {
  const hue = hashHue(target.name || target.id || target.type);
  const total = records.reduce((a, s) => a + (s.durationMs || 0), 0);
  const p = auth.getProfile();
  const owner = p?.display_name || '';
  const meta = [
    owner ? `<span class="pl-owner"><span class="pl-avatar" style="--h:${hashHue(owner)}">${esc(owner.slice(0, 1).toUpperCase())}</span>${esc(owner)}</span>` : '',
    `${records.length} song${records.length === 1 ? '' : 's'}`,
    total ? fmtTotal(total) : '',
  ].filter(Boolean).join(' <span class="pl-dot">·</span> ');
  return `<div class="pl-hero" style="--pl-h:${hue}">
    <button class="pl-back" data-pl-back aria-label="Back"><svg><use href="#i-chevron"/></svg></button>
    ${artHtml(target, hue)}
    <div class="pl-hero-text">
      <span class="pl-eyebrow">${esc(KIND_LABEL[target.type] || 'Playlist')}</span>
      <h2 class="pl-title">${esc(target.name || 'Playlist')}</h2>
      <div class="pl-meta">${meta}</div>
    </div>
  </div>`;
}

function actionsHtml(target, hasTracks) {
  const importBtn = target.type === 'spotify'
    ? `<button class="btn sm pl-import" data-pl-import aria-label="Import to library"><svg><use href="#i-download"/></svg>Import</button>`
    : target.type === 'liked'
      ? `<button class="btn sm pl-import" data-pl-import aria-label="Import all to library"><svg><use href="#i-download"/></svg>Import all</button>`
      : '';
  return `<div class="pl-actions">
    <button class="pl-play-big" data-pl-play aria-label="Play" ${hasTracks ? '' : 'disabled'}><svg><use href="#i-play"/></svg></button>
    <button class="btn-icon pl-shuffle" data-pl-shuffle aria-label="Shuffle play" title="Shuffle" ${hasTracks ? '' : 'disabled'}><svg><use href="#i-shuffle"/></svg></button>
    ${importBtn}
    <span class="pl-spacer"></span>
  </div>`;
}

function rowsHtml(records) {
  if (!records.length) return `<div class="pl-empty">Nothing here yet.</div>`;
  const cur = player.currentUri();
  return records.map((s, i) => {
    const playing = s.uri && cur === s.uri;
    const artists = s.artists.map(a => a.name).join(', ');
    return `<div class="pl-row${playing ? ' is-playing' : ''}" data-i="${i}" role="button" tabindex="0"
        aria-label="Play ${esc(s.name)} by ${esc(artists)}">
      <span class="pl-ix"><span class="pl-num">${i + 1}</span><svg class="pl-rowplay"><use href="#i-play"/></svg></span>
      ${s.album.img || s.album.imgLg
        ? `<img class="pl-thumb" src="${esc(s.album.img || s.album.imgLg)}" alt="" loading="lazy">`
        : '<span class="pl-thumb pl-thumb-ph"><svg><use href="#i-music"/></svg></span>'}
      <span class="pl-c pl-cm-title"><span class="pl-name">${esc(s.name)}</span><span class="pl-sub">${esc(artists)}</span></span>
      <span class="pl-c pl-cm-album">${esc(s.album.name)}</span>
      <span class="pl-c pl-cm-date">${esc(fmtDate(s.addedAt))}</span>
      <span class="pl-c pl-cm-dur">${fmtMs(s.durationMs)}</span>
      <button class="btn-icon sm pl-more" data-more="${i}" aria-label="More options"><svg><use href="#i-dots"/></svg></button>
    </div>`;
  }).join('');
}

function skeletonRows(n = 8) {
  let out = '';
  for (let i = 0; i < n; i++) out += `<div class="pl-row pl-row-sk">
    <span class="pl-ix">${i + 1}</span><span class="pl-thumb pl-sk"></span>
    <span class="pl-c pl-cm-title"><span class="pl-sk pl-sk-line"></span><span class="pl-sk pl-sk-line short"></span></span>
    <span class="pl-c pl-cm-album"><span class="pl-sk pl-sk-line"></span></span>
    <span class="pl-c pl-cm-date"></span><span class="pl-c pl-cm-dur"></span><span></span></div>`;
  return out;
}

const theadHtml = `<div class="pl-thead">
  <span class="pl-ix">#</span><span class="pl-c pl-cm-title">Title</span>
  <span class="pl-c pl-cm-album">Album</span><span class="pl-c pl-cm-date">Date added</span>
  <span class="pl-c pl-cm-dur"><svg class="pl-clock"><use href="#i-clock"/></svg></span><span></span></div>`;

// Build the whole view. `loading` shows skeleton rows under a real hero.
function paint(target, records, raws, loading) {
  const main = $('#main'), keep = main?.scrollTop || 0;
  const hasTracks = !loading && records.length > 0;
  $('#view').innerHTML = `<div class="pl-view">
    <div class="pl-mini">
      <span class="pl-mini-title">${esc(target.name || 'Playlist')}</span>
      <button class="pl-play-mini" data-pl-play aria-label="Play" ${hasTracks ? '' : 'disabled'}><svg><use href="#i-play"/></svg></button>
    </div>
    ${heroHtml(target, loading ? [] : records)}
    ${actionsHtml(target, hasTracks)}
    <div class="pl-table">
      ${theadHtml}
      <div class="pl-rows">${loading ? skeletonRows() : rowsHtml(records)}</div>
    </div>
  </div>`;
  if (main) main.scrollTop = keep;
}

// ---------- public render (called by renderAll on every settings/player emit) ----------
export function render() {
  const target = state.settings.openTarget;
  if (!target) { setSettings({ view: 'home' }); return; }

  // Cache hit (player tick, settings change) → repaint from memory, no network.
  if (cacheKey === keyOf(target) && cacheData) {
    paint(target, cacheData.records, cacheData.raws, false);
    return;
  }

  // Groups resolve synchronously from local records — no skeleton needed.
  if (target.type === 'group') {
    cacheData = { records: [], raws: [] };
    resolve(target).then(d => { cacheKey = keyOf(target); cacheData = d; paint(target, d.records, d.raws, false); });
    return;
  }

  // Network-backed targets: skeleton immediately, swap when the fetch resolves.
  const mine = ++loadToken;
  cacheKey = null;
  paint(target, [], [], true);
  resolve(target).then(d => {
    if (mine !== loadToken || state.settings.openTarget?.type !== target.type) return;
    cacheKey = keyOf(target); cacheData = d;
    paint(target, d.records, d.raws, false);
  }).catch(e => {
    if (mine !== loadToken) return;
    $('#view .pl-rows').innerHTML = `<div class="pl-empty">${esc(e.message || 'Failed to load tracks')}</div>`;
    toast(e.message, 'err', 5000);
  });
}

// ---------- events (bound once) ----------
function play(idx) {
  const recs = cacheData?.records || [];
  if (!recs.length) return;
  player.playList(recs, idx).catch(e => toast(e.message, 'err', 5000));
}

function rowMenu(i, x, y) {
  const rec = cacheData?.records?.[i];
  const raw = cacheData?.raws?.[i];
  if (!rec) return;
  const items = [
    { label: 'Play', icon: 'play', action: () => play(i) },
    { label: 'Add to queue', icon: 'queue', action: () => player.enqueue(rec).then(() => toast('Added to queue', 'ok')).catch(e => toast(e.message, 'err', 5000)) },
    { label: 'Play next', icon: 'queue', action: () => player.enqueue(rec, { next: true }).then(() => toast('Playing next', 'ok')).catch(e => toast(e.message, 'err', 5000)) },
    { label: '+ Library', icon: 'plus', action: () => { const r = lib.importSearchResults([raw]); toast(r.added ? 'Added to library' : 'Already in library', r.added ? 'ok' : 'info'); } },
    'sep',
    { label: 'Open in Spotify', icon: 'external', action: () => window.open('https://open.spotify.com/track/' + rec.id, '_blank') },
  ];
  ctxMenu(x, y, items);
}

async function doImport() {
  const target = state.settings.openTarget;
  if (!target) return;
  const btn = $('#view [data-pl-import]');
  btn?.classList.add('is-busy');
  try {
    if (target.type === 'spotify') {
      const r = await lib.importPlaylist(target.id, { asGroupNamed: target.name });
      toast(`${target.name}: ${r.added} added, ${r.skipped} already in library`, 'ok');
      // Now mirrored as a group — switch the view to it (records, zero network).
      if (r.groupId) setSettings({ openTarget: { type: 'group', id: r.groupId, name: target.name, back: target.back } });
    } else if (target.type === 'liked') {
      const r = await lib.importLiked({ maxItems: 200 });
      toast(`Liked Songs: ${r.added} added, ${r.skipped} already in library`, 'ok');
    }
  } catch (e) {
    toast(e.message, 'err', 6000);
  } finally {
    btn?.classList.remove('is-busy');
  }
}

export function init() {
  const root = $('#view');

  root.addEventListener('click', e => {
    if (state.settings.view !== 'playlist') return;
    if (e.target.closest('[data-pl-back]')) { setSettings({ view: state.settings.openTarget?.back || 'home' }); return; }
    if (e.target.closest('[data-pl-play]')) { play(0); return; }
    if (e.target.closest('[data-pl-shuffle]')) {
      if (!player.getShuffle()) player.toggleShuffle();
      play(0); announce('Shuffle play'); return;
    }
    if (e.target.closest('[data-pl-import]')) { doImport(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); const r = more.getBoundingClientRect(); rowMenu(+more.dataset.more, r.left, r.bottom + 4); return; }
    const row = e.target.closest('.pl-row[data-i]');
    if (row) play(+row.dataset.i);
  });

  root.addEventListener('contextmenu', e => {
    if (state.settings.view !== 'playlist') return;
    const row = e.target.closest('.pl-row[data-i]');
    if (!row) return;
    e.preventDefault();
    rowMenu(+row.dataset.i, e.clientX, e.clientY);
  });

  root.addEventListener('keydown', e => {
    if (state.settings.view !== 'playlist') return;
    const row = e.target.closest('.pl-row[data-i]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play(+row.dataset.i); }
  });

  // Apple-style pinned mini-header: fades in once the hero scrolls away.
  $('#main')?.addEventListener('scroll', () => {
    if (state.settings.view !== 'playlist') return;
    const hero = $('#view .pl-hero'), mini = $('#view .pl-mini');
    if (hero && mini) mini.classList.toggle('show', $('#main').scrollTop > hero.offsetHeight - 64);
  }, { passive: true });
}
