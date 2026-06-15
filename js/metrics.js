// Compare metrics — pure and testable. metrics(mine, theirs) takes two snapshots
// { songs, order, artistGenres } and returns numbers + lists, never any DOM. The
// taste-match blend is an explicit heuristic, not a truth; weights are named
// constants so the formula is auditable. Unit tested in tests/metrics.test.mjs.
import { songGenres } from './store.js';

// Ratings run 1..1000, so the largest possible per-song disagreement is 999.
const MAX_DELTA = 999;
// Spearman needs a few shared points to mean anything; below this it is omitted.
export const RANK_MIN = 5;
// Taste-match weights — must each sum to 1 within their branch.
const W_WITH = { agreement: 0.5, overlap: 0.3, rank: 0.2 };
const W_WITHOUT = { agreement: 0.6, overlap: 0.4 };

const ratedIds = (snap) => Object.keys(snap.songs || {}).filter(id => snap.songs[id]?.rating != null);
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// Average-rank vector for a list of values (ties share the mean of their ranks).
function ranks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank for the tie block
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const rx = ranks(xs), ry = ranks(ys);
  let dSq = 0;
  for (let i = 0; i < n; i++) { const d = rx[i] - ry[i]; dSq += d * d; }
  const denom = n * (n * n - 1);
  return denom === 0 ? 0 : 1 - (6 * dSq) / denom;
}

function jaccard(aSet, bSet) {
  if (!aSet.size && !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union ? inter / union : 0;
}

function artistSet(snap) {
  const set = new Set();
  for (const s of Object.values(snap.songs || {})) for (const a of (s.artists || [])) if (a?.id) set.add(a.id);
  return set;
}
function genreSet(snap) {
  const set = new Set();
  for (const s of Object.values(snap.songs || {}))
    for (const g of songGenres(s, snap.artistGenres || {})) if (g !== 'Unknown genre') set.add(g);
  return set;
}

const card = (s, extra = {}) => ({
  id: s.id, name: s.name, artists: (s.artists || []).map(a => a.name).join(', '), ...extra,
});

export function metrics(mine, theirs) {
  mine = mine || { songs: {} };
  theirs = theirs || { songs: {} };
  const mineRated = new Set(ratedIds(mine));
  const theirsRated = new Set(ratedIds(theirs));

  const shared = [...mineRated].filter(id => theirsRated.has(id));
  const union = new Set([...mineRated, ...theirsRated]);
  const overlap = union.size ? shared.length / union.size : 0;

  // Per-song deltas across the shared, rated set.
  const deltas = shared.map(id => {
    const a = mine.songs[id].rating, b = theirs.songs[id].rating;
    return { id, mine: a, theirs: b, delta: Math.abs(a - b), s: mine.songs[id] };
  });

  const agreement = shared.length >= 1 ? 1 - mean(deltas.map(d => d.delta)) / MAX_DELTA : null;

  let rank = null;
  if (shared.length >= RANK_MIN) {
    const rho = spearman(shared.map(id => mine.songs[id].rating), shared.map(id => theirs.songs[id].rating));
    rank = (rho + 1) / 2; // map -1..1 → 0..1
  }

  let tasteMatch = null;
  if (shared.length >= 1) {
    tasteMatch = rank != null
      ? 100 * (W_WITH.agreement * agreement + W_WITH.overlap * overlap + W_WITH.rank * rank)
      : 100 * (W_WITHOUT.agreement * agreement + W_WITHOUT.overlap * overlap);
  }

  const byDelta = [...deltas].sort((a, b) => a.delta - b.delta);
  const biggestAgreements = byDelta.slice(0, 8).map(d => card(d.s, { mine: d.mine, theirs: d.theirs, delta: d.delta }));
  const biggestDisagreements = [...byDelta].reverse().slice(0, 8).map(d => card(d.s, { mine: d.mine, theirs: d.theirs, delta: d.delta }));

  // They love, you're missing — their high-rated tracks absent from your library.
  const recommendations = [...theirsRated]
    .filter(id => !mine.songs[id])
    .map(id => theirs.songs[id])
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 12)
    .map(s => card(s, { rating: s.rating }));

  return {
    shared: shared.length,
    overlap, agreement, rank, tasteMatch,
    artistOverlap: jaccard(artistSet(mine), artistSet(theirs)),
    genreOverlap: jaccard(genreSet(mine), genreSet(theirs)),
    biggestAgreements, biggestDisagreements, recommendations,
    counts: { mineRated: mineRated.size, theirsRated: theirsRated.size, union: union.size },
  };
}
