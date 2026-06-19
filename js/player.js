// Spotify Web Playback SDK integration (Premium accounts).
// Playback is driven by a client-managed queue: we feed Spotify ONE track at a
// time and detect end-of-track ourselves, so shuffle / repeat / sequential
// auto-advance behave predictably regardless of Spotify's ad-hoc context quirks.
import * as auth from './auth.js';
import * as api from './api.js';
import { $, esc, fmtMs, announce } from './utils.js';
import { emit } from './store.js';
import { removeFromQueue, reorderIndices } from './queue-order.js';

let player = null;
let deviceId = null;
let sdkReady = null;
let current = { uri: null, paused: true, duration: 0, position: 0 };
let positionTimer = null;

// ---------- client-managed queue ----------
let queue = [];          // [{ uri, name, artists, art }] in original order
let order = [];          // indices into `queue`, in play order (shuffle-aware)
let orderPos = 0;        // current position within `order`
let shuffle = false;
let repeat = 'off';      // 'off' | 'all' | 'one'
let lastState = null;    // previous SDK state, for end-of-track detection
let endedUri = null;     // guards against double-firing the end-of-track signal
let deviceActivated = false; // has our SDK device been made the active Connect device?

export const isReady = () => !!deviceId;
export const nowPlayingUri = () => (current.paused ? null : current.uri);
export const currentUri = () => current.uri;
export const getCurrent = () => ({ ...current });   // snapshot for the now-playing overlay
export const getShuffle = () => shuffle;
export const getRepeat = () => repeat;

function loadSdk() {
  if (sdkReady) return sdkReady;
  sdkReady = new Promise(resolve => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(s);
  });
  return sdkReady;
}

export async function init() {
  if (player || !auth.isConnected()) return;
  await loadSdk();
  player = new Spotify.Player({
    name: 'Song Ranker',
    getOAuthToken: cb => auth.getToken().then(t => t && cb(t)),
    volume: 0.7,
  });
  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    deviceActivated = false;   // fresh device id — must (re)activate before play
    // Bar stays hidden until a track is actually loaded (see renderBar).
    emit('player');
  });
  player.addListener('not_ready', () => { deviceId = null; deviceActivated = false; $('#playerbar').hidden = true; emit('player'); });
  player.addListener('initialization_error', e => console.error('SDK init', e));
  player.addListener('authentication_error', e => console.error('SDK auth', e));
  player.addListener('account_error', e => {
    console.warn('SDK account (Premium required)', e);
    emit('player-error', 'Playback needs Spotify Premium');
  });
  player.addListener('player_state_changed', st => {
    if (!st) return;
    const t = st.track_window?.current_track;
    const prev = lastState;
    lastState = st;
    current = {
      uri: t?.uri || null, paused: st.paused,
      duration: st.duration, position: st.position,
      name: t?.name, artists: (t?.artists || []).map(a => a.name).join(', '),
      art: t?.album?.images?.[0]?.url,
    };
    // Listens are NOT counted here — main.js polls /me/player/recently-played,
    // which covers in-app SDK plays AND external devices without double counting.

    // End-of-track: the SDK reports paused at position 0 on the SAME track that
    // was just playing (our single-track context has nothing queued after it).
    const ended = prev && !prev.paused && st.paused && st.position === 0
      && t && prev.track_window?.current_track?.uri === t.uri;
    if (!st.paused) endedUri = null;               // a fresh track is playing — re-arm
    if (ended && queue.length && t.uri !== endedUri) {
      endedUri = t.uri;
      if (hasFollowing()) { advance(true); return; }
    }
    renderBar();
    emit('player');
  });
  await player.connect();
}

// ---------- queue helpers ----------
function norm(it) {
  if (typeof it === 'string') return { uri: it, name: '', artists: '', art: '' };
  if (!it) return { uri: '', name: '', artists: '', art: '' };
  return {
    uri: it.uri || '',
    name: it.name || '',
    artists: Array.isArray(it.artists) ? it.artists.map(a => a.name || a).join(', ') : (it.artists || ''),
    art: it.art || it.album?.img || it.album?.imgLg || '',
  };
}

