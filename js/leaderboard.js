// Leaderboard view: rated songs ranked by Elo rating, with battle records
// (wins / losses / streaks) earned in Face-off duels and tournaments.
import { state, emit, setSetting } from './store.js';
import { $, esc, tierOf, tierBase } from './utils.js';

let filter = 'all'; // 'all' | 'tested' (3+ duels)

// Pure entry list from any snapshot — used by the live view (global state) AND by
// the read-only friend profile (a friend's snapshot).
function entriesFrom(songs, order, mode) {
  const list = (order || [])
    .map(id => songs[id])
    .filter(s => s && s.rating != null);
  const scoped = mode === 'tested' ? list.filter(s => (s.duels || 0) >= 3) : list;
  // Rating first; battle record breaks ties so proven songs outrank untested ones.
  return scoped.sort((a, b) => b.rating - a.rating
    || (b.wins || 0) - (a.wins || 0)
    || (a.duels || 0) - (b.duels || 0)
    || a.name.localeCompare(b.name));
}

function recordHtml(s) {
  const duels = s.duels || 0;
  const wins = s.wins || 0;
  if (!duels) return '<span class="lb-rec hint">no duels yet</span>';
  const pct = Math.round(wins / duels * 100);
  return `<span class="lb-rec"><b>${wins}</b>W <b>${duels - wins}</b>L <span class="hint">(${pct}%)</span></span>`;
}

const streakHtml = s => (s.streak || 0) >= 3 ? `<span class="lb-streak" title="${s.streak} wins in a row">🔥${s.streak}</span>` : '';

function podiumCard(s, place) {
  const medal = ['🥇', '🥈', '🥉'][place - 1];
  return `<div class="lb-podium-card p${place}" data-lb="${esc(s.id)}" role="button" tabindex="0"
      aria-label="Rank ${place}: ${esc(s.name)} by ${esc(s.artists.map(a => a.name).join(', '))}, rated ${s.rating}">
    <span class="lb-medal" aria-hidden="true">${medal}</span>
    ${s.album.imgLg || s.album.img
      ? `<img class="art" src="${esc(s.album.imgLg || s.album.img)}" alt="">`
      : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
    <div class="lb-p-name">${esc(s.name)}</div>
    <div class="lb-p-artist">${esc(s.artists[0]?.name || '')}</div>
    <span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>
    <div class="lb-p-rec">${recordHtml(s)} ${streakHtml(s)}</div>
  </div>`;
}

function rowHtml(s, rank) {
  const tier = tierOf(s.rating);
  return `<div class="lb-row" data-lb="${esc(s.id)}" role="button" tabindex="0"
      aria-label="Rank ${rank}: ${esc(s.name)}, rated ${s.rating}">
    <span class="lb-rank">${rank}</span>
    ${s.album.img
      ? `<img class="art" src="${esc(s.album.img)}" alt="" loading="lazy">`
      : '<span class="art art-ph"><svg><use href="#i-music"/></svg></span>'}
    <div class="t-block">
      <div class="t-name">${esc(s.name)}</div>
      <div class="t-art">${esc(s.artists.map(a => a.name).join(', '))}</div>
    </div>
    ${recordHtml(s)}
    <span class="lb-streak" ${(s.streak || 0) >= 3 ? `title="${s.streak} wins in a row"` : ''}>${(s.streak || 0) >= 3 ? '🔥' + s.streak : ''}</span>
    <span class="lb-duels hint" title="duels fought">${s.duels || 0} ⚔</span>
    <span class="tier-chip" ${tier ? `data-tier="${tierBase(tier)}"` : ''}>${tier || ''}</span>
    <span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>
  </div>`;
}

