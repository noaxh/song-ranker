// Quick Rank: guided comparison ranking. Each song is placed into your existing
// rated order by binary insertion — "prefer A or B?" ~log2(n) times — then final
// positions map back to 1-1000 ratings by interpolating between real neighbors.
// Non-destructive: anchor (already-rated) songs are never re-scored in "new" mode.
import { state, setRatingsMap, songGenres, emit } from './store.js';
import { $, esc } from './utils.js';
import * as player from './player.js';

let setup = { scopeType: 'all', value: '', mode: 'new' }; // mode: 'new' | 'rerank'
let session = null;

// ---------- pools ----------
function poolIds(scopeType = setup.scopeType, value = setup.value) {
  const all = state.order.filter(id => state.songs[id]);
  switch (scopeType) {
    case 'genre':  return all.filter(id => songGenres(state.songs[id]).includes(value));
    case 'artist': return all.filter(id => state.songs[id].artists.some(a => a.name === value));
    case 'group':  return (state.groups.find(g => g.id === value)?.songIds || []).filter(id => state.songs[id]);
    case 'tag':    return all.filter(id => state.songs[id].tags.includes(value));
    default:       return all;
  }
}

// All rated songs, best-first (battle record breaks ties so proven songs sit higher).
function ratedLibrary() {
  return state.order
    .filter(id => state.songs[id] && state.songs[id].rating != null)
    .sort((a, b) => (state.songs[b].rating - state.songs[a].rating)
      || ((state.songs[b].duels || 0) - (state.songs[a].duels || 0)));
}

// { toPlace, anchors } for the current setup.
function partition() {
  const candidates = poolIds();
  const toPlace = setup.mode === 'new'
    ? candidates.filter(id => state.songs[id].rating == null)
    : [...candidates];
  const toPlaceSet = new Set(toPlace);
  const anchors = ratedLibrary().filter(id => !toPlaceSet.has(id));
  return { toPlace, anchors };
}

function scopeLabel() {
  return setup.scopeType === 'all' ? 'Whole library'
    : setup.scopeType === 'group' ? (state.groups.find(g => g.id === setup.value)?.name || 'Group')
    : setup.scopeType === 'tag' ? (state.tags.find(t => t.id === setup.value)?.name || 'Tag')
    : setup.value || '—';
}

// ---------- session state machine ----------
function startSession() {
  const { toPlace, anchors } = partition();
  if (!toPlace.length) { emit('toast', { msg: 'Nothing to rank in this scope', type: 'err' }); return; }
  session = {
    label: scopeLabel(),
    working: [...anchors],     // best-first; grows as songs are placed
    toPlace,                   // queue of ids to insert
    placedIds: new Set(),
    total: toPlace.length,
    cur: null, lo: 0, hi: 0, mid: 0,
    compares: 0, skipped: 0,
    done: false, results: [],
  };
  nextSong();
  render();
}

function nextSong() {
  if (!session.toPlace.length) { finish(); return; }
  session.cur = session.toPlace.shift();
  session.lo = 0;
  session.hi = session.working.length;
  stepOrPlace();
}

// Either ask the next comparison (lo<hi) or commit the insertion (lo>=hi).
function stepOrPlace() {
  if (session.lo >= session.hi) { placeCur(); return; }
  session.mid = (session.lo + session.hi) >> 1;
  // Guard: a working entry deleted mid-session — drop it and retry the window.
  if (!state.songs[session.working[session.mid]]) {
    session.working.splice(session.mid, 1);
    session.hi = Math.min(session.hi, session.working.length);
    stepOrPlace();
  }
}

function placeCur() {
  session.working.splice(session.lo, 0, session.cur);
  session.placedIds.add(session.cur);
  session.cur = null;
  nextSong();
}

export function choose(preferCur) {
  if (!session || session.cur == null || session.done) return;
  if (preferCur) session.hi = session.mid;       // new song ranks higher → lower index
  else session.lo = session.mid + 1;
  session.compares++;
  stepOrPlace();
  if (state.settings.view === 'rank') render();
}

function skipCur() {
  if (!session || session.cur == null) return;
  session.skipped++;
  session.cur = null;
  nextSong();
  render();
}

