// App boot: wiring topbar/sidebar/bus/keyboard, auth callback, drag-drop handlers.
import { state, load, on, undo, canUndo, setSetting, setSettings, setSpotifyPlaylists, removeSongs, addToGroup, removeFromGroup, moveIds, toggleTag, setRating, addListens, setPlayCursor } from './store.js';
import { $, $$, esc, debounce, announce, clamp, TIER_RATING } from './utils.js';
import * as faceoff from './faceoff.js';
import * as rank from './rank.js';
import * as tourney from './tourney.js';
import * as leaderboard from './leaderboard.js';
import * as themes from './themes.js';
import * as auth from './auth.js';
import * as api from './api.js';
import * as views from './views.js';
import * as stats from './stats.js';
import * as home from './home.js';
import * as playlist from './playlist.js';
import * as player from './player.js';
import * as nowplaying from './nowplaying.js';
import * as dnd from './dnd.js';
import * as lib from './library.js';
import { toast, ctxMenu, shortcutsModal, confirm, openModal } from './ui.js';
import * as modals from './modals.js';
import { importModal } from './import.js';
import * as cloud from './cloud.js';
import * as friends from './friends.js';
import * as friendsView from './friends-view.js';
import * as compare from './compare.js';
import { openCatalogSearch } from './catalog.js';

// Reset target for "Clear filters" — keep grouping in here so genre/group views
// are exitable via Clear, not just via the All pill.
const CLEARED_FILTERS = { search: '', filterTags: [], ratedFilter: 'all', minRating: 1, maxRating: 1000, groupMode: 'none', collapsed: {} };

// Sort fields (value → label) for the sub-bar Sort menu and its button label.
const SORT_FIELDS = [
  ['custom', 'Custom order'], ['rating', 'Rating'], ['name', 'Title'], ['artist', 'Artist'],
  ['album', 'Album'], ['duration', 'Duration'], ['listens', 'Listens'], ['added', 'Date added'],
];
// Status options for the filter popover (mirror of the old #rated-filter select).
const RATED_LABELS = {
  all: 'All songs', rated: 'Rated only', unrated: 'Unrated only', noted: 'With notes',
  tagged: 'Tagged', untagged: 'Untagged', played: 'Played', unplayed: 'Never played',
};
// "Clear all" inside the filter popover — wipes filter facets but keeps group-by + sort.
const FILTER_CLEAR = { ratedFilter: 'all', filterTags: [], minRating: 1, maxRating: 1000 };

// ---------- render orchestration ----------
function renderAll() {
  if (state.settings.view === 'stats') stats.render();
  else if (state.settings.view === 'faceoff') faceoff.render();
  else if (state.settings.view === 'rank') rank.render();
  else if (state.settings.view === 'ranks') leaderboard.render();
  else if (state.settings.view === 'friends') friendsView.render();
  else if (state.settings.view === 'compare') compare.render();
  else if (state.settings.view === 'home') home.render();
  else if (state.settings.view === 'playlist') playlist.render();
  else views.render();
  renderSidebar();
  syncControls();
}
const renderSoon = debounce(renderAll, 30);

function syncControls() {
  const s = state.settings;
  // Never overwrite a field the user is actively editing — background renders
  // (e.g. the player's 1s progress tick) would otherwise wipe in-flight input
  // before its debounced commit lands, making filters unusable during playback.
  const syncVal = (sel, val) => {
    const el = $(sel);
    if (el !== document.activeElement && el.value !== String(val)) el.value = val;
  };
  syncVal('#search', s.search);
  $('#sort-label').textContent = (SORT_FIELDS.find(f => f[0] === s.sortBy) || [, 'Sort'])[1];
  const nextLayout = { rows: ['grid', 'Switch to cards'], cards: ['tiers', 'Switch to tier board'], tiers: ['rows', 'Switch to rows'] }[s.layout] || ['grid', 'Switch layout'];
  $('#layout-toggle').innerHTML = `<svg><use href="#i-${nextLayout[0]}"/></svg>`;
  $('#layout-toggle').title = nextLayout[1];
  $('#layout-toggle').setAttribute('aria-label', nextLayout[1]);
  $('#btn-undo').disabled = !canUndo();
  $$('#filterbar .pill[data-gm]').forEach(p => p.classList.toggle('is-active', p.dataset.gm === s.groupMode));
  const fcount = filterCount();
  $('#btn-filter').classList.toggle('has-filters', fcount > 0);
  const fbadge = $('#filter-badge');
  fbadge.textContent = fcount; fbadge.hidden = fcount === 0;
  $$('.nav-item').forEach(n => n.classList.toggle('is-active', n.dataset.view === s.view));
  // Friends nav badge: count of incoming requests.
  const fb = $('#nav-friends-badge');
  if (fb) { const n = friends.incomingCount(); fb.textContent = n || ''; fb.hidden = !n; }
  // Filters only make sense in the library — face-off has its own battle scopes now.
  $('#filterbar').style.display = s.view === 'library' ? '' : 'none';
  if (s.view !== 'library') $('#filterbar').classList.remove('bar-hidden', 'bar-stuck');
  $('#app').classList.toggle('sb-collapsed', !!s.sidebarCollapsed);

  const btn = $('#btn-connect');
  const p = auth.getProfile();
  btn.classList.toggle('connected', auth.isConnected());
  btn.querySelector('span').textContent = auth.isConnected() ? (p?.display_name || 'Connected') : 'Connect';

  // active filter chips (status, rating range, tags) — derived from current settings
  $('#active-filters').innerHTML = activeFacets().map(f =>
    `<button class="chip removable" data-facet="${esc(f.key)}" aria-label="Remove filter ${esc(f.label)}">
      ${f.color ? `<span class="dot" style="background:${esc(f.color)}"></span>` : ''}${esc(f.label)} ✕</button>`).join('');
}