// Rebuild `order` around the track at `startIdx` (an index into `queue`).
// Shuffle keeps the current track first so playback continues uninterrupted.
function buildOrder(startIdx) {
  const idxs = queue.map((_, i) => i);
  if (shuffle) {
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    const at = idxs.indexOf(startIdx);
    if (at > 0) [idxs[0], idxs[at]] = [idxs[at], idxs[0]];
    order = idxs; orderPos = 0;
  } else {
    order = idxs; orderPos = startIdx;
  }
}

// Is there a track to play after the current one (auto-advance or repeat)?
function hasFollowing() {
  return repeat === 'one' || repeat === 'all' || orderPos < order.length - 1;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isRestriction = e => /\b40[34]\b|Restriction|NO_ACTIVE_DEVICE|active device/i.test(e?.message || '');

// Spotify rejects /play with a `uris` body (403 "Restriction violated") on a
// connected-but-inactive SDK device. Transfer playback to it and poll the device
// list until Spotify reports it active — a fixed delay races the activation.
async function ensureActiveDevice() {
  if (deviceActivated || !deviceId) return;
  await api.transferPlayback(deviceId, false);
  for (let i = 0; i < 10; i++) {
    await sleep(250);
    try {
      const d = await api.getDevices();
      if (d?.devices?.some(x => x.id === deviceId && x.is_active)) break;
    } catch { /* keep polling */ }
  }
  deviceActivated = true;
}

async function playCurrent() {
  const item = queue[order[orderPos]];
  if (!item) return;
  try {
    await ensureActiveDevice();
    await api.play(deviceId, [item.uri], 0);
  } catch (e) {
    if (!isRestriction(e)) throw e;
    // Activation may have gone stale (device reconnected, playback moved away).
    // Force a re-transfer and retry once.
    deviceActivated = false;
    await ensureActiveDevice();
    await api.play(deviceId, [item.uri], 0);
  }
}

// Advance to the next track. auto=true means triggered by track-end (honours
// repeat-one); auto=false is an explicit Next press (always moves on).
async function advance(auto) {
  if (!queue.length) { player?.nextTrack(); return; }
  if (auto && repeat === 'one') { await playCurrent(); emit('player'); return; }
  if (orderPos < order.length - 1) orderPos++;
  else if (repeat !== 'off') orderPos = 0;        // wrap on repeat-all, or Next at end of repeat-one
  else { renderBar(); return; }                    // end of queue, no repeat — stop
  await playCurrent();
  emit('player');
}

// ---------- public playback API ----------
// `items` may be uri strings or song objects ({ uri, name, artists, album }).
export async function playList(items, idx = 0) {
  if (!deviceId) throw new Error('Player not ready — Spotify Premium required for in-app playback');
  const normed = (items || []).map(norm);
  const targetUri = normed[idx]?.uri;
  queue = normed.filter(q => q.uri);
  if (!queue.length) throw new Error('No playable tracks (missing Spotify audio)');
  let start = queue.findIndex(q => q.uri === targetUri);
  if (start < 0) start = 0;
  endedUri = null;
  buildOrder(start);
  await playCurrent();
  renderQueue();
  emit('player');
}

// Append ONE track to the live queue without restarting playback. `next` inserts
// it right after the current track; otherwise it goes to the end. With nothing
// queued yet, it just starts playback on that track.
export async function enqueue(item, { next = false } = {}) {
  if (!deviceId) throw new Error('Player not ready — Spotify Premium required for in-app playback');
  const n = norm(item);
  if (!n.uri) throw new Error('No playable track (missing Spotify audio)');
  if (!queue.length) { await playList([item], 0); return; }
  queue.push(n);
  const qi = queue.length - 1;
  if (next) order.splice(orderPos + 1, 0, qi);
  else order.push(qi);
  syncControls(); renderQueue(); emit('player');
}

export const toggle = () => player?.togglePlay();
export const next = () => advance(false);
export async function prev() {
  if (!queue.length) { player?.previousTrack(); return; }
  // Mirror Spotify: >3s into the track, Prev restarts it; otherwise step back.
  if (current.position > 3000 || orderPos === 0) await playCurrent();
  else { orderPos--; await playCurrent(); }
  emit('player');
}
export const seekTo = ms => player?.seek(ms);
export const setVolume = v => player?.setVolume(v);

export function toggleShuffle() {
  shuffle = !shuffle;
  if (queue.length) buildOrder(order[orderPos]);   // reorder upcoming, keep current track
  announce(shuffle ? 'Shuffle on' : 'Shuffle off');
  syncControls(); renderQueue(); emit('player');
  return shuffle;
}

export function cycleRepeat() {
  repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
  announce(repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one');
  syncControls(); emit('player');
  return repeat;
}

// Jump to a track by its position within the play order (queue popover click).
export async function jumpTo(orderIndex) {
  if (orderIndex < 0 || orderIndex >= order.length) return;
  orderPos = orderIndex;
  await playCurrent();
  renderQueue(); emit('player');
}

// Remove the track at order-position `oi`. Splices BOTH `queue` and `order` (and
// renumbers `order`) so a later buildOrder can't resurrect it; the current entry is
// tracked by identity so `orderPos` survives the splice.
export async function removeAt(oi) {
  if (oi < 0 || oi >= order.length) return;
  const removingCurrent = oi === orderPos;
  const curItem = removingCurrent ? null : queue[order[orderPos]];
  ({ queue, order } = removeFromQueue(queue, order, oi));   // drops from both + renumbers (no resurrection)
  if (removingCurrent) {
    if (oi < order.length) { orderPos = oi; await playCurrent(); }            // successor slid into oi
    else if (repeat !== 'off' && order.length) { orderPos = 0; await playCurrent(); } // removed last under repeat → wrap
    else { orderPos = Math.max(0, order.length - 1); player?.pause(); }       // removed last, no repeat → stop audio
  } else {
    orderPos = order.findIndex(x => queue[x] === curItem);
  }
  syncControls(); renderQueue(); emit('player');
}

// Reorder the queue: move the entry at `fromOi` to land before `toOi` (drop-before
// semantics). Pure permutation of `order`, so the distinct-index invariant holds.
export function moveInOrder(fromOi, toOi) {
  if (fromOi === toOi || fromOi < 0 || fromOi >= order.length) return;
  const curItem = queue[order[orderPos]];
  order = reorderIndices(order, fromOi, toOi);
  orderPos = order.findIndex(x => queue[x] === curItem);   // current follows by identity
  syncControls(); renderQueue(); emit('player');
}

// Wire jump / remove / drag-reorder onto a queue-list container. Handlers are
// scoped to `el` (delegated via closest), so the bar popover and a fresh overlay
// element each get their own binding with no cross-leak; re-rendering innerHTML
// keeps the container listeners intact.
export function bindQueueList(el) {
  let dragOi = null;
  const clearDrop = () => el.querySelectorAll('.pq-drop-above, .pq-drop-below')
    .forEach(x => x.classList.remove('pq-drop-above', 'pq-drop-below'));
  el.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { removeAt(+del.dataset.del); return; }
    const row = e.target.closest('[data-oi]');
    if (row) jumpTo(+row.dataset.oi);
  });
  el.addEventListener('dragstart', e => {
    const w = e.target.closest('.pq-rowwrap');
    if (!w) return;
    dragOi = +w.dataset.oi;
    e.dataTransfer.effectAllowed = 'move';
    w.classList.add('pq-dragging');
  });
  el.addEventListener('dragend', e => {
    e.target.closest('.pq-rowwrap')?.classList.remove('pq-dragging');
    clearDrop();
    dragOi = null;
  });
  el.addEventListener('dragover', e => {
    if (dragOi === null) return;
    const w = e.target.closest('.pq-rowwrap');
    if (!w) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = w.getBoundingClientRect();
    clearDrop();
    w.classList.add(e.clientY > r.top + r.height / 2 ? 'pq-drop-below' : 'pq-drop-above');
  });
  el.addEventListener('drop', e => {
    if (dragOi === null) return;
    const w = e.target.closest('.pq-rowwrap');
    if (!w) return;
    e.preventDefault();
    const r = w.getBoundingClientRect();
    moveInOrder(dragOi, +w.dataset.oi + (e.clientY > r.top + r.height / 2 ? 1 : 0));
  });
}