// Restart placement of the current song (cheap — log2 comparisons).
function undoCur() {
  if (!session || session.cur == null) return;
  session.lo = 0;
  session.hi = session.working.length;
  stepOrPlace();
  render();
}

// Map final positions -> ratings, interpolating each run of placed songs between
// its nearest rated neighbors. Anchors are never touched.
function assignRatings() {
  const w = session.working, N = w.length, entries = [];
  let i = 0;
  while (i < N) {
    if (!session.placedIds.has(w[i])) { i++; continue; }
    let j = i;
    while (j < N && session.placedIds.has(w[j])) j++;     // maximal run [i, j)
    const above = i > 0 ? state.songs[w[i - 1]]?.rating : null;   // rated neighbor above (anchor)
    const below = j < N ? state.songs[w[j]]?.rating : null;       // rated neighbor below (anchor)
    const rHi = above != null ? above : 1000;
    const rLo = below != null ? below : 1;
    const m = j - i;
    for (let k = 0; k < m; k++) {
      entries.push([w[i + k], Math.round(rHi - (k + 1) * (rHi - rLo) / (m + 1))]);
    }
    i = j;
  }
  return entries;
}

function finish() {
  const entries = assignRatings();
  if (entries.length) setRatingsMap(entries, `Quick Rank · ${session.label}`);
  session.done = true;
  session.results = entries;
}

function endSession() { session = null; render(); }

// ---------- setup screen ----------
const SCOPES = [
  ['all', 'Whole library', 'Rank across everything'],
  ['genre', 'Single genre', 'Rank within one genre'],
  ['artist', 'Single artist', "Rank one artist's catalog"],
  ['group', 'Group / playlist', 'Rank inside one of your groups'],
  ['tag', 'Tag', 'Songs carrying a chosen tag'],
];

function scopeOptions(type) {
  const count = arr => arr.map(([v, label, n]) =>
    `<option value="${esc(v)}">${esc(label)} (${n})</option>`).join('');
  if (type === 'genre') {
    const map = {};
    for (const id of state.order) {
      const s = state.songs[id];
      if (s) for (const g of songGenres(s)) if (g !== 'Unknown genre') map[g] = (map[g] || 0) + 1;
    }
    return count(Object.entries(map).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).map(([g, n]) => [g, g, n]));
  }
  if (type === 'artist') {
    const map = {};
    for (const id of state.order) {
      const s = state.songs[id];
      if (s) for (const a of s.artists) map[a.name] = (map[a.name] || 0) + 1;
    }
    return count(Object.entries(map).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).map(([a, n]) => [a, a, n]));
  }
  if (type === 'group') return count(state.groups.filter(g => g.songIds.length >= 1).map(g => [g.id, g.name, g.songIds.length]));
  if (type === 'tag') {
    const counts = {};
    Object.values(state.songs).forEach(s => s.tags.forEach(t => counts[t] = (counts[t] || 0) + 1));
    return count(state.tags.filter(t => (counts[t.id] || 0) >= 1).map(t => [t.id, t.name, counts[t.id] || 0]));
  }
  return '';
}

