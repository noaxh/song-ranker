// Tournament: single-elimination bracket over a random sample of a Face-off
// scope. Each match is a duel (same Elo nudge as quick duels); winners advance
// until one song is crowned. Lives inside the Face-off view — faceoff.js
// delegates render/input here while a tournament is active.
import { state } from './store.js';
import { $, esc } from './utils.js';
import { eloApply, duelCard, playUri, render as foRender } from './faceoff.js';

let t = null; // { label, size, rounds: [[songIds]], roundIdx, match, result, champion }
let nextTimer = null;

export const isActive = () => !!t;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function start(poolIds, label, size) {
  t = { label, size, rounds: [shuffle(poolIds).slice(0, size)], roundIdx: 0, match: 0, result: null, champion: null };
}

function quit() {
  clearTimeout(nextTimer);
  t = null;
  foRender();
}

function roundName(participants) {
  if (participants === 2) return 'Grand Final';
  if (participants === 4) return 'Semifinals';
  if (participants === 8) return 'Quarterfinals';
  return `Round of ${participants}`;
}

const currentRound = () => t.rounds[t.roundIdx];
const currentPair = () => [currentRound()[t.match * 2], currentRound()[t.match * 2 + 1]];

// Advance bracket bookkeeping after a decided match (or a walkover).
function advance(winnerId) {
  if (!t.rounds[t.roundIdx + 1]) t.rounds[t.roundIdx + 1] = [];
  t.rounds[t.roundIdx + 1][t.match] = winnerId;
  if ((t.match + 1) * 2 >= currentRound().length) {
    const next = t.rounds[t.roundIdx + 1];
    // '__none__' marks a bracket that lost every song mid-run (mass delete).
    if (next.length === 1) t.champion = next[0] || '__none__';
    else { t.roundIdx++; t.match = 0; }
  } else {
    t.match++;
  }
}

function choose(winnerId) {
  if (!t || t.result || t.champion) return;
  const [a, b] = currentPair();
  if (winnerId !== a && winnerId !== b) return;
  const loserId = winnerId === a ? b : a;
  const { dW, dL } = eloApply(winnerId, loserId, 'Tournament match');
  t.result = { winnerId, dW, dL };
  render(); // re-render in place so the duel animation plays
  clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    t.result = null;
    advance(winnerId);
    if (state.settings.view === 'faceoff') render();
  }, 1300);
}

// Songs deleted mid-tournament get a walkover: the surviving side advances free.
function resolveWalkovers() {
  while (t && !t.champion && !t.result) {
    const [a, b] = currentPair();
    const sa = state.songs[a], sb = state.songs[b];
    if (sa && sb) return;
    advance(sa ? a : b); // both gone -> undefined slot carries forward
  }
}

// ---------- bracket overview ----------
function slotHtml(id, cls) {
  const s = id ? state.songs[id] : null;
  if (!s) return `<div class="tb-slot tbd ${cls}"><span class="tb-name">${id ? 'removed' : 'TBD'}</span></div>`;
  return `<div class="tb-slot ${cls}">
    ${s.album.img ? `<img class="tb-art" src="${esc(s.album.img)}" alt="">` : '<span class="tb-art tb-ph"></span>'}
    <span class="tb-name">${esc(s.name)}</span>
  </div>`;
}

function bracketHtml() {
  const cols = [];
  for (let r = 0, n = t.size; n >= 1; r++, n = n / 2) {
    const ids = t.rounds[r] || [];
    const nextIds = t.rounds[r + 1] || [];
    const slots = Array.from({ length: n }, (_, i) => {
      const id = ids[i];
      const decided = nextIds[Math.floor(i / 2)] !== undefined;
      const out = n > 1 && decided && nextIds[Math.floor(i / 2)] !== id;
      const live = n > 1 && r === t.roundIdx && Math.floor(i / 2) === t.match && !decided;
      const champ = n === 1 && t.champion;
      return slotHtml(id, `${out ? 'out' : ''} ${live ? 'live' : ''} ${champ ? 'champ' : ''}`);
    });
    cols.push(`<div class="tb-round">
      <h4>${n === 1 ? '👑' : roundName(n)}</h4>
      <div class="tb-col" style="--rows:${n}">${slots.join('')}</div>
    </div>`);
    if (n === 1) break;
  }
  return `<div class="tb-bracket">${cols.join('')}</div>`;
}