const SIDE_CAP = 4;                                   // sidebar lists show this many before "Show more"
const sideOpen = { groups: false, tags: false, playlists: false };

// Cap a sidebar list at SIDE_CAP items, appending a Show more / Show less toggle row.
function sideCap(items, key) {
  if (items.length <= SIDE_CAP) return items.join('');
  const open = sideOpen[key];
  const shown = open ? items : items.slice(0, SIDE_CAP);
  const label = open ? 'Show less' : `Show ${items.length - SIDE_CAP} more`;
  return shown.join('') + `<li><button class="side-item side-more ${open ? 'is-open' : ''}" data-side-more="${key}" aria-expanded="${open}">
    <svg class="chev"><use href="#i-chevron"/></svg><span>${label}</span></button></li>`;
}

function renderSidebar() {
  const tagCounts = {};
  Object.values(state.songs).forEach(s => s.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1));

  const groupItems = state.groups.map(g => `
    <li><button class="side-item" data-group="${esc(g.id)}" data-drop-group="${esc(g.id)}" title="Open group (drop songs here to add)">
      <span class="swatch" style="background:${esc(g.color)}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.name)}</span>
      <span class="cnt">${g.songIds.length}</span></button></li>`);
  $('#group-list').innerHTML = groupItems.length ? sideCap(groupItems, 'groups')
    : '<li class="side-empty">Drop songs here after creating a group with +</li>';

  const tagItems = state.tags.map(t => `
    <li><button class="side-item ${state.settings.filterTags.includes(t.id) ? 'is-active' : ''}"
      data-tag="${esc(t.id)}" data-drop-tag="${esc(t.id)}" title="Filter by tag (drop songs here to tag them)">
      <span class="swatch" style="border-radius:50%;background:${esc(t.color)}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</span>
      <span class="cnt">${tagCounts[t.id] || 0}</span></button></li>`);
  $('#tag-list').innerHTML = tagItems.length ? sideCap(tagItems, 'tags')
    : '<li class="side-empty">Create tags with + to label songs</li>';

  // Spotify playlists (cached) — like Spotify's left rail
  const plSec = $('#playlist-sec');
  if (plSec) {
    plSec.hidden = !auth.isConnected() && !state.spotifyPlaylists.length;
    const plItems = state.spotifyPlaylists.map(p => `
      <li><button class="side-item" data-playlist="${esc(p.id)}" title="${esc(p.name)} — click to open / import">
        ${p.img ? `<img class="side-pl-img" src="${esc(p.img)}" alt="" loading="lazy">` : '<span class="swatch" style="background:#1db954"></span>'}
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
        <span class="cnt">${p.total ?? ''}</span></button></li>`);
    $('#playlist-list').innerHTML = plItems.length ? sideCap(plItems, 'playlists')
      : `<li class="side-empty">${auth.isConnected() ? 'No playlists found — hit ↻ to refresh' : 'Connect Spotify to see your playlists'}</li>`;
  }
}

