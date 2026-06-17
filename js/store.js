// Central state, persistence (localStorage), pub/sub events, undo stack.
import { uid, debounce, clamp } from './utils.js';

const KEY = 'songranker.v1';
// Persisted schema version. v2 = ratings on the 1-1000 scale (v1 was 1-100).
const SCHEMA = 2;

export const DEFAULT_SETTINGS = {
  theme: 'midnight', customVars: {}, customThemes: [],
  density: 'cozy', fontScale: 100, motion: 'auto',
  bgStyle: 'stars',          // 'stars' | 'blobs' | 'both' | 'off'
  sidebarCollapsed: false,
  view: 'home', layout: 'rows', groupMode: 'none',
  openTarget: null,          // Playlist Overview target { type, id, name, img?, back }
  sortBy: 'added', sortDir: 'desc',
  search: '', filterTags: [], recentTags: [], ratedFilter: 'all', minRating: 1, maxRating: 1000,
  activeGroup: null, activeArtist: null, activeGenre: null,
  showArt: true, showTiers: true, zebra: false, glass: true,
  clientId: '', collapsed: {},
  // Cloud sync via a Supabase Edge Function (identity verified server-side from
  // your Spotify token). The function URL + anon key are baked into cloud.js;
  // these optional overrides let a different install point at its own deploy.
  cloudFnUrl: '', cloudAnonKey: '', cloudSync: false, cloudLastSync: '',
};

export const state = {
  songs: {},          // id -> song record
  order: [],          // global custom order (song ids)
  groups: [],         // { id, name, color, songIds: [] }
  tags: [],           // { id, name, color }
  artistGenres: {},   // artistId -> [genre]
  spotifyPlaylists: [], // cached { id, name, total, img } for the sidebar
  playCursor: 0,      // unix ms of the newest Spotify play already counted
  settings: { ...DEFAULT_SETTINGS },
};

// ---------- events ----------
const bus = new EventTarget();
export function on(ev, fn) { ev.split(' ').forEach(e => bus.addEventListener(e, x => fn(x.detail))); }
export function emit(ev, detail) { bus.dispatchEvent(new CustomEvent(ev, { detail })); }

// ---------- persistence ----------
function writeNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      schema: SCHEMA,
      songs: state.songs, order: state.order, groups: state.groups,
      tags: state.tags, artistGenres: state.artistGenres,
      spotifyPlaylists: state.spotifyPlaylists, playCursor: state.playCursor,
      settings: state.settings,
    }));
  } catch (e) { console.error('persist failed', e); }
}
const persist = debounce(writeNow, 250);
// Synchronous flush — needed before navigating away (OAuth redirect kills pending debounce).
export const saveNow = writeNow;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(state, {
      songs: d.songs || {}, order: d.order || [], groups: d.groups || [],
      tags: d.tags || [], artistGenres: d.artistGenres || {},
      spotifyPlaylists: d.spotifyPlaylists || [],
      playCursor: d.playCursor || 0,
      settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    });
    // v1 stored ratings 1-100; rescale to the 1-1000 scale once.
    if ((d.schema | 0) < 2) {
      scaleRatings(state.songs, 10);
      if (state.settings.maxRating <= 100) state.settings.maxRating = 1000;
      writeNow();
    }
  } catch (e) { console.error('load failed', e); }
}

// Multiply every song's rating by `factor`, clamped to the 1-1000 scale.
function scaleRatings(songs, factor) {
  for (const s of Object.values(songs)) {
    if (s.rating != null) s.rating = clamp(Math.round(s.rating * factor), 1, 1000);
  }
}

function touch(...events) { persist(); events.forEach(e => emit(e)); }

// ---------- undo ----------
const undoStack = [];
function pushUndo(label, fn) {
  undoStack.push({ label, fn });
  if (undoStack.length > 50) undoStack.shift();
}
export function undo() {
  const u = undoStack.pop();
  if (!u) return null;
  u.fn();
  touch('songs', 'groups', 'tags');
  return u.label;
}
export const canUndo = () => undoStack.length > 0;

