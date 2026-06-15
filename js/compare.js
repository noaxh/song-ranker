// Compare view: my library vs the active friend's, headlined by a taste-match %.
// All numbers come from the pure metrics() module; this file only renders and
// wires. Compare needs BOTH libraries readable — if the friend is private or
// unsynced it shows the reason instead of an empty chart.
import { state, emit, setSetting } from './store.js';
import { $, esc } from './utils.js';
import * as friends from './friends.js';
import { metrics, RANK_MIN } from './metrics.js';

const pct = (v) => Math.round((v || 0) * 100);
const mySnap = () => ({ songs: state.songs, order: state.order, artistGenres: state.artistGenres });

function chip(label, value) {
  return `<div class="cmp-chip"><span class="cmp-chip-v">${value}</span><span class="cmp-chip-l">${esc(label)}</span></div>`;
}

function songList(items, kind) {
  if (!items.length) return '<p class="hint">Nothing here yet.</p>';
  return `<div class="cmp-list">${items.map(s => {
    let right = '';
    if (kind === 'delta') right = `<span class="cmp-pair"><b>${s.mine}</b> vs <b>${s.theirs}</b></span>`;
    else if (kind === 'rec') right = `<span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span>`;
    return `<div class="cmp-row"><div class="t-block"><div class="t-name">${esc(s.name)}</div>
      <div class="t-art">${esc(s.artists)}</div></div>${right}</div>`;
  }).join('')}</div>`;
}

function picker(fid) {
  const fr = friends.state.friends;
  if (fr.length <= 1) return '';
  return `<select id="cmp-friend" class="select sm" aria-label="Choose a friend to compare">
    ${fr.map(f => `<option value="${esc(f.friend_id)}" ${f.friend_id === fid ? 'selected' : ''}>${esc(f.username || f.display_name || 'Unnamed')}</option>`).join('')}
  </select>`;
}

function reasonState(fid, msg, icon = 'info') {
  const f = friends.friendById(fid);
  const who = f ? esc(f.username || f.display_name || 'this friend') : 'this friend';
  return `<div class="empty-state"><svg><use href="#i-${icon}"/></svg>
    <h2>Can't compare with ${who}</h2><p>${esc(msg)}</p>
    <div class="empty-actions"><button class="btn" data-cmp-friends>Back to Friends</button></div></div>`;
}

export function render() {
  const root = $('#view');
  const fid = friends.activeFriend();

  if (!friends.state.friends.length) {
    root.innerHTML = `<div class="empty-state"><svg><use href="#i-rank"/></svg>
      <h2>No friends to compare with</h2><p>Add a friend first, then compare your libraries head to head.</p>
      <div class="empty-actions"><button class="btn btn-primary" data-cmp-friends>Go to Friends</button></div></div>`;
    return;
  }
  if (!fid) {
    root.innerHTML = `<div class="cmp-head"><h2>Compare</h2>${picker(null)}</div>
      <div class="empty-state"><svg><use href="#i-rank"/></svg><h2>Pick a friend</h2>
      <p>Choose someone above (or hit Compare on a friend card) to see how your tastes line up.</p></div>`;
    return;
  }

  const cached = friends.cachedLibrary(fid);
  if (!cached) {                       // not fetched yet → fetch then re-render
    root.innerHTML = `<div class="cmp-head"><h2>Compare</h2>${picker(fid)}</div>
      <div class="empty-state"><svg><use href="#i-refresh"/></svg><h2>Loading…</h2><p>Fetching their library.</p></div>`;
    friends.getLibrary(fid).then(() => { if (state.settings.view === 'compare') emit('friends'); });
    return;
  }
  if (cached.error === 'PRIVATE') return void (root.innerHTML = wrap(fid, reasonState(fid, "Their library is private.")));
  if (cached.error === 'NOT_FRIENDS') return void (root.innerHTML = wrap(fid, reasonState(fid, 'You are no longer friends.')));
  if (cached.error) return void (root.innerHTML = wrap(fid, reasonState(fid, "Couldn't load their library — try again later.")));
  if (!cached.data) return void (root.innerHTML = wrap(fid, reasonState(fid, "They haven't synced a library yet.", 'music')));

  const their = cached.data;
  const m = metrics(mySnap(), { songs: their.songs, order: their.order, artistGenres: their.artistGenres });

  const headline = m.tasteMatch == null
    ? `<div class="cmp-score none"><div class="cmp-score-v">—</div><div class="hint">No shared rated songs yet.</div></div>`
    : `<div class="cmp-score"><div class="cmp-score-v">${Math.round(m.tasteMatch)}<span>%</span></div>
       <div class="cmp-score-l">taste match</div></div>`;

  const chips = [
    chip('shared rated', m.shared),
    chip('overlap', pct(m.overlap) + '%'),
    m.agreement != null ? chip('agreement', pct(m.agreement) + '%') : '',
    m.rank != null ? chip('rank match', pct(m.rank) + '%') : '',
    chip('artist overlap', pct(m.artistOverlap) + '%'),
    chip('genre overlap', pct(m.genreOverlap) + '%'),
  ].filter(Boolean).join('');

  const rankNote = m.shared < RANK_MIN
    ? `<p class="hint">Rank match needs at least ${RANK_MIN} shared rated songs (you share ${m.shared}).</p>` : '';

  root.innerHTML = wrap(fid, `
    <div class="cmp-top">${headline}<div class="cmp-chips">${chips}</div></div>
    <p class="hint cmp-disclaimer">Taste match blends rating agreement, library overlap and rank order. It's a rough guide, not a verdict.</p>
    ${rankNote}
    <div class="cmp-cols">
      <section class="cmp-sec"><h3>You agree most</h3>${songList(m.biggestAgreements, 'delta')}</section>
      <section class="cmp-sec"><h3>You disagree most</h3>${songList(m.biggestDisagreements, 'delta')}</section>
    </div>
    <section class="cmp-sec"><h3>They love, you're missing</h3>
      <p class="hint">Their highest-rated songs not in your library — instant recommendations.</p>
      ${songList(m.recommendations, 'rec')}</section>
  `);
}

// Shared chrome (title + friend picker) around any compare body.
function wrap(fid, body) {
  const f = friends.friendById(fid);
  const who = f ? esc(f.username || f.display_name || 'Unnamed') : '';
  return `<div class="cmp-head"><h2>Compare <span class="hint">you vs ${who}</span></h2>${picker(fid)}</div>${body}`;
}

export function init() {
  const root = $('#view');
  root.addEventListener('click', e => {
    if (state.settings.view !== 'compare') return;
    if (e.target.closest('[data-cmp-friends]')) { setSetting('view', 'friends'); return; }
  });
  root.addEventListener('change', e => {
    if (state.settings.view !== 'compare') return;
    const sel = e.target.closest('#cmp-friend');
    if (sel) friends.setActive(sel.value);     // setActive emits 'friends' → re-render
  });
}
