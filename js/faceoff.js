// Face-off: pairwise "which do you like more?" duels that nudge ratings Elo-style.
// A battle has a scope (everything / genre / artist / group / tag / unrated) and an
// optional round target; results are summarized when the target is reached.
import { state, setRatingsMap, songGenres, emit } from './store.js';
import { $, esc, clamp, letterFloor } from './utils.js';
import * as player from './player.js';
import * as tourney from './tourney.js';

let battle = null;      // { scopeType, value, label, target, duels, deltas: {id: net} }
let pair = null;        // [idA, idB]
let lastResult = null;  // { winnerId, dW, dL }
let nextTimer = null;
let setup = { scopeType: 'all', value: '', target: 25, mode: 'duel', size: 8 }; // remembered between battles

// Adaptive K-factor: songs with few duels are "in placement" and move fast to
// find their level; battle-tested songs move slowly so one upset can't wreck
// an established ranking. Each side moves by its OWN K (FIDE-style), so a new
// challenger losing to a veteran barely dents the veteran.
function kFor(s) {
  const n = s.duels || 0;
  if (n < 5) return 180;
  if (n < 15) return 90;
  if (n < 30) return 48;
  return 16;       // settled tail kept small so a single duel rarely jumps a sub-tier
}

// Smaller K for higher-rated songs so top tiers are sticky (chess gives its
// elite players the smallest K). Multiplies the duel-count K above, per side.
const heightDamp = r => r >= 950 ? 0.5 : r >= 800 ? 0.7 : r >= 650 ? 0.9 : 1;

// Letter-drop hysteresis: a loss that would push the loser below its current
// base-letter line is cushioned, so dropping a whole letter (e.g. A->B) is
// unlikely on one duel but still possible on a clear slide. Loser only; wins
// climb freely. RESIST = fraction of the below-line overshoot kept; HOLD = a
// resisted overshoot this small just pins to the line.
const DROP_RESIST = 0.45;
const DROP_HOLD = 12;

// Elo nudge shared by quick duels and tournament matches. Applies the rating
// change as one undoable action, updates each song's battle record (duels /
// wins / streak — the duel happened, so the record survives an undo), and
// returns the deltas.
export function eloApply(winnerId, loserId, label = 'Face-off result') {
  const w = state.songs[winnerId], l = state.songs[loserId];
  const rw = w.rating ?? 500;
  const rl = l.rating ?? 500;
  // Divisor 500 (flatter than chess's 400): keeps rating mass spread across the
  // band and avoids slamming the top song into the 1000 ceiling too early.
  const expected = 1 / (1 + Math.pow(10, (rl - rw) / 500));
  const gain = 1 - expected;
  // Per-side K = duel-count placement speed x height damping (sticky top tiers).
  const newW = clamp(rw + Math.max(1, Math.round(kFor(w) * heightDamp(rw) * gain)), 1, 1000);
  let newL = clamp(rl - Math.max(1, Math.round(kFor(l) * heightDamp(rl) * gain)), 1, 1000);
  // Resist dropping a whole letter on this one loss (see DROP_RESIST/HOLD).
  const floor = letterFloor(rl);
  if (newL < floor) {
    const resisted = (floor - newL) * DROP_RESIST;
    newL = clamp(resisted <= DROP_HOLD ? floor : Math.round(floor - resisted), 1, 1000);
  }
  w.duels = (w.duels || 0) + 1;
  w.wins = (w.wins || 0) + 1;
  w.streak = (w.streak || 0) + 1;
  l.duels = (l.duels || 0) + 1;
  l.streak = 0;
  setRatingsMap([[winnerId, newW], [loserId, newL]], label);
  return { dW: newW - rw, dL: newL - rl };
}

