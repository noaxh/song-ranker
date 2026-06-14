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
import * as player from './player.js';
import * as dnd from './dnd.js';
import * as lib from './library.js';
import { toast, ctxMenu, shortcutsModal, confirm } from './ui.js';
import * as modals from './modals.js';
import { importModal } from './import.js';
import * as cloud from './cloud.js';

// Reset target for "Clear filters" — keep grouping in here so genre/group views
// are exitable via Clear, not just via the All pill.
const CLEARED_FILTERS = { search: '', filterTags: [], ratedFilter: 'all', minRating: 1, maxRating: 1000, groupMode: 'none', collapsed: {} };

// ---------- render orchestration ----------
function renderAll() {
  if (state.settings.view === 'stats') stats.render();
  else if (state.settings.view === 'faceoff') faceoff.render();
  else if (state.settings.view === 'rank') rank.render();
  else if (state.settings.view === 'ranks') leaderboard.render();
  else if (state.settings.view === 'home') home.render();
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
  syncVal('#sort-by', s.sortBy);
  $('#sort-dir').style.transform = s.sortDir === 'asc' ? 'scaleY(-1)' : '';
  const nextLayout = { rows: ['grid', 'Switch to cards'], cards: ['tiers', 'Switch to tier board'], tiers: ['rows', 'Switch to rows'] }[s.layout] || ['grid', 'Switch layout'];
  $('#layout-toggle').innerHTML = `<svg><use href="#i-${nextLayout[0]}"/></svg>`;
  $('#layout-toggle').title = nextLayout[1];
  $('#layout-toggle').setAttribute('aria-label', nextLayout[1]);
  $('#btn-undo').disabled = !canUndo();
  $$('#filterbar .pill[data-gm]').forEach(p => p.classList.toggle('is-active', p.dataset.gm === s.groupMode));
  syncVal('#rated-filter', s.ratedFilter);
  syncVal('#min-rating', s.minRating);
  syncVal('#max-rating', s.maxRating);
  $$('.nav-item').forEach(n => n.classList.toggle('is-active', n.dataset.view === s.view));
  // Filters only make sense in the library — face-off has its own battle scopes now.
  $('#filterbar').style.display = s.view === 'library' ? '' : 'none';
  $('#app').classList.toggle('sb-collapsed', !!s.sidebarCollapsed);

  const btn = $('#btn-connect');
  const p = auth.getProfile();
  btn.classList.toggle('connected', auth.isConnected());
  btn.querySelector('span').textContent = auth.isConnected() ? (p?.display_name || 'Connected') : 'Connect';

  // active tag filter chips
  $('#active-tag-filters').innerHTML = s.filterTags.map(tid => {
    const t = state.tags.find(x => x.id === tid);
    return t ? `<button class="chip removable" data-untag="${t.id}" aria-label="Remove filter ${esc(t.name)}">
      <span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)} ✕</button>` : '';
  }).join('');
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

// Click on a playlist: open its mirrored group if imported, otherwise offer import.
async function openPlaylist(plId) {
  const p = state.spotifyPlaylists.find(x => x.id === plId);
  if (!p) return;
  const g = state.groups.find(x => x.name === p.name && x.songIds.length);
  if (g) {
    setSettings({ view: 'library', groupMode: 'group' });
    requestAnimationFrame(() => $(`[data-bucket="${CSS.escape(g.id)}"]`)?.scrollIntoView({ block: 'start' }));
    return;
  }
  if (await confirm(`Import "${p.name}" (${p.total ?? '?'} tracks)? Tracks are added to your library and mirrored as a group so you can browse and battle it.`, { okLabel: 'Import' })) {
    try {
      const r = await lib.importPlaylist(plId, { asGroupNamed: p.name });
      toast(`${p.name}: ${r.added} added, ${r.skipped} already in library`, 'ok');
      setSettings({ view: 'library', groupMode: 'group' });
    } catch (e) { toast(e.message, 'err', 6000); }
  }
}

// ---------- context menu for songs ----------
function showSongMenu({ x, y, ids }) {
  const single = ids.length === 1 ? state.songs[ids[0]] : null;
  const items = [];
  if (single?.uri) items.push({ label: 'Play', icon: 'play', action: () => views.playFrom(single.id) });
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

function connectFlow() {
  if (auth.isConnected()) { modals.settings('spotify'); return; }
  // With a baked-in (or saved) client id, go straight to the Spotify consent
  // screen. Only fall back to the setup panel when no id exists anywhere.
  if (!auth.hasClientId()) { modals.settings('spotify'); return; }
  auth.connect().catch(e => toast(e.message, 'err'));
}

// ---------- chrome bindings ----------
function bindChrome() {
  $('#search').addEventListener('input', debounce(e => setSetting('search', e.target.value), 200));
  $('#sort-by').addEventListener('change', e => setSetting('sortBy', e.target.value));
  $('#sort-dir').addEventListener('click', () => setSetting('sortDir', state.settings.sortDir === 'asc' ? 'desc' : 'asc'));
  $('#layout-toggle').addEventListener('click', () => {
    const order = ['rows', 'cards', 'tiers'];
    setSetting('layout', order[(order.indexOf(state.settings.layout) + 1) % order.length]);
  });
  $('#btn-undo').addEventListener('click', doUndo);
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
    const untag = e.target.closest('[data-untag]');
    if (untag) setSetting('filterTags', state.settings.filterTags.filter(t => t !== untag.dataset.untag));
    if (e.target.closest('#btn-clear-filters')) {
      setSettings({ ...CLEARED_FILTERS });
    }
  });
  $('#rated-filter').addEventListener('change', e => setSetting('ratedFilter', e.target.value));
  $('#min-rating').addEventListener('change', e => setSetting('minRating', clamp(+e.target.value || 1, 1, 1000)));
  $('#max-rating').addEventListener('change', e => setSetting('maxRating', clamp(+e.target.value || 1000, 1, 1000)));

  $('.sidebar nav').addEventListener('click', e => {
    const n = e.target.closest('[data-view]');
    if (n) { setSetting('view', n.dataset.view); $('#sidebar').classList.remove('open'); }
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

function bindBus() {
  on('songs groups tags settings auth player playlists', renderSoon);
  on('toast', d => toast(d.msg, d.type));
  on('ctx-menu', showSongMenu);
  on('song-detail', id => modals.songDetail(id));
  on('edit-group', gid => modals.groupEditor(state.groups.find(g => g.id === gid)));
  on('delete-songs', deleteSongs);
  on('do-undo', doUndo);
  on('open-playlist', openPlaylist);
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
themes.apply();
themes.initStars();
views.initViews();
faceoff.init();
rank.init();
tourney.init();
leaderboard.init();
home.init();
player.bindBarControls();
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
    }).catch(() => {});
    refreshPlaylists();
    syncPlays();
    setInterval(syncPlays, 180000);
    // Genres are fetched once at import time; if that call failed (expired token,
    // network, closed tab mid-import) nothing retried — so retry unresolved artists here.
    lib.enrichGenres().catch(e => console.warn('genre enrichment failed', e));
    player.init().catch(console.error);
  }
})();