// Read-only leaderboard markup for the friend profile. Pure: no #view, no
// handlers, no rating inputs — just the podium + ranked rows from a snapshot.
export function buildLeaderboard({ songs, order }, { filter: mode = 'all' } = {}) {
  const list = entriesFrom(songs || {}, order || Object.keys(songs || {}), mode);
  if (!list.length) return '<p class="hint">No rated songs in this library yet.</p>';
  const podium = list.slice(0, 3);
  const rest = list.slice(3);
  const totalWins = list.reduce((n, s) => n + (s.wins || 0), 0);
  return `<div class="leaderboard">
    <div class="lb-head">
      <h2><svg><use href="#i-trophy"/></svg>Leaderboard</h2>
      <span class="hint">${list.length} song${list.length === 1 ? '' : 's'} ranked · ${totalWins} duel${totalWins === 1 ? '' : 's'} won</span>
    </div>
    ${podium.length === 3
      ? `<div class="lb-podium">${podiumCard(podium[1], 2)}${podiumCard(podium[0], 1)}${podiumCard(podium[2], 3)}</div>`
      : `<div class="lb-list">${podium.map((s, i) => rowHtml(s, i + 1)).join('')}</div>`}
    ${rest.length || podium.length === 3
      ? `<div class="lb-list">${(podium.length === 3 ? rest : []).map((s, i) => rowHtml(s, i + 4)).join('')}</div>`
      : ''}
  </div>`;
}

export function render() {
  const root = $('#view');
  const list = entriesFrom(state.songs, state.order, filter);

  if (!list.length) {
    root.innerHTML = `<div class="empty-state"><svg><use href="#i-trophy"/></svg>
      <h2>${filter === 'tested' ? 'No battle-tested songs yet' : 'No rated songs yet'}</h2>
      <p>${filter === 'tested'
        ? 'Songs appear here once they\'ve fought at least 3 Face-off duels.'
        : 'Rate songs in the library or run Face-off battles to build the leaderboard.'}</p>
      <div class="empty-actions"><button class="btn btn-primary" data-lb-go-fo><svg><use href="#i-zap"/></svg>Start a Face-off</button>
      ${filter === 'tested' ? '<button class="btn" data-lb-filter="all">Show all rated</button>' : ''}</div></div>`;
    return;
  }

  const podium = list.slice(0, 3);
  const rest = list.slice(3);
  const totalDuels = list.reduce((n, s) => n + (s.wins || 0), 0);
  root.innerHTML = `<div class="leaderboard">
    <div class="lb-head">
      <h2><svg><use href="#i-trophy"/></svg>Leaderboard</h2>
      <span class="hint">${list.length} song${list.length === 1 ? '' : 's'} ranked · ${totalDuels} duel${totalDuels === 1 ? '' : 's'} fought</span>
      <div class="pill-row">
        <button class="pill ${filter === 'all' ? 'is-active' : ''}" data-lb-filter="all">All rated</button>
        <button class="pill ${filter === 'tested' ? 'is-active' : ''}" data-lb-filter="tested">Battle-tested (3+ duels)</button>
      </div>
    </div>
    ${podium.length === 3
      ? `<div class="lb-podium">${podiumCard(podium[1], 2)}${podiumCard(podium[0], 1)}${podiumCard(podium[2], 3)}</div>`
      : `<div class="lb-list">${podium.map((s, i) => rowHtml(s, i + 1)).join('')}</div>`}
    ${rest.length || podium.length === 3
      ? `<div class="lb-list">${(podium.length === 3 ? rest : []).map((s, i) => rowHtml(s, i + 4)).join('')}</div>`
      : ''}
  </div>`;
}

export function init() {
  $('#view').addEventListener('click', e => {
    if (state.settings.view !== 'ranks') return;
    const f = e.target.closest('[data-lb-filter]');
    if (f) { filter = f.dataset.lbFilter; render(); return; }
    if (e.target.closest('[data-lb-go-fo]')) { setSetting('view', 'faceoff'); return; }
    const row = e.target.closest('[data-lb]');
    if (row) emit('song-detail', row.dataset.lb);
  });
  $('#view').addEventListener('contextmenu', e => {
    if (state.settings.view !== 'ranks') return;
    const row = e.target.closest('[data-lb]');
    if (!row) return;
    e.preventDefault();
    emit('ctx-menu', { x: e.clientX, y: e.clientY, ids: [row.dataset.lb] });
  });
  $('#view').addEventListener('keydown', e => {
    if (state.settings.view !== 'ranks') return;
    const row = e.target.closest?.('[data-lb]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); emit('song-detail', row.dataset.lb); }
  });
}
