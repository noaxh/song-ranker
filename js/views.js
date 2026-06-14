// Library rendering: filtering, sorting, grouping, rows/cards, selection, keyboard.
import { state, songGenres, setRating, adjustRating, emit, moveIds } from './store.js';
import { $, $$, esc, fmtMs, tierOf, tierBase, announce, clamp, hashHue, TIER_ORDER } from './utils.js';
import * as player from './player.js';

const RENDER_CAP = 300;
const sel = new Set();
let flatIds = [];          // visible ids in render order (for shift-select)
let lastClickedId = null;
let lastFocusId = null;
const expanded = {};       // bucketKey -> extra rows shown
let digitBuf = '';         // quick-rate digit buffer
let digitTimer = null;
let clickTimer = null;     // defers single-click play so a double-click can open details
export let lastBuckets = [];

export const getSelection = () => [...sel];
// Ids passing the current filters, in custom order (Face-off uses this as its pool).
export function visibleIds() { return state.order.filter(id => state.songs[id] && visible(state.songs[id])); }
export function clearSelection() { sel.clear(); syncSelectionUi(); }
export function selectAll() { visibleIds().forEach(id => sel.add(id)); syncSelectionUi(); }

// ---------- filtering ----------
function visible(s) {
  const st = state.settings;
  const q = st.search.trim().toLowerCase();
  if (q) {
    const hay = (s.name + ' ' + s.artists.map(a => a.name).join(' ') + ' ' + s.album.name).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  for (const t of st.filterTags) if (!s.tags.includes(t)) return false;
  if (st.ratedFilter === 'rated' && s.rating == null) return false;
  if (st.ratedFilter === 'unrated' && s.rating != null) return false;
  if (st.ratedFilter === 'noted' && !s.note) return false;
  if (st.ratedFilter === 'tagged' && !s.tags.length) return false;
  if (st.ratedFilter === 'untagged' && s.tags.length) return false;
  if (st.ratedFilter === 'played' && !(s.listens > 0)) return false;
  if (st.ratedFilter === 'unplayed' && s.listens > 0) return false;
  if (s.rating != null) {
    if (s.rating < st.minRating || s.rating > st.maxRating) return false;
  } else if (st.minRating > 1 || st.maxRating < 1000) {
    return false;
  }
  return true;
}

// ---------- sorting ----------
function comparator() {
  const dir = state.settings.sortDir === 'asc' ? 1 : -1;
  const by = state.settings.sortBy;
  const S = id => state.songs[id];
  const cmp = {
    name: (a, b) => S(a).name.localeCompare(S(b).name),
    artist: (a, b) => (S(a).artists[0]?.name || '').localeCompare(S(b).artists[0]?.name || '') || S(a).name.localeCompare(S(b).name),
    album: (a, b) => S(a).album.name.localeCompare(S(b).album.name) || S(a).name.localeCompare(S(b).name),
    duration: (a, b) => S(a).durationMs - S(b).durationMs,
    added: (a, b) => S(a).addedAt.localeCompare(S(b).addedAt),
    rating: (a, b) => (S(a).rating ?? -1) - (S(b).rating ?? -1),
    listens: (a, b) => (S(a).listens || 0) - (S(b).listens || 0),
  }[by];
  if (!cmp) return null; // custom
  return (a, b) => {
    // unrated always sink to the bottom when sorting by rating
    if (by === 'rating') {
      const ra = S(a).rating, rb = S(b).rating;
      if (ra == null && rb == null) return S(a).name.localeCompare(S(b).name);
      if (ra == null) return 1;
      if (rb == null) return -1;
    }
    return cmp(a, b) * dir;
  };
}

function sortIds(ids, scopeOrder) {
  const cmp = comparator();
  if (cmp) return [...ids].sort(cmp);
  const pos = new Map(scopeOrder.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
}

// ---------- bucketing ----------
function buildBuckets() {
  const st = state.settings;
  const vis = state.order.filter(id => state.songs[id] && visible(state.songs[id]));
  const isCustomSort = st.sortBy === 'custom';
  const buckets = [];

  if (st.groupMode === 'none') {
    buckets.push({ key: '__all__', title: 'All Songs', ids: sortIds(vis, state.order), zone: '__all__', sortable: isCustomSort });
  } else if (st.groupMode === 'artist') {
    const map = new Map();
    for (const id of vis) {
      const name = state.songs[id].artists[0]?.name || 'Unknown artist';
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(id);
    }
    [...map.keys()].sort((a, b) => a.localeCompare(b)).forEach(name =>
      buckets.push({ key: 'artist:' + name, title: name, ids: sortIds(map.get(name), state.order), zone: 'artist:' + name, sortable: false }));
  } else if (st.groupMode === 'genre') {
    const map = new Map();
    for (const id of vis) {
      for (const g of songGenres(state.songs[id])) {
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(id);
      }
    }
    [...map.keys()].sort((a, b) => a.localeCompare(b)).forEach(g =>
      buckets.push({ key: 'genre:' + g, title: g, ids: sortIds(map.get(g), state.order), zone: 'genre:' + g, sortable: false }));
  } else if (st.groupMode === 'album') {
    const map = new Map();
    for (const id of vis) {
      const name = state.songs[id].album.name || 'Unknown album';
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(id);
    }
    [...map.keys()].sort((a, b) => a.localeCompare(b)).forEach(name =>
      buckets.push({ key: 'album:' + name, title: name, ids: sortIds(map.get(name), state.order), zone: 'album:' + name, sortable: false }));
  } else if (st.groupMode === 'tag') {
    const untagged = [];
    const map = new Map();
    for (const id of vis) {
      const tags = state.songs[id].tags;
      if (!tags.length) { untagged.push(id); continue; }
      for (const t of tags) {
        if (!map.has(t)) map.set(t, []);
        map.get(t).push(id);
      }
    }
    state.tags.filter(t => map.has(t.id)).forEach(t =>
      buckets.push({ key: 'tag:' + t.id, title: t.name, color: t.color, ids: sortIds(map.get(t.id), state.order), zone: 'tag:' + t.id, sortable: false }));
    if (untagged.length) buckets.push({ key: '__untagged__', title: 'Untagged', ids: sortIds(untagged, state.order), zone: '__untagged__', sortable: false });
  } else { // custom groups
    const grouped = new Set();
    for (const g of state.groups) {
      const ids = g.songIds.filter(id => state.songs[id] && visible(state.songs[id]));
      ids.forEach(id => grouped.add(id));
      buckets.push({ key: g.id, title: g.name, color: g.color, ids: sortIds(ids, g.songIds), zone: g.id, sortable: isCustomSort, isGroup: true, groupId: g.id });
    }
    const rest = vis.filter(id => !grouped.has(id));
    if (rest.length) buckets.push({ key: '__ungrouped__', title: 'Ungrouped', ids: sortIds(rest, state.order), zone: '__ungrouped__', sortable: false });
  }
  return buckets;
}

// ---------- templates ----------
function tagChips(s) {
  return s.tags.map(tid => {
    const t = state.tags.find(x => x.id === tid);
    return t ? `<span class="chip" style="border:1px solid ${esc(t.color)}55"><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</span>` : '';
  }).join('');
}

function ratingInput(s) {
  const has = s.rating != null;
  return `<input class="rating-in ${has ? 'has-val' : ''}" type="number" inputmode="numeric" min="1" max="1000"
    value="${has ? s.rating : ''}" placeholder="—" style="--rv:${s.rating ?? 0}"
    aria-label="Rating for ${esc(s.name)}, 1 to 1000" data-rate="${esc(s.id)}">`;
}

function rowHtml(s, idx, playingUri) {
  const st = state.settings;
  const tier = tierOf(s.rating);
  const tb = tierBase(tier);
  return `<div class="song-row ${st.zebra ? 'zebra' : ''} ${sel.has(s.id) ? 'is-selected' : ''} ${playingUri && s.uri === playingUri ? 'is-playing' : ''}"
      data-id="${esc(s.id)}" ${tb ? `data-tier="${tb}"` : ''} role="listitem" tabindex="0" draggable="true"
      aria-label="${esc(s.name)} by ${esc(s.artists.map(a => a.name).join(', '))}${s.rating != null ? ', rated ' + s.rating : ', unrated'}">
    <button class="drag-handle" tabindex="-1" aria-hidden="true"><svg><use href="#i-grip"/></svg></button>
    <span class="row-idx">${idx}</span>
    ${s.album.img
      ? `<img class="art" src="${esc(s.album.img)}" alt="" loading="lazy">`
      : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
    <div class="t-block">
      <div class="t-name">${esc(s.name)}</div>
      <div class="t-art">${esc(s.artists.map(a => a.name).join(', '))}</div>
    </div>
    <div class="t-album">${esc(s.album.name)}</div>
    <span class="t-listens ${s.listens ? '' : 'none'}" title="${s.listens || 0} play${s.listens === 1 ? '' : 's'} on Spotify (any device, tracked since import)"><svg><use href="#i-play"/></svg>${s.listens || 0}</span>
    <div class="t-tags">${tagChips(s)}</div>
    <span class="t-dur">${fmtMs(s.durationMs)}</span>
    <span class="tier-chip" ${tb ? `data-tier="${tb}"` : ''} aria-hidden="true">${st.showTiers && tier ? tier : ''}</span>
    ${ratingInput(s)}
  </div>`;
}

function cardHtml(s) {
  const tier = tierOf(s.rating);
  const playing = s.uri && player.nowPlayingUri() === s.uri;
  return `<div class="song-card ${sel.has(s.id) ? 'is-selected' : ''}" data-id="${esc(s.id)}" role="listitem" tabindex="0" draggable="true"
      aria-label="${esc(s.name)} by ${esc(s.artists.map(a => a.name).join(', '))}">
    ${s.album.imgLg || s.album.img
      ? `<img class="art" src="${esc(s.album.imgLg || s.album.img)}" alt="" loading="lazy">`
      : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
    <button class="btn-icon play-btn${playing ? ' is-playing' : ''}" data-play aria-label="${playing ? 'Pause' : 'Play'} ${esc(s.name)}"><svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg></button>
    <div class="t-block">
      <div class="t-name">${esc(s.name)}</div>
      <div class="t-art">${esc(s.artists.map(a => a.name).join(', '))}</div>
    </div>
    <div class="card-foot">
      ${state.settings.showTiers && tier ? `<span class="tier-chip" data-tier="${tierBase(tier)}">${tier}</span>` : '<span></span>'}
      ${ratingInput(s)}
    </div>
  </div>`;
}

function bucketHtml(b, playingUri) {
  const st = state.settings;
  const collapsed = st.collapsed[b.key];
  const cap = RENDER_CAP + (expanded[b.key] || 0);
  const shown = b.ids.slice(0, cap);
  const rated = b.ids.map(id => state.songs[id].rating).filter(r => r != null);
  const avg = rated.length ? Math.round(rated.reduce((a, r) => a + r, 0) / rated.length) : null;
  const single = state.settings.groupMode === 'none' && !st.search && st.ratedFilter === 'all';

  const body = st.layout === 'cards'
    ? `<div class="group-body card-grid" data-zone="${esc(b.zone)}" data-sortable="${b.sortable ? 1 : 0}">${shown.map(id => cardHtml(state.songs[id])).join('')}</div>`
    : `<div class="group-body" data-zone="${esc(b.zone)}" data-sortable="${b.sortable ? 1 : 0}">${shown.map((id, i) => rowHtml(state.songs[id], i + 1, playingUri)).join('')}</div>`;

  const colorStyle = b.color
    ? ` style="--gc:${esc(b.color)}"`
    : ((b.key.startsWith('artist:') || b.key.startsWith('genre:')) ? ` style="--bh:${hashHue(b.title)}"` : '');
  return `<section class="group-section ${collapsed ? 'collapsed' : ''} ${b.color ? 'gc' : ''}"${colorStyle} data-bucket="${esc(b.key)}">
    <div class="group-header" role="button" tabindex="0" aria-expanded="${!collapsed}" data-toggle="${esc(b.key)}">
      <svg class="chev"><use href="#i-chevron"/></svg>
      <h3>${b.color ? `<span class="swatch" style="background:${esc(b.color)}"></span>` : ''}${esc(b.title)}</h3>
      <span class="gh-meta">${b.ids.length} song${b.ids.length === 1 ? '' : 's'}${rated.length ? ` · ${rated.length} rated` : ''}</span>
      ${avg != null ? `<span class="gh-avg rating-in has-val" style="--rv:${avg};pointer-events:none">${avg}</span>` : ''}
      ${b.isGroup ? `<button class="btn-icon sm" data-edit-group="${esc(b.groupId)}" aria-label="Edit group ${esc(b.title)}"><svg><use href="#i-edit"/></svg></button>` : ''}
    </div>
    ${collapsed ? '' : body}
    ${!collapsed && b.ids.length > cap ? `<button class="btn btn-ghost sm show-more" data-more="${esc(b.key)}">Show ${Math.min(RENDER_CAP, b.ids.length - cap)} more (${b.ids.length - cap} hidden)</button>` : ''}
  </section>`;
}

// ---------- tier board ----------
function buildTierBuckets() {
  const vis = state.order.filter(id => state.songs[id] && visible(state.songs[id]));
  const map = Object.fromEntries(TIER_ORDER.map(t => [t, []]));
  for (const id of vis) map[tierOf(state.songs[id].rating) || 'U'].push(id);
  const byRating = (a, b) => (state.songs[b].rating ?? 0) - (state.songs[a].rating ?? 0);
  return TIER_ORDER.map(t => ({ key: 'tier:' + t, title: t, ids: map[t].sort(byRating), zone: 'tier:' + t, sortable: true, tier: t }));
}

function tierCardHtml(s) {
  return `<div class="tier-card ${sel.has(s.id) ? 'is-selected' : ''}" data-id="${esc(s.id)}" role="listitem" tabindex="0" draggable="true"
      aria-label="${esc(s.name)} by ${esc(s.artists.map(a => a.name).join(', '))}${s.rating != null ? ', rated ' + s.rating : ', unrated'}">
    ${s.album.img
      ? `<img class="art" src="${esc(s.album.img)}" alt="" loading="lazy">`
      : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
    <span class="t-block"><span class="t-name" style="display:block">${esc(s.name)}</span><span class="t-art" style="display:block">${esc(s.artists[0]?.name || '')}</span></span>
    ${s.rating != null ? `<span class="rating-in has-val" style="--rv:${s.rating}">${s.rating}</span>` : ''}
  </div>`;
}

function tierBoardHtml() {
  return '<p class="tier-hint">Drag songs between tiers to set their rating (SS=1000, S=975, A=875, B=725, C=575, D=425, F=175; Unrated clears it). Double-click a song for details.</p><div class="tier-board">'
    + lastBuckets.map(b => `
    <section class="tier-row" data-tier-key="${b.tier}" data-tier-base="${tierBase(b.tier) || 'U'}" style="--tc:var(--tier-${(tierBase(b.tier) || 'u').toLowerCase()})">
      <div class="tier-label">${b.tier === 'U' ? '<span style="font-size:.85rem">Unrated</span>' : b.tier}<span class="tier-count">${b.ids.length}</span></div>
      <div class="tier-body" data-zone="tier:${b.tier}" data-sortable="1">${b.ids.map(id => tierCardHtml(state.songs[id])).join('')}</div>
    </section>`).join('') + '</div>';
}

// ---------- main render ----------
export function render() {
  const root = $('#view');
  const st = state.settings;

  if (st.view === 'stats') return; // stats.js owns the view

  root.classList.toggle('no-art', !st.showArt);
  root.classList.toggle('no-tiers', !st.showTiers);

  if (!Object.keys(state.songs).length) {
    root.innerHTML = `<div class="empty-state">
      <svg><use href="#i-music"/></svg>
      <h2>Your library is empty</h2>
      <p>Connect your Spotify account and import liked songs, playlists, or full artist discographies — or load sample data to explore the app first.</p>
      <div class="empty-actions">
        <button class="btn btn-spotify" data-es="connect"><svg><use href="#i-spotify"/></svg>Connect Spotify</button>
        <button class="btn btn-primary" data-es="import"><svg><use href="#i-download"/></svg>Import music</button>
        <button class="btn" data-es="sample">Load sample data</button>
      </div></div>`;
    flatIds = [];
    lastBuckets = [];
    return;
  }

  // "My Groups" grouping with no groups created yet: dumping everything into a
  // lone "Ungrouped" section reads as "groups don't work". Guide the user instead.
  if (st.groupMode === 'group' && !state.groups.length) {
    root.innerHTML = `<div class="empty-state">
      <svg><use href="#i-folder"/></svg>
      <h2>No groups yet</h2>
      <p>Groups are your own custom buckets: playlist drafts, tiers, moods. Create one with the + in the sidebar, then drag songs in or use a song's menu to add it.</p>
      <div class="empty-actions"><button class="btn btn-primary" data-es="new-group"><svg><use href="#i-plus"/></svg>Create a group</button></div></div>`;
    flatIds = [];
    lastBuckets = [];
    return;
  }

  const tiers = st.layout === 'tiers';
  lastBuckets = tiers ? buildTierBuckets() : buildBuckets();
  flatIds = tiers
    ? lastBuckets.flatMap(b => b.ids)
    : lastBuckets.flatMap(b => state.settings.collapsed[b.key] ? [] : b.ids.slice(0, RENDER_CAP + (expanded[b.key] || 0)));
  const playingUri = player.currentUri();

  // Base the empty-state on whether any songs survive the filters — NOT on flatIds,
  // which omits collapsed buckets. Otherwise collapsing every section wipes the
  // headers too and the songs become unreachable (no chevron left to expand).
  const totalVisible = lastBuckets.reduce((n, b) => n + b.ids.length, 0);
  if (!totalVisible) {
    root.innerHTML = `<div class="empty-state"><svg><use href="#i-filter"/></svg>
      <h2>No songs match</h2><p>Try clearing the search or filters.</p>
      <div class="empty-actions"><button class="btn" data-es="clear-filters">Clear filters</button></div></div>`;
    return;
  }

  root.innerHTML = tiers ? tierBoardHtml() : lastBuckets.map(b => bucketHtml(b, playingUri)).join('');

  // Restore row focus ONLY if focus was already inside the list (or lost to
  // <body> by the re-render). Stealing it from the search box / filter inputs
  // kicked the user out of the field on every keystroke-triggered re-render.
  if (lastFocusId && (document.activeElement === document.body || root.contains(document.activeElement))) {
    const el = root.querySelector(`[data-id="${CSS.escape(lastFocusId)}"]`);
    el?.focus({ preventScroll: true });
  }
  syncSelectionUi();
}

function syncSelectionUi() {
  $$('#view [data-id]').forEach(el => {
    el.classList.toggle('is-selected', sel.has(el.dataset.id));
  });
  const bar = $('#bulk-bar');
  bar.hidden = sel.size === 0;
  $('#bulk-count').textContent = sel.size + ' selected';
}

// ---------- selection ----------
function selectRange(toId) {
  const a = flatIds.indexOf(lastClickedId), b = flatIds.indexOf(toId);
  if (a === -1 || b === -1) return;
  flatIds.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(id => sel.add(id));
}

function handleSelectClick(id, e) {
  if (e.shiftKey && lastClickedId) selectRange(id);
  else if (e.ctrlKey || e.metaKey) { sel.has(id) ? sel.delete(id) : sel.add(id); lastClickedId = id; }
  else { sel.clear(); sel.add(id); lastClickedId = id; }
  syncSelectionUi();
}

// ---------- playback ----------
export async function playFrom(id) {
  const bucket = lastBuckets.find(b => b.ids.includes(id));
  const list = (bucket?.ids || [id]).map(x => state.songs[x]).filter(s => s.uri);
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) { emit('toast', { msg: 'This track has no Spotify audio (sample data)', type: 'err' }); return; }
  try {
    await player.playList(list, idx);
  } catch (e) {
    emit('toast', { msg: e.message, type: 'err' });
  }
}

// Plain click on a song toggles playback: the loaded track pauses/resumes; any
// other track starts playing (queued from its bucket).
function togglePlay(id) {
  const s = state.songs[id];
  if (s && s.uri && player.currentUri() === s.uri) player.toggle();
  else playFrom(id);
}

// ---------- event wiring (once) ----------
export function initViews() {
  const root = $('#view');

  root.addEventListener('click', e => {
    const more = e.target.closest('[data-more]');
    if (more) { expanded[more.dataset.more] = (expanded[more.dataset.more] || 0) + RENDER_CAP; render(); return; }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle && !e.target.closest('[data-edit-group]')) {
      const k = toggle.dataset.toggle;
      state.settings.collapsed[k] = !state.settings.collapsed[k];
      emit('settings', {}); return;
    }
    const editG = e.target.closest('[data-edit-group]');
    if (editG) { emit('edit-group', editG.dataset.editGroup); return; }
    const es = e.target.closest('[data-es]');
    if (es) { emit('empty-action', es.dataset.es); return; }

    const item = e.target.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id;
    // Explicit play button (cards) → immediate play/pause toggle.
    if (e.target.closest('[data-play], .play-btn')) { clearTimeout(clickTimer); togglePlay(id); return; }
    // Ctrl / Cmd / Shift click builds a multi-selection for the bulk-action bar.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (e.target.closest('input, button, a')) return;
      clearTimeout(clickTimer);
      handleSelectClick(id, e);
      return;
    }
    // Leave the rating box and other inline controls to handle their own clicks.
    if (e.target.closest('input, button, a')) return;
    // Plain left-click plays the song. Defer briefly so a double-click (open
    // details) can cancel it instead of firing playback then opening the modal.
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => togglePlay(id), 200);
  });

  root.addEventListener('dblclick', e => {
    const item = e.target.closest('[data-id]');
    if (item && !e.target.closest('input, button')) { clearTimeout(clickTimer); emit('song-detail', item.dataset.id); }
  });

  root.addEventListener('contextmenu', e => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    e.preventDefault();
    const id = item.dataset.id;
    emit('ctx-menu', { x: e.clientX, y: e.clientY, ids: sel.has(id) ? [...sel] : [id] });
  });

  root.addEventListener('change', e => {
    const rate = e.target.closest('[data-rate]');
    if (rate) {
      const v = rate.value === '' ? null : clamp(parseInt(rate.value) || 1, 1, 1000);
      setRating([rate.dataset.rate], v);
      announce(v == null ? 'Rating cleared' : 'Rated ' + v);
    }
  });

  root.addEventListener('keydown', e => {
    const k = e.key;
    const toggle = e.target.closest('[data-toggle]');
    if (toggle && (k === 'Enter' || k === ' ')) { e.preventDefault(); toggle.click(); return; }
    if (e.target.closest('input, select, textarea')) {
      if (k === 'Enter') e.target.blur();
      return;
    }
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const id = item.dataset.id;
    const s = state.songs[id];
    lastFocusId = id;

    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      const zone = item.closest('[data-zone]');
      if (zone?.dataset.sortable !== '1') { announce('Switch sort to Custom order to reorder'); return; }
      const bucket = lastBuckets.find(b => b.zone === zone.dataset.zone);
      const i = bucket.ids.indexOf(id);
      const to = k === 'ArrowUp' ? i - 1 : i + 1;
      if (to < 0 || to >= bucket.ids.length) return;
      moveIds(zone.dataset.zone === '__all__' ? '__all__' : zone.dataset.zone, [id], to);
      announce(`Moved to position ${to + 1}`);
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'j' || k === 'k') {
      e.preventDefault();
      const rows = $$('#view [data-id]');
      const i = rows.indexOf(item);
      const nxt = rows[i + ((k === 'ArrowDown' || k === 'j') ? 1 : -1)];
      nxt?.focus();
      if (nxt) lastFocusId = nxt.dataset.id;
      return;
    }
    if (k === '[' || k === ']') {
      e.preventDefault();
      const delta = (k === ']' ? 1 : -1) * (e.shiftKey ? 50 : 10);
      adjustRating(id, delta);
      announce('Rating ' + state.songs[id].rating);
      return;
    }
    if (/^[0-9]$/.test(k) && !e.ctrlKey && !e.altKey) {
      // quick-rate: type digits on a focused song (e.g. 8,5,0 -> 850); commits after a pause
      e.preventDefault();
      digitBuf += k;
      clearTimeout(digitTimer);
      const commit = () => {
        const v = clamp(parseInt(digitBuf, 10) || 1, 1, 1000);
        digitBuf = '';
        setRating([id], v);
        announce('Rated ' + v);
      };
      if (digitBuf.length >= 4 || parseInt(digitBuf + '0', 10) > 1000) commit();
      else digitTimer = setTimeout(commit, 650);
      return;
    }
    if (k === 'r') { e.preventDefault(); item.querySelector('[data-rate]')?.focus(); return; }
    if (k === 'p') { e.preventDefault(); playFrom(id); return; }
    if (k === 'x') { e.preventDefault(); sel.has(id) ? sel.delete(id) : sel.add(id); lastClickedId = id; syncSelectionUi(); return; }
    if (k === 'Enter') { e.preventDefault(); emit('song-detail', id); return; }
    if (k === 'Delete') { e.preventDefault(); emit('delete-songs', sel.has(id) ? [...sel] : [id]); return; }
    if (k === 'm') {
      e.preventDefault();
      const r = item.getBoundingClientRect();
      emit('ctx-menu', { x: r.left + 60, y: r.top + r.height / 2, ids: sel.has(id) ? [...sel] : [id] });
    }
  });

  root.addEventListener('focusin', e => {
    const item = e.target.closest?.('[data-id]');
    if (item) lastFocusId = item.dataset.id;
  });
}