// Pull the user's Spotify playlists into the sidebar cache.
async function refreshPlaylists(silent = true) {
  if (!auth.isConnected()) return;
  try {
    const pls = await api.getMyPlaylists({});
    setSpotifyPlaylists(pls.filter(p => p && p.id).map(p => ({
      id: p.id, name: p.name, total: p.items?.total ?? p.tracks?.total ?? null,
      img: p.images?.[p.images.length - 1]?.url || '',
    })));
    if (!silent) toast(`Loaded ${state.spotifyPlaylists.length} playlists`, 'ok');
  } catch (e) { if (!silent) toast(e.message, 'err'); }
}

// Pull plays from Spotify's recently-played feed (all devices, not just this
// app) and credit them to library songs. Spotify only keeps the last 50 plays,
// so we poll on boot + every 3 minutes while the app is open and accumulate
// from the persisted cursor. Historical pre-app play counts are not available
// from the API at all.
let playSyncWarned = false;
async function syncPlays() {
  if (!auth.isConnected()) return;
  try {
    const r = await api.getRecentlyPlayed(state.playCursor || undefined);
    const items = (r?.items || []).filter(Boolean);
    const counts = {};
    let newest = state.playCursor || 0;
    for (const it of items) {
      const id = it.track?.id;
      if (id && state.songs[id]) counts[id] = (counts[id] || 0) + 1;
      const at = Date.parse(it.played_at);
      if (at > newest) newest = at;
    }
    addListens(counts);
    const next = +(r?.cursors?.after) || newest;
    if (next > (state.playCursor || 0)) setPlayCursor(next);
  } catch (e) {
    // Missing user-read-recently-played scope on an old token → 403 until reconnect.
    if (/403/.test(String(e.message)) && !playSyncWarned) {
      playSyncWarned = true;
      toast('To track Spotify plays, disconnect and reconnect in Settings → Spotify (new permission needed).', 'info', 8000);
    } else if (!/403/.test(String(e.message))) {
      console.warn('play sync failed', e);
    }
  }
}

// Click on a playlist: open the Playlist Overview (stream-first, no force-import).
// An already-imported playlist resolves from its mirror group (records, zero
// network); an un-imported one fetches from Spotify. Import lives inside the view.
// Where Back returns to — never 'playlist' itself (that would be a dead button
// when opening one playlist from another); chain to the prior back or Home.
function prevView() {
  return state.settings.view === 'playlist'
    ? (state.settings.openTarget?.back || 'home')
    : state.settings.view;
}

function openPlaylist(plId) {
  const p = state.spotifyPlaylists.find(x => x.id === plId);
  if (!p) return;
  const back = prevView();
  const g = state.groups.find(x => x.name === p.name && x.songIds.length);
  const target = g
    ? { type: 'group', id: g.id, name: p.name, back }
    : { type: 'spotify', id: plId, name: p.name, img: p.img || '', back };
  setSettings({ view: 'playlist', openTarget: target });
}

// Open a virtual feed (Liked Songs / Recently played) in the same Overview view.
function openFeed(type) {
  setSettings({
    view: 'playlist',
    openTarget: { type, name: type === 'liked' ? 'Liked Songs' : 'Recently played', back: prevView() },
  });
}

// ---------- context menu for songs ----------
function showSongMenu({ x, y, ids }) {
  const single = ids.length === 1 ? state.songs[ids[0]] : null;
  const items = [];
  if (single?.uri) {
    items.push({ label: 'Play', icon: 'play', action: () => views.playFrom(single.id) });
    items.push({ label: 'Add to queue', icon: 'queue', action: () => enqueueSong(single, false) });
    items.push({ label: 'Play next', icon: 'queue', action: () => enqueueSong(single, true) });
  }
  if (single) items.push({ label: 'Song details', icon: 'info', action: () => modals.songDetail(single.id) });
  // Quick-tag submenu: most-recently-used tags first, padded with the rest so it
  // is useful before any usage history exists. Click toggles the tag on the
  // selection; "Edit tags…" itself still opens the full editor.
  const recentIds = [...state.settings.recentTags];
  for (const t of state.tags) if (!recentIds.includes(t.id)) recentIds.push(t.id);
  const tagSub = recentIds.map(id => state.tags.find(t => t.id === id)).filter(Boolean).slice(0, 5)
    .map(t => ({
      label: t.name, dot: t.color,
      checked: ids.every(id => state.songs[id]?.tags.includes(t.id)),
      action: () => { const had = ids.every(id => state.songs[id]?.tags.includes(t.id)); toggleTag(ids, t.id, !had); toast(`${had ? 'Removed' : 'Added'} ${t.name}`); },
    }));
  items.push(
    { label: `Rate${ids.length > 1 ? ` ${ids.length} songs` : ''}…`, icon: 'edit', action: () => modals.bulkRate(ids) },
    { label: 'Edit tags…', icon: 'tag', action: () => modals.bulkTag(ids), submenu: tagSub.length ? tagSub : undefined },
    { label: 'Add to group…', icon: 'folder', action: () => modals.bulkGroup(ids) },
  );
  const containing = state.groups.filter(g => ids.every(id => g.songIds.includes(id)));
  containing.forEach(g => items.push({
    label: `Remove from "${g.name}"`, icon: 'x',
    action: () => { removeFromGroup(ids, g.id); toast(`Removed from ${g.name}`); },
  }));
  if (single?.uri) items.push({ label: 'Open in Spotify', icon: 'external', action: () => window.open('https://open.spotify.com/track/' + single.id, '_blank') });
  items.push('sep', {
    label: `Remove from library${ids.length > 1 ? ` (${ids.length})` : ''}`, icon: 'trash', danger: true,
    action: () => deleteSongs(ids),
  });
  ctxMenu(x, y, items);
}