// ---------- songs ----------
export function addSongs(list) {
  let added = 0, skipped = 0;
  for (const s of list) {
    if (state.songs[s.id]) { skipped++; continue; }
    state.songs[s.id] = s;
    state.order.push(s.id);
    added++;
  }
  if (added) touch('songs');
  return { added, skipped };
}

export function removeSongs(ids) {
  const removed = [], orderIdx = new Map(state.order.map((id, i) => [id, i]));
  const groupsBackup = state.groups.map(g => ({ id: g.id, songIds: [...g.songIds] }));
  for (const id of ids) {
    if (!state.songs[id]) continue;
    removed.push([state.songs[id], orderIdx.get(id)]);
    delete state.songs[id];
  }
  const idSet = new Set(ids);
  state.order = state.order.filter(id => !idSet.has(id));
  state.groups.forEach(g => { g.songIds = g.songIds.filter(id => !idSet.has(id)); });
  pushUndo(`Removed ${removed.length} song(s)`, () => {
    removed.sort((a, b) => a[1] - b[1]).forEach(([s, i]) => {
      state.songs[s.id] = s;
      state.order.splice(Math.min(i, state.order.length), 0, s.id);
    });
    groupsBackup.forEach(b => {
      const g = state.groups.find(x => x.id === b.id);
      if (g) g.songIds = b.songIds;
    });
  });
  touch('songs', 'groups');
}

export function setRating(ids, val) {
  val = val == null ? null : clamp(Math.round(val), 1, 1000);
  const prev = ids.map(id => [id, state.songs[id]?.rating]);
  const now = new Date().toISOString();
  ids.forEach(id => {
    const s = state.songs[id];
    if (s) { s.rating = val; if (val != null) s.ratedAt = now; }
  });
  pushUndo(`Rating change (${ids.length})`, () =>
    prev.forEach(([id, r]) => { if (state.songs[id]) state.songs[id].rating = r; }));
  touch('songs');
}

// Set several ratings as ONE undoable action (used by Face-off duels).
export function setRatingsMap(entries, label = 'Rating change') {
  const prev = entries.map(([id]) => [id, state.songs[id]?.rating]);
  const now = new Date().toISOString();
  entries.forEach(([id, v]) => {
    const s = state.songs[id];
    if (s) { s.rating = v == null ? null : clamp(Math.round(v), 1, 1000); if (v != null) s.ratedAt = now; }
  });
  pushUndo(label, () =>
    prev.forEach(([id, r]) => { if (state.songs[id]) state.songs[id].rating = r; }));
  touch('songs');
}

export function adjustRating(id, delta) {
  const s = state.songs[id];
  if (!s) return;
  setRating([id], clamp((s.rating ?? 500) + delta, 1, 1000));
}

export function setNote(id, text) {
  if (state.songs[id]) { state.songs[id].note = text; touch('songs'); }
}

// ---------- listens (synced from Spotify's recently-played feed) ----------
// counts: { songId: n }. Applied in bulk after each poll of /me/player/recently-played.
export function addListens(counts) {
  let changed = false;
  for (const [id, n] of Object.entries(counts)) {
    const s = state.songs[id];
    if (s && n > 0) { s.listens = (s.listens || 0) + n; changed = true; }
  }
  if (changed) touch('songs');
}
export function setPlayCursor(ms) {
  state.playCursor = ms;
  persist();
}

// ---------- tags ----------
export function createTag(name, color) {
  const t = { id: uid(), name, color };
  state.tags.push(t);
  touch('tags');
  return t;
}
export function updateTag(id, patch) {
  const t = state.tags.find(x => x.id === id);
  if (t) { Object.assign(t, patch); touch('tags', 'songs'); }
}
export function deleteTag(id) {
  state.tags = state.tags.filter(t => t.id !== id);
  Object.values(state.songs).forEach(s => { s.tags = s.tags.filter(t => t !== id); });
  state.settings.filterTags = state.settings.filterTags.filter(t => t !== id);
  touch('tags', 'songs', 'settings');
}
export function toggleTag(ids, tagId, force) {
  const prev = ids.map(id => [id, [...(state.songs[id]?.tags || [])]]);
  let added = false;
  ids.forEach(id => {
    const s = state.songs[id];
    if (!s) return;
    const has = s.tags.includes(tagId);
    const want = force !== undefined ? force : !has;
    if (want && !has) { s.tags.push(tagId); added = true; }
    if (!want && has) s.tags = s.tags.filter(t => t !== tagId);
  });
  if (added) markTagUsed(tagId);   // feeds the "recent tags" context submenu
  pushUndo(`Tag change (${ids.length})`, () =>
    prev.forEach(([id, tags]) => { if (state.songs[id]) state.songs[id].tags = tags; }));
  touch('songs');
}