// One duel card. side: 'l' | 'r'. result: { winnerId, dW, dL } | null — when set,
// the winner lunges at the loser and the loser takes the hit (CSS keyframes).
export function duelCard(s, side, result) {
  const win = result && result.winnerId === s.id;
  const lose = result && result.winnerId !== s.id;
  const delta = result ? (win ? result.dW : result.dL) : null;
  return `<div class="fo-card ${win ? `fo-win fo-strike-${side}` : ''} ${lose ? `fo-defeat-${side}` : ''}"
      data-fo-pick="${esc(s.id)}" role="button" tabindex="0"
      aria-label="Pick ${esc(s.name)} by ${esc(s.artists.map(a => a.name).join(', '))}">
    ${s.uri ? `<button class="btn-icon fo-play" data-fo-play="${esc(s.uri)}" aria-label="Play ${esc(s.name)}" title="Listen before you judge"><svg><use href="#i-play"/></svg></button>` : ''}
    ${s.album.imgLg || s.album.img
      ? `<img class="art" src="${esc(s.album.imgLg || s.album.img)}" alt="">`
      : '<span class="art art-ph"><svg style="width:40px;height:40px"><use href="#i-music"/></svg></span>'}
    <div class="fo-name">${esc(s.name)}</div>
    <div class="fo-artist">${esc(s.artists.map(a => a.name).join(', '))} · ${esc(s.album.name)}</div>
    <div class="fo-rating">
      ${s.rating != null
        ? `<span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>`
        : '<span class="hint">unrated</span>'}
      ${delta != null ? ` <span class="fo-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta}</span>` : ''}
    </div>
  </div>`;
}

// Play one track from a duel card without treating the click as a vote.
export function playUri(uri) {
  player.playList([uri]).catch(e => emit('toast', { msg: e.message, type: 'err' }));
}

// ---------- pool ----------
function poolIds(scopeType = battle?.scopeType, value = battle?.value) {
  const all = state.order.filter(id => state.songs[id]);
  switch (scopeType) {
    case 'genre':   return all.filter(id => songGenres(state.songs[id]).includes(value));
    case 'artist':  return all.filter(id => state.songs[id].artists.some(a => a.name === value));
    case 'group':   return (state.groups.find(g => g.id === value)?.songIds || []).filter(id => state.songs[id]);
    case 'tag':     return all.filter(id => state.songs[id].tags.includes(value));
    case 'unrated': return all.filter(id => state.songs[id].rating == null);
    default:        return all;
  }
}

function pickPair() {
  const ids = poolIds();
  if (ids.length < 2) return null;
  // Uncertainty sampling: most of the time start from a song with few duels —
  // those are the ratings we know least about, so their duels teach us the most.
  let a;
  if (Math.random() < 0.65) {
    const sorted = [...ids].sort((x, y) => (state.songs[x].duels || 0) - (state.songs[y].duels || 0));
    const k = Math.max(1, Math.ceil(sorted.length * 0.25));
    a = sorted[Math.floor(Math.random() * k)];
  } else {
    a = ids[Math.floor(Math.random() * ids.length)];
  }
  const ra = state.songs[a].rating ?? 500;
  // opponent drawn from the 12 closest by rating — close matches are the informative ones
  const candidates = ids.filter(x => x !== a)
    .sort((x, y) => Math.abs((state.songs[x].rating ?? 500) - ra) - Math.abs((state.songs[y].rating ?? 500) - ra))
    .slice(0, 12);
  return [a, candidates[Math.floor(Math.random() * candidates.length)]];
}

export function choose(winnerId) {
  if (!battle || !pair || lastResult || !pair.includes(winnerId)) return;
  const loserId = pair[0] === winnerId ? pair[1] : pair[0];
  const { dW, dL } = eloApply(winnerId, loserId);
  lastResult = { winnerId, dW, dL };
  battle.duels++;
  battle.deltas[winnerId] = (battle.deltas[winnerId] || 0) + dW;
  battle.deltas[loserId] = (battle.deltas[loserId] || 0) + dL;
  clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    lastResult = null;
    pair = null;
    if (state.settings.view === 'faceoff') render();
  }, 1250); // defeat animation runs ~1.15s — let it finish before the next pair
}

function skip() {
  clearTimeout(nextTimer);
  pair = null;
  lastResult = null;
  render();
}

function scopeLabel() {
  return setup.scopeType === 'all' ? 'All songs'
    : setup.scopeType === 'unrated' ? 'Unrated songs'
    : setup.scopeType === 'group' ? (state.groups.find(g => g.id === setup.value)?.name || 'Group')
    : setup.scopeType === 'tag' ? (state.tags.find(t => t.id === setup.value)?.name || 'Tag')
    : setup.value;
}

function startBattle() {
  if (setup.mode === 'tourney') {
    tourney.start(poolIds(setup.scopeType, setup.value), scopeLabel(), setup.size);
    render();
    return;
  }
  battle = { ...setup, label: scopeLabel(), duels: 0, deltas: {} };
  pair = null;
  lastResult = null;
  render();
}

function endBattle() {
  clearTimeout(nextTimer);
  battle = null;
  pair = null;
  lastResult = null;
  render();
}

// ---------- setup screen ----------
const SCOPES = [
  ['all', 'Everything', 'Whole library, no holds barred'],
  ['genre', 'Single genre', 'Settle the best track of a genre'],
  ['artist', 'Single artist', 'Rank one artist\'s catalog'],
  ['group', 'Group / playlist', 'Battle inside one of your groups'],
  ['tag', 'Tag', 'Songs carrying a chosen tag'],
  ['unrated', 'Unrated only', 'Give new imports their first ratings'],
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
    return count(Object.entries(map).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([g, n]) => [g, g, n]));
  }
  if (type === 'artist') {
    const map = {};
    for (const id of state.order) {
      const s = state.songs[id];
      if (s) for (const a of s.artists) map[a.name] = (map[a.name] || 0) + 1;
    }
    return count(Object.entries(map).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([a, n]) => [a, a, n]));
  }
  if (type === 'group') return count(state.groups.filter(g => g.songIds.length >= 2).map(g => [g.id, g.name, g.songIds.length]));
  if (type === 'tag') {
    const counts = {};
    Object.values(state.songs).forEach(s => s.tags.forEach(t => counts[t] = (counts[t] || 0) + 1));
    return count(state.tags.filter(t => (counts[t.id] || 0) >= 2).map(t => [t.id, t.name, counts[t.id] || 0]));
  }
  return '';
}

function setupHtml() {
  const needsValue = !['all', 'unrated'].includes(setup.scopeType);
  const opts = needsValue ? scopeOptions(setup.scopeType) : '';
  if (needsValue && opts && !opts.includes(`value="${esc(setup.value)}"`)) {
    setup.value = (opts.match(/value="([^"]*)"/) || [, ''])[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  const n = poolIds(setup.scopeType, setup.value).length;
  const isTourney = setup.mode === 'tourney';
  const canStart = isTourney ? n >= setup.size : n >= 2;
  return `<div class="faceoff fo-setup">
    <h2>Face-off</h2>
    <p class="fo-sub">${isTourney
      ? 'Single-elimination bracket. Songs duel round by round until one is crowned champion.'
      : 'Pick a battleground. Two songs enter, the one you pick gains rating points — bigger upsets move more.'}</p>
    <div class="fo-rounds">
      <span class="hint">Mode:</span>
      <button class="pill ${!isTourney ? 'is-active' : ''}" data-fo-mode="duel">Quick duels</button>
      <button class="pill ${isTourney ? 'is-active' : ''}" data-fo-mode="tourney">🏆 Tournament</button>
    </div>
    <div class="fo-scopes">${SCOPES.map(([id, name, desc]) => `
      <button class="fo-scope ${setup.scopeType === id ? 'is-active' : ''}" data-fo-scope="${id}">
        <span class="fs-name">${name}</span><span class="fs-desc">${desc}</span>
      </button>`).join('')}</div>
    ${needsValue ? `<div class="fo-valuerow">
      <label class="sr-only" for="fo-value">Pick one</label>
      <select id="fo-value" class="select" data-fo-value>${opts || '<option value="">Nothing eligible (need 2+ songs)</option>'}</select>
    </div>` : ''}
    ${isTourney
      ? `<div class="fo-rounds">
          <span class="hint">Bracket size:</span>
          ${[4, 8, 16, 32].map(sz => `<button class="pill ${setup.size === sz ? 'is-active' : ''}" data-fo-size="${sz}" ${n < sz ? 'disabled' : ''}>${sz}</button>`).join('')}
        </div>`
      : `<div class="fo-rounds">
          <span class="hint">Rounds:</span>
          ${[10, 25, 50, 0].map(t => `<button class="pill ${setup.target === t ? 'is-active' : ''}" data-fo-rounds="${t}">${t || 'Endless'}</button>`).join('')}
        </div>`}
    <button class="btn btn-primary fo-start" data-fo-start ${canStart ? '' : 'disabled'}>
      <svg><use href="#i-zap"/></svg>${isTourney ? `Start tournament — ${setup.size} songs enter, 1 survives` : `Start battle — ${n} song${n === 1 ? '' : 's'} in the pool`}</button>
    ${!canStart ? `<p class="hint">${isTourney ? `A ${setup.size}-song bracket needs ${setup.size} songs — this scope has ${n}. Pick a smaller bracket or another battleground.` : 'Need at least 2 songs in this scope. Import more music or pick another battleground.'}</p>` : ''}
  </div>`;
}

// ---------- battle summary ----------
function summaryHtml() {
  const moved = Object.entries(battle.deltas).filter(([id]) => state.songs[id]);
  const top = [...moved].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, d]) => d > 0);
  const bottom = [...moved].sort((a, b) => a[1] - b[1]).slice(0, 3).filter(([, d]) => d < 0);
  const row = ([id, d]) => {
    const s = state.songs[id];
    return `<div class="fo-sum-row">
      ${s.album.img ? `<img class="art" src="${esc(s.album.img)}" alt="">` : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
      <span class="grow"><b>${esc(s.name)}</b> <span class="hint">${esc(s.artists[0]?.name || '')}</span></span>
      <span class="fo-delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</span>
      <span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>
    </div>`;
  };
  return `<div class="faceoff">
    <h2>Battle complete</h2>
    <p class="fo-sub"><b>${esc(battle.label)}</b> · ${battle.duels} duel${battle.duels === 1 ? '' : 's'} fought.</p>
    ${top.length ? `<div class="fo-summary"><h3>📈 Biggest climbers</h3>${top.map(row).join('')}</div>` : ''}
    ${bottom.length ? `<div class="fo-summary"><h3>📉 Took the hits</h3>${bottom.map(row).join('')}</div>` : ''}
    <div class="fo-controls">
      <button class="btn btn-primary" data-fo-again><svg><use href="#i-zap"/></svg>Run it back</button>
      <button class="btn" data-fo-end>New battle</button>
    </div>
  </div>`;
}

// ---------- battle arena ----------
export function render() {
  const root = $('#view');
  if (tourney.isActive()) { tourney.render(); return; }
  if (!battle) { root.innerHTML = setupHtml(); return; }
  if (battle.target && battle.duels >= battle.target && !lastResult) { root.innerHTML = summaryHtml(); return; }

  const poolSize = poolIds().length;
  if (pair && (!state.songs[pair[0]] || !state.songs[pair[1]])) pair = null;
  if (!pair) pair = pickPair();
  if (!pair) {
    root.innerHTML = `<div class="empty-state"><svg><use href="#i-zap"/></svg>
      <h2>Pool ran dry</h2>
      <p>Fewer than 2 songs left in "${esc(battle.label)}". Pick another battleground.</p>
      <div class="empty-actions"><button class="btn btn-primary" data-fo-end>New battle</button></div></div>`;
    return;
  }

  const [a, b] = pair.map(id => state.songs[id]);
  const progress = battle.target ? `${battle.duels} / ${battle.target}` : `${battle.duels}`;
  return void (root.innerHTML = `<div class="faceoff">
    <div class="fo-head">
      <h2>${esc(battle.label)}</h2>
      <span class="fo-progress">${progress} duels</span>
      ${battle.target ? `<div class="progressbar fo-bar"><div style="width:${Math.min(100, battle.duels / battle.target * 100)}%"></div></div>` : ''}
    </div>
    <p class="fo-sub">Pick the song you like more · <b>${poolSize}</b> songs in this pool</p>
    <div class="fo-arena ${lastResult ? 'fo-clash' : ''}">
      ${duelCard(a, 'l', lastResult)}
      <div class="fo-vs" aria-hidden="true">VS</div>
      ${duelCard(b, 'r', lastResult)}
    </div>
    <div class="fo-controls">
      <button class="btn" data-fo-skip>Skip pair <kbd>S</kbd></button>
      <button class="btn" data-fo-undo>Undo last <kbd>U</kbd></button>
      <button class="btn btn-ghost" data-fo-end>End battle</button>
    </div>
    <p class="fo-stats"><kbd>←</kbd> <kbd>→</kbd> pick the winner</p>
  </div>`);
}

export function init() {
  $('#view').addEventListener('click', e => {
    if (state.settings.view !== 'faceoff' || tourney.isActive()) return;
    const play = e.target.closest('[data-fo-play]');
    if (play) { playUri(play.dataset.foPlay); return; }
    const scope = e.target.closest('[data-fo-scope]');
    if (scope) { setup.scopeType = scope.dataset.foScope; setup.value = ''; render(); return; }
    const mode = e.target.closest('[data-fo-mode]');
    if (mode) { setup.mode = mode.dataset.foMode; render(); return; }
    const size = e.target.closest('[data-fo-size]');
    if (size) { setup.size = +size.dataset.foSize; render(); return; }
    const rounds = e.target.closest('[data-fo-rounds]');
    if (rounds) { setup.target = +rounds.dataset.foRounds; render(); return; }
    if (e.target.closest('[data-fo-start]')) { startBattle(); return; }
    if (e.target.closest('[data-fo-again]')) { startBattle(); return; }
    if (e.target.closest('[data-fo-end]')) { endBattle(); return; }
    const pick = e.target.closest('[data-fo-pick]');
    if (pick) { choose(pick.dataset.foPick); return; }
    if (e.target.closest('[data-fo-skip]')) skip();
    if (e.target.closest('[data-fo-undo]')) { clearTimeout(nextTimer); lastResult = null; pair = null; if (battle) battle.duels = Math.max(0, battle.duels - 1); emit('do-undo'); }
  });
  $('#view').addEventListener('contextmenu', e => {
    if (state.settings.view !== 'faceoff') return;
    const card = e.target.closest('[data-fo-pick]');
    if (!card) return;
    e.preventDefault();
    emit('ctx-menu', { x: e.clientX, y: e.clientY, ids: [card.dataset.foPick] });
  });
  $('#view').addEventListener('change', e => {
    if (state.settings.view !== 'faceoff') return;
    const sel = e.target.closest('[data-fo-value]');
    if (sel) { setup.value = sel.value; render(); }
  });
  $('#view').addEventListener('keydown', e => {
    const pick = e.target.closest?.('[data-fo-pick]');
    if (pick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(pick.dataset.foPick); }
  });
  document.addEventListener('keydown', e => {
    if (state.settings.view !== 'faceoff' || !battle) return;
    if (e.target.closest?.('input, textarea, select, .modal')) return;
    if (e.key === 'ArrowLeft' && pair) { e.preventDefault(); choose(pair[0]); }
    if (e.key === 'ArrowRight' && pair) { e.preventDefault(); choose(pair[1]); }
    if (e.key === 's') { e.preventDefault(); skip(); }
  });
}