function setupHtml() {
  const needsValue = !['all'].includes(setup.scopeType);
  const opts = needsValue ? scopeOptions(setup.scopeType) : '';
  if (needsValue && opts && !opts.includes(`value="${esc(setup.value)}"`)) {
    setup.value = (opts.match(/value="([^"]*)"/) || [, ''])[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  const { toPlace, anchors } = partition();
  const n = toPlace.length;
  const approx = anchors.length + 1;
  const perSong = Math.max(1, Math.ceil(Math.log2(approx + 1)));
  const isNew = setup.mode === 'new';
  return `<div class="faceoff rank-setup">
    <h2>Quick Rank</h2>
    <p class="fo-sub">Place songs by ear, not by number. Pick which of two you like more; each song slides into its spot in
      ~${perSong} taps. Final positions become 1–1000 ratings — your existing ones stay put.</p>
    <div class="fo-rounds">
      <span class="hint">Mode:</span>
      <button class="pill ${isNew ? 'is-active' : ''}" data-rk-mode="new">New songs</button>
      <button class="pill ${!isNew ? 'is-active' : ''}" data-rk-mode="rerank">Re-rank scope</button>
    </div>
    <p class="fo-sub" style="margin-top:-8px">${isNew
      ? 'Slot unrated songs into your ranking, leaving rated ones untouched.'
      : 'Re-place every song in the scope from scratch — old ratings here are replaced.'}</p>
    <div class="fo-scopes">${SCOPES.map(([id, name, desc]) => `
      <button class="fo-scope ${setup.scopeType === id ? 'is-active' : ''}" data-rk-scope="${id}">
        <span class="fs-name">${name}</span><span class="fs-desc">${desc}</span>
      </button>`).join('')}</div>
    ${needsValue ? `<div class="fo-valuerow">
      <label class="sr-only" for="rk-value">Pick one</label>
      <select id="rk-value" class="select" data-rk-value>${opts || '<option value="">Nothing eligible</option>'}</select>
    </div>` : ''}
    <button class="btn btn-primary fo-start" data-rk-start ${n >= 1 ? '' : 'disabled'}>
      <svg><use href="#i-rank"/></svg>${n >= 1 ? `Rank ${n} song${n === 1 ? '' : 's'}${anchors.length ? ` against ${anchors.length} rated` : ''}` : 'Nothing to rank'}</button>
    ${n < 1 ? `<p class="hint">${isNew ? 'No unrated songs in this scope — switch to “Re-rank scope” or pick another scope.' : 'This scope is empty. Import more music or pick another scope.'}</p>` : ''}
  </div>`;
}

// ---------- comparison card ----------
function compareCard(s, which, isNew) {
  return `<div class="fo-card rank-card" data-rk-pick="${which}" role="button" tabindex="0"
      aria-label="Prefer ${esc(s.name)} by ${esc(s.artists.map(a => a.name).join(', '))}">
    ${isNew ? '<span class="rank-badge">NEW</span>' : ''}
    ${s.uri ? `<button class="btn-icon fo-play" data-rk-play="${esc(s.uri)}" aria-label="Play ${esc(s.name)}" title="Listen before you judge"><svg><use href="#i-play"/></svg></button>` : ''}
    ${s.album.imgLg || s.album.img
      ? `<img class="art" src="${esc(s.album.imgLg || s.album.img)}" alt="">`
      : '<span class="art art-ph"><svg style="width:40px;height:40px"><use href="#i-music"/></svg></span>'}
    <div class="fo-name">${esc(s.name)}</div>
    <div class="fo-artist">${esc(s.artists.map(a => a.name).join(', '))} · ${esc(s.album.name)}</div>
    <div class="fo-rating">${s.rating != null
      ? `<span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>`
      : '<span class="hint">unrated</span>'}</div>
  </div>`;
}

function summaryHtml() {
  const rows = session.results
    .map(([id, r]) => [state.songs[id], r]).filter(([s]) => s)
    .sort((a, b) => b[1] - a[1]);
  const row = ([s, r]) => `<div class="fo-sum-row">
    ${s.album.img ? `<img class="art" src="${esc(s.album.img)}" alt="">` : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
    <span class="grow"><b>${esc(s.name)}</b> <span class="hint">${esc(s.artists[0]?.name || '')}</span></span>
    <span class="rating-in has-val" style="--rv:${r};pointer-events:none">${r}</span>
  </div>`;
  return `<div class="faceoff">
    <h2>Ranking applied</h2>
    <p class="fo-sub"><b>${esc(session.label)}</b> · placed ${session.results.length} song${session.results.length === 1 ? '' : 's'} in ${session.compares} comparison${session.compares === 1 ? '' : 's'}${session.skipped ? ` · ${session.skipped} skipped` : ''}. Undo from the top bar reverts the whole batch.</p>
    ${session.results.length ? `<div class="fo-summary rank-results">${rows.map(row).join('')}</div>` : '<p class="fo-sub">No songs were placed.</p>'}
    <div class="fo-controls">
      <button class="btn btn-primary" data-rk-again><svg><use href="#i-rank"/></svg>Rank more</button>
    </div>
  </div>`;
}

// ---------- render ----------
export function render() {
  const root = $('#view');
  if (!session) { root.innerHTML = setupHtml(); return; }
  if (session.done) { root.innerHTML = summaryHtml(); return; }
  // Defensive: a transient state where cur is null but session isn't done.
  if (session.cur == null || session.working[session.mid] == null) { nextSong(); if (session.done) { root.innerHTML = summaryHtml(); return; } }

  const cur = state.songs[session.cur];
  const opp = state.songs[session.working[session.mid]];
  if (!cur || !opp) { root.innerHTML = summaryHtml(); return; }
  const placed = session.placedIds.size;
  const pct = Math.round(placed / session.total * 100);
  root.innerHTML = `<div class="faceoff">
    <div class="fo-head">
      <h2>Quick Rank · ${esc(session.label)}</h2>
      <span class="fo-progress">${placed} / ${session.total} placed</span>
      <div class="progressbar fo-bar"><div style="width:${pct}%"></div></div>
    </div>
    <p class="fo-sub">Where does <b>${esc(cur.name)}</b> belong? Pick the one you like more.</p>
    <div class="fo-arena">
      ${compareCard(cur, 'cur', true)}
      <div class="fo-vs" aria-hidden="true">VS</div>
      ${compareCard(opp, 'mid', false)}
    </div>
    <div class="fo-controls">
      <button class="btn" data-rk-skip>Skip song <kbd>S</kbd></button>
      <button class="btn" data-rk-restart>Restart this song <kbd>U</kbd></button>
      <button class="btn btn-ghost" data-rk-finish>Finish &amp; apply</button>
    </div>
    <p class="fo-stats"><kbd>←</kbd> the new song · <kbd>→</kbd> the other</p>
  </div>`;
}

// ---------- events (bound once) ----------
export function init() {
  $('#view').addEventListener('click', e => {
    if (state.settings.view !== 'rank') return;
    const play = e.target.closest('[data-rk-play]');
    if (play) { e.stopPropagation(); player.playList([play.dataset.rkPlay]).catch(err => emit('toast', { msg: err.message, type: 'err' })); return; }
    const scope = e.target.closest('[data-rk-scope]');
    if (scope) { setup.scopeType = scope.dataset.rkScope; setup.value = ''; render(); return; }
    const mode = e.target.closest('[data-rk-mode]');
    if (mode) { setup.mode = mode.dataset.rkMode; render(); return; }
    if (e.target.closest('[data-rk-start]')) { startSession(); return; }
    if (e.target.closest('[data-rk-again]')) { session = null; render(); return; }
    if (e.target.closest('[data-rk-finish]')) { if (session) { finish(); render(); } return; }
    if (e.target.closest('[data-rk-skip]')) { skipCur(); return; }
    if (e.target.closest('[data-rk-restart]')) { undoCur(); return; }
    const pick = e.target.closest('[data-rk-pick]');
    if (pick) { choose(pick.dataset.rkPick === 'cur'); return; }
  });
  $('#view').addEventListener('contextmenu', e => {
    if (state.settings.view !== 'rank' || !session) return;
    const card = e.target.closest('[data-rk-pick]');
    if (!card) return;
    const id = card.dataset.rkPick === 'cur' ? session.cur : session.working[session.mid];
    if (!id) return;
    e.preventDefault();
    emit('ctx-menu', { x: e.clientX, y: e.clientY, ids: [id] });
  });
  $('#view').addEventListener('change', e => {
    if (state.settings.view !== 'rank') return;
    const sel = e.target.closest('[data-rk-value]');
    if (sel) { setup.value = sel.value; render(); }
  });
  $('#view').addEventListener('keydown', e => {
    const pick = e.target.closest?.('[data-rk-pick]');
    if (pick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(pick.dataset.rkPick === 'cur'); }
  });
  document.addEventListener('keydown', e => {
    if (state.settings.view !== 'rank' || !session || session.done || session.cur == null) return;
    if (e.target.closest?.('input, textarea, select, .modal')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); choose(true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); choose(false); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); skipCur(); }
    else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undoCur(); }
  });
}