// Most-recently-used tag ids, newest first. Persists via settings.
function markTagUsed(tagId) {
  const r = state.settings.recentTags.filter(t => t !== tagId);
  r.unshift(tagId);
  state.settings.recentTags = r.slice(0, 12);
}

// ---------- groups ----------
export function createGroup(name, color) {
  const g = { id: uid(), name, color, songIds: [] };
  state.groups.push(g);
  touch('groups');
  return g;
}
export function updateGroup(id, patch) {
  const g = state.groups.find(x => x.id === id);
  if (g) { Object.assign(g, patch); touch('groups'); }
}
export function deleteGroup(id) {
  state.groups = state.groups.filter(g => g.id !== id);
  if (state.settings.activeGroup === id) state.settings.activeGroup = null;
  touch('groups', 'settings');
}
export function addToGroup(ids, groupId) {
  const g = state.groups.find(x => x.id === groupId);
  if (!g) return 0;
  let n = 0;
  ids.forEach(id => { if (state.songs[id] && !g.songIds.includes(id)) { g.songIds.push(id); n++; } });
  if (n) {
    pushUndo(`Added ${n} to ${g.name}`, () => {
      const idSet = new Set(ids);
      g.songIds = g.songIds.filter(x => !idSet.has(x));
    });
    touch('groups');
  }
  return n;
}
export function removeFromGroup(ids, groupId) {
  const g = state.groups.find(x => x.id === groupId);
  if (!g) return;
  const prev = [...g.songIds];
  const idSet = new Set(ids);
  g.songIds = g.songIds.filter(x => !idSet.has(x));
  pushUndo(`Removed from ${g.name}`, () => { g.songIds = prev; });
  touch('groups');
}

// ---------- ordering (drag & drop / keyboard move) ----------
// scope: '__all__' for global order, otherwise a group id.
export function moveIds(scope, ids, toIndex) {
  const arr = scope === '__all__'
    ? state.order
    : state.groups.find(g => g.id === scope)?.songIds;
  if (!arr) return;
  const prev = [...arr];
  const idSet = new Set(ids);
  const moving = arr.filter(id => idSet.has(id));
  const rest = arr.filter(id => !idSet.has(id));
  // toIndex is relative to the array WITHOUT the moving items already removed
  const idx = clamp(toIndex, 0, rest.length);
  const next = [...rest.slice(0, idx), ...moving, ...rest.slice(idx)];
  if (scope === '__all__') state.order = next;
  else state.groups.find(g => g.id === scope).songIds = next;
  pushUndo('Reorder', () => {
    if (scope === '__all__') state.order = prev;
    else { const g = state.groups.find(x => x.id === scope); if (g) g.songIds = prev; }
  });
  touch(scope === '__all__' ? 'songs' : 'groups');
}

// ---------- Spotify playlist cache (sidebar) ----------
export function setSpotifyPlaylists(list) {
  state.spotifyPlaylists = list;
  touch('playlists');
}

// ---------- genres ----------
export function setArtistGenres(map) {
  Object.assign(state.artistGenres, map);
  touch('songs');
}
// `artistGenres` defaults to the global map but can be passed a friend's map so
// read-only friend views resolve genres against the friend's data, not yours.
export function songGenres(song, artistGenres = state.artistGenres) {
  const out = [];
  for (const a of song.artists) {
    for (const g of (artistGenres[a.id] || [])) if (!out.includes(g)) out.push(g);
  }
  return out.length ? out : ['Unknown genre'];
}

// ---------- settings ----------
export function setSetting(k, v) {
  state.settings[k] = v;
  persist();
  emit('settings', { k, v });
}
export function setSettings(obj) {
  Object.assign(state.settings, obj);
  persist();
  emit('settings', {});
}

