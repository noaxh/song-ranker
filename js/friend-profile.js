// Read-only friend profile — the "other side of the mirror". Reuses the pure
// leaderboard/stats builders against a FRIEND's snapshot. Renders no rating
// inputs and binds no write handlers; the markup carries no [data-id], so the
// library's global #view handlers never act on friend rows.
import { esc } from './utils.js';
import { emit } from './store.js';
import * as friends from './friends.js';
import { buildLeaderboard } from './leaderboard.js';
import { buildStats } from './stats.js';

// Last non-cacheable outcome per friend (PRIVATE / NOT_FRIENDS / OFFLINE), so a
// re-render after a failed fetch can explain itself instead of showing a spinner.
const lastError = {};

const META = {
  PRIVATE: "This friend's library is private.",
  NOT_FRIENDS: 'You are no longer friends with this person.',
  OFFLINE: "Couldn't reach the server — showing nothing cached for this friend yet.",
  ERROR: 'Something went wrong loading this library.',
};

function header(fid) {
  const f = friends.friendById(fid) || {};
  const label = f.username || f.display_name || 'Unnamed';
  const sub = f.display_name && f.username && f.display_name !== f.username ? esc(f.display_name) : '';
  const avatar = f.avatar_url
    ? `<img class="fp-avatar" src="${esc(f.avatar_url)}" alt="">`
    : `<span class="fp-avatar fp-avatar-ph">${esc(label.slice(0, 2).toUpperCase())}</span>`;
  const stats = [
    f.song_count != null ? `${f.song_count} songs` : '',
    f.rated_count != null ? `${f.rated_count} rated` : '',
    f.avg_rating != null ? `avg ${f.avg_rating}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="fp-head">
    <button class="btn btn-ghost sm" data-fp-back><svg><use href="#i-chevron" style="transform:rotate(90deg)"/></svg>Back</button>
    <div class="fp-id">${avatar}<div><div class="fp-name">${esc(label)}</div>
      ${sub ? `<div class="hint">${sub}</div>` : ''}${stats ? `<div class="hint">${stats}</div>` : ''}</div></div>
    <button class="btn btn-primary sm" data-fp-compare="${esc(fid)}"><svg><use href="#i-rank"/></svg>Compare</button>
  </div>`;
}

// Synchronous: build from whatever is cached. Shows a loading / empty / error
// note when there is no usable blob yet.
export function profileHtml(fid) {
  const cached = friends.cachedLibrary(fid);
  let body;
  if (cached && cached.data) {
    const snap = cached.data;
    body = `<div class="fp-sections">
      <section>${buildStats({ songs: snap.songs, tags: snap.tags || [], artistGenres: snap.artistGenres || {} })}</section>
      <section>${buildLeaderboard({ songs: snap.songs, order: snap.order })}</section>
    </div>`;
  } else if (cached && cached.data === null) {
    body = '<div class="empty-state"><svg><use href="#i-music"/></svg><h2>No library yet</h2><p>This friend hasn\'t synced a library yet.</p></div>';
  } else if (lastError[fid]) {
    body = `<div class="empty-state"><svg><use href="#i-info"/></svg><h2>Can't show this library</h2><p>${esc(META[lastError[fid]] || META.ERROR)}</p></div>`;
  } else {
    body = '<div class="empty-state"><svg><use href="#i-refresh"/></svg><h2>Loading…</h2><p>Fetching this friend\'s library.</p></div>';
  }
  return `<div class="friend-profile">${header(fid)}${body}</div>`;
}

// Fetch the friend's library (cache-aware) and signal a re-render. Errors are
// recorded so profileHtml can explain them.
export async function ensureLibrary(fid) {
  const r = await friends.getLibrary(fid);
  if (r && r.error) lastError[fid] = r.error;
  else delete lastError[fid];
  emit('friends');   // shared bus → main.js re-renders the active view
}