async function deleteSongs(ids) {
  if (await confirm(`Remove ${ids.length} song(s) from your library? Ratings and tags on them are lost (undo available right after).`, { danger: true, okLabel: 'Remove' })) {
    removeSongs(ids);
    views.clearSelection();
    announce(`Removed ${ids.length} songs`);
  }
}

function doUndo() {
  const label = undo();
  toast(label ? 'Undid: ' + label : 'Nothing to undo', label ? 'ok' : 'info');
}

async function enqueueSong(song, next) {
  try {
    await player.enqueue(song, { next });
    toast(next ? 'Playing next' : 'Added to queue', 'ok');
  } catch (e) { toast(e.message, 'err', 5000); }
}

function connectFlow() {
  if (auth.isConnected()) { modals.settings('spotify'); return; }
  // With a baked-in (or saved) client id, go straight to the Spotify consent
  // screen. Only fall back to the setup panel when no id exists anywhere.
  if (!auth.hasClientId()) { modals.settings('spotify'); return; }
  auth.connect().catch(e => toast(e.message, 'err'));
}

// ---------- sort menu + filter popover ----------
function filterCount() {
  const s = state.settings;
  return (s.ratedFilter !== 'all' ? 1 : 0)
    + ((s.minRating > 1 || s.maxRating < 1000) ? 1 : 0)
    + (s.filterTags.length ? 1 : 0);
}

// Active filter facets as removable-chip descriptors. `clear` re-reads live state.
function activeFacets() {
  const s = state.settings;
  const out = [];
  if (s.ratedFilter !== 'all') out.push({ key: 'status', label: RATED_LABELS[s.ratedFilter] || s.ratedFilter, clear: () => setSetting('ratedFilter', 'all') });
  if (s.minRating > 1 || s.maxRating < 1000) out.push({ key: 'range', label: `★ ${s.minRating}–${s.maxRating}`, clear: () => setSettings({ minRating: 1, maxRating: 1000 }) });
  for (const tid of s.filterTags) {
    const t = state.tags.find(x => x.id === tid);
    if (t) out.push({ key: 'tag:' + tid, label: t.name, color: t.color, clear: () => setSetting('filterTags', state.settings.filterTags.filter(x => x !== tid)) });
  }
  return out;
}

function openSortMenu() {
  const s = state.settings;
  const r = $('#btn-sort').getBoundingClientRect();
  const items = SORT_FIELDS.map(([v, label]) => ({ label, checked: s.sortBy === v, action: () => setSetting('sortBy', v) }));
  items.push('sep', {
    label: s.sortDir === 'asc' ? 'Ascending' : 'Descending', icon: 'sort',
    action: () => setSetting('sortDir', s.sortDir === 'asc' ? 'desc' : 'asc'),
  });
  ctxMenu(r.left, r.bottom + 6, items);
}

let filterPop = null;
function filterPopKey(e) { if (e.key === 'Escape') { e.stopPropagation(); $('#btn-filter').focus(); closeFilterPop(); } }
function outsideFilter(e) { if (filterPop && !filterPop.contains(e.target) && !e.target.closest('#btn-filter')) closeFilterPop(); }

function closeFilterPop() {
  if (!filterPop) return;
  filterPop.remove(); filterPop = null;
  document.removeEventListener('mousedown', outsideFilter);
  document.removeEventListener('keydown', filterPopKey, true);
  const b = $('#btn-filter');
  b.setAttribute('aria-expanded', 'false'); b.classList.remove('is-open');
}