// ---------- player bar DOM ----------
function renderBar() {
  // Hide the whole bar when nothing is loaded; show it once a track is current.
  $('#playerbar').hidden = !current.uri;
  const art = $('#pb-art');
  if (current.art) { art.src = current.art; art.hidden = false; } else art.hidden = true;
  $('#pb-name').textContent = current.name || '';
  $('#pb-artist').textContent = current.artists || '';
  $('#pb-toggle').innerHTML = `<svg><use href="#i-${current.paused ? 'play' : 'pause'}"/></svg>`;
  $('#pb-toggle').setAttribute('aria-label', current.paused ? 'Play' : 'Pause');
  $('#pb-dur').textContent = fmtMs(current.duration);
  syncControls();
  clearInterval(positionTimer);
  let pos = current.position;
  const tick = () => {
    $('#pb-cur').textContent = fmtMs(pos);
    const seek = $('#pb-seek');
    if (!seek.matches(':active') && current.duration) seek.value = Math.round(pos / current.duration * 1000);
  };
  tick();
  if (!current.paused) positionTimer = setInterval(() => { pos = Math.min(pos + 1000, current.duration); tick(); }, 1000);
}

// Reflect shuffle/repeat/queue state on the toolbar buttons.
function syncControls() {
  const sh = $('#pb-shuffle'), rp = $('#pb-repeat'), q = $('#pb-queue');
  if (sh) sh.classList.toggle('is-active', shuffle);
  if (rp) {
    rp.classList.toggle('is-active', repeat !== 'off');
    rp.querySelector('use').setAttribute('href', repeat === 'one' ? '#i-repeat-one' : '#i-repeat');
    const label = repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one';
    rp.setAttribute('aria-label', label); rp.title = label;
  }
  if (q) { const n = order.length; q.classList.toggle('has-queue', n > 1); }
}