// ---------- import / export ----------
export function exportData() {
  return JSON.stringify({
    app: 'song-ranker', version: 2, exportedAt: new Date().toISOString(),
    songs: state.songs, order: state.order, groups: state.groups,
    tags: state.tags, artistGenres: state.artistGenres, settings: state.settings,
  }, null, 2);
}

export function importData(json, { merge = true } = {}) {
  const d = JSON.parse(json);
  if (d.app !== 'song-ranker') throw new Error('Not a Song Ranker export file');
  // Pre-v2 exports carry 1-100 ratings; rescale before merging into the 1-1000 store.
  if ((d.version | 0) < 2 && d.songs) scaleRatings(d.songs, 10);
  if (!merge) {
    Object.assign(state, {
      songs: d.songs || {}, order: d.order || [], groups: d.groups || [],
      tags: d.tags || [], artistGenres: d.artistGenres || {},
      settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
    });
  } else {
    Object.entries(d.songs || {}).forEach(([id, s]) => {
      if (!state.songs[id]) { state.songs[id] = s; state.order.push(id); }
      else {
        const cur = state.songs[id];
        if (cur.rating == null && s.rating != null) cur.rating = s.rating;
        s.tags?.forEach(t => { if (!cur.tags.includes(t)) cur.tags.push(t); });
      }
    });
    (d.tags || []).forEach(t => { if (!state.tags.find(x => x.id === t.id)) state.tags.push(t); });
    (d.groups || []).forEach(g => {
      const cur = state.groups.find(x => x.id === g.id);
      if (!cur) state.groups.push(g);
      else g.songIds.forEach(id => { if (!cur.songIds.includes(id)) cur.songIds.push(id); });
    });
    Object.assign(state.artistGenres, d.artistGenres || {});
  }
  touch('songs', 'groups', 'tags', 'settings');
}

export function clearLibrary() {
  state.songs = {}; state.order = [];
  state.groups.forEach(g => { g.songIds = []; });
  touch('songs', 'groups');
}

// ---------- cloud sync (library-only) ----------
// The rating-critical data that follows the user across devices. Deliberately
// excludes settings, the Spotify playlist cache and the play cursor — those are
// device-local and must not fight across phone/desktop.
export function cloudSnapshot() {
  return {
    songs: state.songs, order: state.order, groups: state.groups,
    tags: state.tags, artistGenres: state.artistGenres,
  };
}

// Apply a snapshot pulled from the cloud.
//  merge=true  → union: never drops a local rating/tag; fills gaps from remote.
//  merge=false → replace the local library wholesale (authoritative download).
// Settings are never written here, so a sync can't change this device's theme.
export function applyCloudSnapshot(d, { merge = true } = {}) {
  if (!d) return;
  if (!merge) {
    state.songs = d.songs || {};
    state.order = d.order || [];
    state.groups = d.groups || [];
    state.tags = d.tags || [];
    state.artistGenres = d.artistGenres || {};
  } else {
    Object.entries(d.songs || {}).forEach(([id, s]) => {
      const cur = state.songs[id];
      if (!cur) { state.songs[id] = s; state.order.push(id); return; }
      if (cur.rating == null && s.rating != null) { cur.rating = s.rating; cur.ratedAt = s.ratedAt; }
      (s.tags || []).forEach(t => { if (!cur.tags.includes(t)) cur.tags.push(t); });
      if ((s.listens || 0) > (cur.listens || 0)) cur.listens = s.listens;
      if (!cur.note && s.note) cur.note = s.note;
    });
    (d.tags || []).forEach(t => { if (!state.tags.find(x => x.id === t.id)) state.tags.push(t); });
    (d.groups || []).forEach(g => {
      const cur = state.groups.find(x => x.id === g.id);
      if (!cur) state.groups.push({ ...g, songIds: [...g.songIds] });
      else g.songIds.forEach(id => { if (!cur.songIds.includes(id)) cur.songIds.push(id); });
    });
    Object.assign(state.artistGenres, d.artistGenres || {});
  }
  touch('songs', 'groups', 'tags');
}