function updateRangeFill() {
  const fill = filterPop?.querySelector('.rd-fill');
  if (!fill) return;
  const s = state.settings;
  const lo = (s.minRating - 1) / 999 * 100, hi = (s.maxRating - 1) / 999 * 100;
  fill.style.left = lo + '%';
  fill.style.width = Math.max(0, hi - lo) + '%';
}

// (Re)render the popover body from current settings. Safe to call after a status/
// tag/clear change; NOT called mid-slider-drag (that updates in place instead).
function buildFilterPop() {
  if (!filterPop) return;
  const s = state.settings;
  const statusPills = Object.entries(RATED_LABELS).map(([v, label]) =>
    `<button class="fp-pill ${s.ratedFilter === v ? 'is-active' : ''}" data-status="${v}">${esc(label)}</button>`).join('');
  const rangeOff = s.ratedFilter === 'unrated';
  // Tags: show the 5 most-recently-used (plus any active ones), with "See all"
  // opening the full picker. Keeps the popover short when the library has many tags.
  const tagPill = t => `<button class="fp-pill ${s.filterTags.includes(t.id) ? 'is-active' : ''}" data-ftag="${esc(t.id)}"><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</button>`;
  const recentIds = [...s.recentTags];
  for (const t of state.tags) if (!recentIds.includes(t.id)) recentIds.push(t.id);
  const ordered = [...s.filterTags, ...recentIds.filter(id => !s.filterTags.includes(id))];
  const shownTags = ordered.map(id => state.tags.find(t => t.id === id)).filter(Boolean).slice(0, Math.max(5, s.filterTags.length));
  const tagPills = state.tags.length
    ? shownTags.map(tagPill).join('') + (state.tags.length > shownTags.length ? `<button class="fp-pill fp-more" data-fp-moretags>See all (${state.tags.length})</button>` : '')
    : '<span class="fp-empty">No tags yet</span>';
  filterPop.innerHTML = `
    <div class="fp-head"><h3>Filter</h3>${filterCount() ? '<button class="fp-clear" data-fp-clear>Clear all</button>' : ''}</div>
    <div class="fp-sec"><span class="fp-label">Status</span><div class="fp-pills">${statusPills}</div></div>
    <div class="fp-sec"><span class="fp-label">Rating</span>
      <div class="range-dual ${rangeOff ? 'is-disabled' : ''}">
        <div class="rd-track"></div><div class="rd-fill"></div>
        <input type="range" id="fp-min" min="1" max="1000" value="${s.minRating}" aria-label="Minimum rating" ${rangeOff ? 'disabled' : ''}>
        <input type="range" id="fp-max" min="1" max="1000" value="${s.maxRating}" aria-label="Maximum rating" ${rangeOff ? 'disabled' : ''}>
      </div>
      <div class="rd-readout"><span id="fp-min-out">${s.minRating}</span><span id="fp-max-out">${s.maxRating}</span></div>
    </div>
    <div class="fp-sec"><span class="fp-label">Tags</span><div class="fp-pills">${tagPills}</div></div>
    <div class="fp-foot"><button class="btn btn-primary sm" data-fp-done>Done</button></div>`;
  updateRangeFill();
}

function openFilterPop() {
  if (filterPop) { closeFilterPop(); return; }
  const btn = $('#btn-filter');
  filterPop = document.createElement('div');
  filterPop.className = 'filter-pop';
  filterPop.setAttribute('role', 'dialog');
  filterPop.setAttribute('aria-label', 'Filters');
  filterPop.addEventListener('click', e => {
    const st = e.target.closest('[data-status]');
    if (st) { setSetting('ratedFilter', st.dataset.status); buildFilterPop(); return; }
    const tg = e.target.closest('[data-ftag]');
    if (tg) { const id = tg.dataset.ftag, cur = state.settings.filterTags; setSetting('filterTags', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]); buildFilterPop(); return; }
    if (e.target.closest('[data-fp-moretags]')) { closeFilterPop(); openTagFilterModal(); return; }
    if (e.target.closest('[data-fp-clear]')) { setSettings({ ...FILTER_CLEAR }); buildFilterPop(); return; }
    if (e.target.closest('[data-fp-done]')) { closeFilterPop(); btn.focus(); }
  });
  filterPop.addEventListener('input', e => {
    if (e.target.id !== 'fp-min' && e.target.id !== 'fp-max') return;
    const minEl = filterPop.querySelector('#fp-min'), maxEl = filterPop.querySelector('#fp-max');
    let lo = +minEl.value, hi = +maxEl.value;
    if (lo > hi) { if (e.target.id === 'fp-min') { lo = hi; minEl.value = lo; } else { hi = lo; maxEl.value = hi; } }
    filterPop.querySelector('#fp-min-out').textContent = lo;
    filterPop.querySelector('#fp-max-out').textContent = hi;
    setSettings({ minRating: lo, maxRating: hi });
    updateRangeFill();
  });
  document.body.appendChild(filterPop);
  buildFilterPop();
  const r = btn.getBoundingClientRect();
  let left = r.right - filterPop.offsetWidth;
  if (left < 8) left = 8;
  filterPop.style.left = left + 'px';
  filterPop.style.top = (r.bottom + 6) + 'px';
  btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-open');
  setTimeout(() => document.addEventListener('mousedown', outsideFilter), 0);
  document.addEventListener('keydown', filterPopKey, true);
}