// ---------- screens ----------
function championHtml() {
  const s = state.songs[t.champion];
  if (!s) return `<div class="empty-state"><svg><use href="#i-zap"/></svg>
    <h2>Champion left the building</h2>
    <p>The winning song was removed from the library mid-tournament.</p>
    <div class="empty-actions"><button class="btn btn-primary" data-t-quit>New battle</button></div></div>`;
  return `<div class="faceoff tourney">
    <div class="t-champ">
      <div class="t-crown" aria-hidden="true">👑</div>
      <div class="fo-card t-champ-card">
        ${s.uri ? `<button class="btn-icon fo-play" data-fo-play="${esc(s.uri)}" aria-label="Play ${esc(s.name)}"><svg><use href="#i-play"/></svg></button>` : ''}
        ${s.album.imgLg || s.album.img
          ? `<img class="art" src="${esc(s.album.imgLg || s.album.img)}" alt="">`
          : '<span class="art art-ph"><svg style="width:40px;height:40px"><use href="#i-music"/></svg></span>'}
        <div class="fo-name">${esc(s.name)}</div>
        <div class="fo-artist">${esc(s.artists.map(a => a.name).join(', '))}</div>
        ${s.rating != null ? `<span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>` : ''}
      </div>
      <h2>Champion of ${esc(t.label)}</h2>
      <p class="fo-sub">${t.size} songs entered. One stands.</p>
    </div>
    ${bracketHtml()}
    <div class="fo-controls">
      <button class="btn btn-primary" data-t-quit><svg><use href="#i-zap"/></svg>New battle</button>
    </div>
  </div>`;
}

export function render() {
  const root = $('#view');
  if (!t) return;
  if (!t.champion) resolveWalkovers();
  if (t.champion) { root.innerHTML = championHtml(); return; }

  const [aId, bId] = currentPair();
  const a = state.songs[aId], b = state.songs[bId];
  const matches = currentRound().length / 2;
  root.innerHTML = `<div class="faceoff tourney">
    <div class="fo-head">
      <h2>🏆 ${esc(t.label)}</h2>
      <span class="fo-progress">${roundName(currentRound().length)} · Match ${t.match + 1} / ${matches}</span>
    </div>
    <p class="fo-sub">Winner advances · loser goes home</p>
    <div class="fo-arena ${t.result ? 'fo-clash' : ''}">
      ${duelCard(a, 'l', t.result)}
      <div class="fo-vs" aria-hidden="true">VS</div>
      ${duelCard(b, 'r', t.result)}
    </div>
    ${bracketHtml()}
    <div class="fo-controls">
      <button class="btn btn-ghost" data-t-quit>Abandon tournament</button>
    </div>
    <p class="fo-stats"><kbd>←</kbd> <kbd>→</kbd> pick the winner</p>
  </div>`;
}

export function init() {
  $('#view').addEventListener('click', e => {
    if (state.settings.view !== 'faceoff' || !t) return;
    const play = e.target.closest('[data-fo-play]');
    if (play) { playUri(play.dataset.foPlay); return; }
    if (e.target.closest('[data-t-quit]')) {
      if (t.champion || confirm('Abandon this tournament? Bracket progress is lost (rating changes stay).')) quit();
      return;
    }
    const pick = e.target.closest('[data-fo-pick]');
    if (pick) choose(pick.dataset.foPick);
  });
  $('#view').addEventListener('keydown', e => {
    if (state.settings.view !== 'faceoff' || !t) return;
    const pick = e.target.closest?.('[data-fo-pick]');
    if (pick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(pick.dataset.foPick); }
  });
  document.addEventListener('keydown', e => {
    if (state.settings.view !== 'faceoff' || !t || t.champion) return;
    if (e.target.closest?.('input, textarea, select, .modal')) return;
    const pair = currentPair();
    if (e.key === 'ArrowLeft') { e.preventDefault(); choose(pair[0]); }
    if (e.key === 'ArrowRight') { e.preventDefault(); choose(pair[1]); }
  });
}