// Up-next list markup from the current play order. Shared by the bar popover and
// the full-screen now-playing overlay (both inject it, both bind via bindQueueList).
export function queueRowsHtml() {
  if (!order.length) return '<div class="pq-empty">Nothing queued</div>';
  const rows = order.map((qi, oi) => {
    const it = queue[qi];
    const cur = oi === orderPos;
    return `<div class="pq-rowwrap" draggable="true" data-oi="${oi}">
      <button class="pq-row${cur ? ' is-current' : ''}" data-oi="${oi}">
        <span class="pq-ix">${cur ? '<svg class="pq-eq"><use href="#i-volume"/></svg>' : oi + 1}</span>
        ${it.art ? `<img class="pq-art" src="${esc(it.art)}" alt="">` : '<span class="pq-art pq-art-ph"></span>'}
        <span class="pq-meta"><span class="pq-name">${esc(it.name || it.uri)}</span>
        <span class="pq-sub">${esc(it.artists || '')}</span></span></button>
      <button class="pq-del" data-del="${oi}" aria-label="Remove from queue" title="Remove"><svg><use href="#i-x"/></svg></button>
    </div>`;
  }).join('');
  return `<div class="pq-head">Up next${shuffle ? ' · shuffled' : ''} · ${order.length} track${order.length > 1 ? 's' : ''}</div>
    <div class="pq-list">${rows}</div>`;
}
function renderQueue() {
  const pop = $('#pb-queue-pop');
  if (pop) pop.innerHTML = queueRowsHtml();
}

export function bindBarControls() {
  $('#pb-toggle').addEventListener('click', toggle);
  $('#pb-next').addEventListener('click', next);
  $('#pb-prev').addEventListener('click', prev);
  $('#pb-shuffle').addEventListener('click', toggleShuffle);
  $('#pb-repeat').addEventListener('click', cycleRepeat);
  $('#pb-seek').addEventListener('change', e => {
    if (current.duration) seekTo(Math.round(e.target.value / 1000 * current.duration));
  });
  $('#pb-vol').addEventListener('input', e => setVolume(e.target.value / 100));

  // Up-next popover: toggle open, jump on row click, close on outside click.
  const qBtn = $('#pb-queue'), pop = $('#pb-queue-pop');
  qBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = pop.hidden;
    if (open) renderQueue();
    pop.hidden = !open;
    qBtn.classList.toggle('is-active', open);
  });
  bindQueueList(pop);
  document.addEventListener('click', e => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== qBtn && !qBtn.contains(e.target)) {
      pop.hidden = true; qBtn.classList.remove('is-active');
    }
  });
  syncControls();
}