// Full tag picker (the popover's "See all"): every tag as a multi-select chip.
function openTagFilterModal() {
  const pills = () => state.tags.length
    ? state.tags.map(t => `<button class="fp-pill ${state.settings.filterTags.includes(t.id) ? 'is-active' : ''}" data-ftag="${esc(t.id)}"><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</button>`).join('')
    : '<span class="fp-empty">No tags yet</span>';
  const m = openModal(`<div class="fp-pills tag-modal-pills">${pills()}</div>`, { title: 'Filter by tag' });
  m.root.querySelector('.tag-modal-pills').addEventListener('click', e => {
    const tg = e.target.closest('[data-ftag]');
    if (!tg) return;
    const id = tg.dataset.ftag, cur = state.settings.filterTags;
    setSetting('filterTags', cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
    m.root.querySelector('.tag-modal-pills').innerHTML = pills();
  });
}

// ---------- chrome bindings ----------
function bindChrome() {
  $('#search').addEventListener('input', debounce(e => setSetting('search', e.target.value), 200));
  $('#btn-sort').addEventListener('click', openSortMenu);
  $('#btn-filter').addEventListener('click', openFilterPop);
  $('#layout-toggle').addEventListener('click', () => {
    const order = ['rows', 'cards', 'tiers'];
    setSetting('layout', order[(order.indexOf(state.settings.layout) + 1) % order.length]);
  });
  $('#btn-undo').addEventListener('click', doUndo);
  $('#btn-catalog').addEventListener('click', openCatalogSearch);
  $('#btn-import').addEventListener('click', () => importModal());
  $('#btn-connect').addEventListener('click', connectFlow);
  $('#btn-settings').addEventListener('click', () => modals.settings());
  // Mobile: slide the drawer in/out. Desktop: collapse the rail entirely (persisted).
  $('#btn-sidebar').addEventListener('click', () => {
    if (window.innerWidth <= 920) $('#sidebar').classList.toggle('open');
    else setSetting('sidebarCollapsed', !state.settings.sidebarCollapsed);
  });
  $('#btn-add-group').addEventListener('click', () => modals.groupEditor());
  $('#btn-add-tag').addEventListener('click', () => modals.tagEditor());
  $('#btn-shortcuts').addEventListener('click', shortcutsModal);
  $('#btn-theme').addEventListener('click', () => modals.settings('appearance'));

  $('#filterbar').addEventListener('click', e => {
    const gm = e.target.closest('[data-gm]');
    if (gm) setSetting('groupMode', gm.dataset.gm);
    const facet = e.target.closest('[data-facet]');
    if (facet) activeFacets().find(f => f.key === facet.dataset.facet)?.clear();
  });

  $('.sidebar nav').addEventListener('click', e => {
    const n = e.target.closest('[data-view]');
    if (n) {
      if (n.dataset.view === 'friends') friendsView.showList(); // open the list, not a stale profile
      setSetting('view', n.dataset.view); $('#sidebar').classList.remove('open');
    }
  });
  $('#group-list').addEventListener('click', e => {
    const g = e.target.closest('[data-group]');
    if (!g) return;
    setSettings({ view: 'library', groupMode: 'group' });
    $('#sidebar').classList.remove('open');
    requestAnimationFrame(() => {
      $(`[data-bucket="${CSS.escape(g.dataset.group)}"]`)?.scrollIntoView({ block: 'start' });
    });
  });
  $('#group-list').addEventListener('contextmenu', e => {
    const g = e.target.closest('[data-group]');
    if (!g) return;
    e.preventDefault();
    modals.groupEditor(state.groups.find(x => x.id === g.dataset.group));
  });
  $('#tag-list').addEventListener('click', e => {
    const t = e.target.closest('[data-tag]');
    if (!t) return;
    const cur = state.settings.filterTags;
    setSetting('filterTags', cur.includes(t.dataset.tag) ? cur.filter(x => x !== t.dataset.tag) : [...cur, t.dataset.tag]);
  });
  $('#tag-list').addEventListener('contextmenu', e => {
    const t = e.target.closest('[data-tag]');
    if (!t) return;
    e.preventDefault();
    modals.tagEditor(state.tags.find(x => x.id === t.dataset.tag));
  });
  $('#playlist-list')?.addEventListener('click', e => {
    const p = e.target.closest('[data-playlist]');
    if (p) { openPlaylist(p.dataset.playlist); $('#sidebar').classList.remove('open'); }
  });
  // Sidebar list controls: "Show more/less" cap toggle + collapse a whole section by its header.
  $('#sidebar').addEventListener('click', e => {
    const m = e.target.closest('[data-side-more]');
    if (m) { sideOpen[m.dataset.sideMore] = !sideOpen[m.dataset.sideMore]; renderSidebar(); return; }
    const sec = e.target.closest('[data-side-sec]');
    if (sec) {
      const k = sec.dataset.sideSec;
      const collapsed = sec.closest('.side-sec').classList.toggle('collapsed');
      sec.setAttribute('aria-expanded', String(!collapsed));
      // Collapsing also re-minimises an expanded list so it reopens at the cap.
      if (collapsed && sideOpen[k]) { sideOpen[k] = false; renderSidebar(); }
    }
  });
  $('#sidebar').addEventListener('keydown', e => {
    const sec = e.target.closest('[data-side-sec]');
    if (sec && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sec.click(); }
  });
  $('#btn-refresh-pls')?.addEventListener('click', () => {
    auth.isConnected() ? refreshPlaylists(false) : toast('Connect Spotify first', 'err');
  });

  $('#bulk-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    const ids = views.getSelection();
    const act = b.dataset.bulk;
    if (act === 'rate') modals.bulkRate(ids);
    if (act === 'tag') modals.bulkTag(ids);
    if (act === 'group') modals.bulkGroup(ids);
    if (act === 'playlist') modals.exportPlaylist(ids, 'Song Ranker selection');
    if (act === 'remove') deleteSongs(ids);
    if (act === 'clear') views.clearSelection();
  });

  // global keyboard
  document.addEventListener('keydown', e => {
    const inField = e.target.closest?.('input, textarea, select');
    if (e.key === 'Escape') {
      if (inField) e.target.blur();
      else views.clearSelection();
      return;
    }
    if (inField || e.target.closest?.('.modal')) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 'u' && !e.ctrlKey) { e.preventDefault(); doUndo(); }
    else if (e.key === '?') { e.preventDefault(); shortcutsModal(); }
    else if (e.key === 'a' && (e.ctrlKey || e.metaKey) && state.settings.view === 'library') {
      e.preventDefault(); views.selectAll();
    }
  });
}

// Auto-hide the filter sub-bar on downward scroll; reveal on scroll up or at the top.
function bindBarAutoHide() {
  const main = $('#main'), bar = $('#filterbar');
  if (!main || !bar) return;
  let last = 0, ticking = false;
  main.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = main.scrollTop;
      bar.classList.toggle('bar-stuck', y > 8);
      if (y <= 8) bar.classList.remove('bar-hidden');                  // at top: always visible
      else if (y > last + 4 && y > 60) bar.classList.add('bar-hidden'); // scrolling down
      else if (y < last - 4) bar.classList.remove('bar-hidden');        // scrolling up
      last = y;
      ticking = false;
    });
  }, { passive: true });
}

function bindBus() {
  on('songs groups tags settings auth player playlists friends', renderSoon);
  on('toast', d => toast(d.msg, d.type));
  on('ctx-menu', showSongMenu);
  on('song-detail', id => modals.songDetail(id));
  on('edit-group', gid => modals.groupEditor(state.groups.find(g => g.id === gid)));
  on('delete-songs', deleteSongs);
  on('do-undo', doUndo);
  on('open-playlist', openPlaylist);
  on('open-feed', openFeed);
  on('player-error', msg => toast(msg, 'err', 5000));
  on('empty-action', act => {
    if (act === 'connect') connectFlow();
    if (act === 'import') importModal();
    if (act === 'sample') { const r = lib.loadSampleData(); toast(`Loaded ${r.added} sample songs — rate away!`, 'ok'); }
    if (act === 'clear-filters') setSettings({ ...CLEARED_FILTERS });
    if (act === 'new-group') modals.groupEditor();
  });
}

// ---------- drag & drop ----------
function bindDnd() {
  dnd.init({
    getSelectedIds: views.getSelection,
    onReorder(ids, fromZone, toZone, idx) {
      if (toZone.startsWith('tier:')) {
        const t = toZone.slice(5);
        setRating(ids, TIER_RATING[t]);
        announce(t === 'U' ? 'Rating cleared' : `Moved to tier ${t}`);
        return;
      }
      if (toZone === '__all__') { moveIds('__all__', ids, idx); announce('Reordered'); return; }
      const g = state.groups.find(x => x.id === toZone);
      if (!g) return;
      if (fromZone !== toZone) {
        if (state.groups.find(x => x.id === fromZone)) removeFromGroup(ids, fromZone);
        addToGroup(ids, toZone);
      }
      moveIds(toZone, ids, idx);
      announce(`Moved to ${g.name}`);
    },
    onDropToGroup(ids, gid) {
      const g = state.groups.find(x => x.id === gid);
      const n = addToGroup(ids, gid);
      toast(n ? `Added ${n} song(s) to ${g.name}` : `Already in ${g.name}`, n ? 'ok' : 'info');
    },
    onDropToTag(ids, tid) {
      const t = state.tags.find(x => x.id === tid);
      toggleTag(ids, tid, true);
      toast(`Tagged ${ids.length} song(s) "${t.name}"`, 'ok');
    },
  });
}

// ---------- boot ----------
load();
friends.load();        // paint cached friends/profile before the network confirms
themes.apply();
themes.initStars();
views.initViews();
faceoff.init();
rank.init();
tourney.init();
leaderboard.init();
friendsView.init();
compare.init();
home.init();
playlist.init();
player.bindBarControls();
// Bar artwork / title → open the full-screen now-playing overlay.
$('#pb-art')?.addEventListener('click', () => nowplaying.open());
$('.pb-meta')?.addEventListener('click', () => nowplaying.open());
// Player-bar "more" button → the same right-click song menu, on the current track.
$('#pb-more')?.addEventListener('click', e => {
  const uri = player.currentUri();
  const song = uri && Object.values(state.songs).find(s => s.uri === uri);
  if (!song) { toast('No song loaded'); return; }
  const r = e.currentTarget.getBoundingClientRect();
  showSongMenu({ x: r.left, y: r.top - 8, ids: [song.id] });
});
bindChrome();
bindBus();
bindDnd();
bindBarAutoHide();
cloud.initAutoSync();   // debounced auto-push after library changes (no-op until enabled)
renderAll();

window.__srBooted = true; // signals the boot-failure banner that modules loaded fine

(async () => {
  try {
    if (await auth.handleCallback()) toast('Spotify connected', 'ok');
  } catch (e) { toast(e.message, 'err', 6000); }
  if (auth.isConnected()) {
    api.getMe().then(p => {
      auth.setProfile(p);
      // /me stopped returning `product` (Feb 2026 API change) — only warn when
      // Spotify explicitly reports a non-premium plan, not when it's absent.
      if (p.product && p.product !== 'premium') toast('Heads up: in-app playback needs Spotify Premium. Importing and rating work regardless.', 'info', 6000);
      // Profile id is now known — pull the cloud library and merge it in.
      cloud.syncOnConnect().catch(() => {});
      // Friends: ensure a profile row exists, then load the friend list. Profile
      // sync first so any inbound edge already has a row to reference.
      friends.syncProfile().then(() => friends.refresh()).then(() => friends.prefetchLibraries()).catch(() => {});
    }).catch(() => {});
    refreshPlaylists();
    syncPlays();
    setInterval(syncPlays, 180000);
    setInterval(() => { if (auth.isConnected()) friends.refresh().then(() => friends.prefetchLibraries()).catch(() => {}); }, 180000);
    // Genres are fetched once at import time; if that call failed (expired token,
    // network, closed tab mid-import) nothing retried — so retry unresolved artists here.
    lib.enrichGenres().catch(e => console.warn('genre enrichment failed', e));
    player.init().catch(console.error);
  }
})();
