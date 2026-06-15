// metrics.test.mjs — unit tests for the pure compare metrics.
// Run: node tests/metrics.test.mjs
import { metrics, RANK_MIN } from '../js/metrics.js';

let passed = 0, failed = 0;
function ok(cond, msg) { cond ? passed++ : (failed++, console.error('  ✗ ' + msg)); }
function near(a, b, eps, msg) { ok(a != null && Math.abs(a - b) <= eps, `${msg} (got ${a}, want ≈${b})`); }

// ─── snapshot builders ───────────────────────────────────────────────────────
let auto = 0;
function song(id, rating, artist = 'A', genreArtistId = null) {
  return { id, name: 'Song ' + id, rating, durationMs: 200000, tags: [],
    artists: [{ id: genreArtistId || ('ar-' + artist), name: artist }] };
}
function snap(songs, artistGenres = {}) {
  const map = {}; songs.forEach(s => map[s.id] = s);
  return { songs: map, order: songs.map(s => s.id), artistGenres };
}

// ─── |S| = 0 : no shared rated songs ─────────────────────────────────────────
{
  const m = metrics(snap([song('a', 800)]), snap([song('b', 700)]));
  ok(m.shared === 0, 'S=0: shared count is 0');
  ok(m.tasteMatch === null, 'S=0: no taste-match score');
  ok(m.agreement === null, 'S=0: no agreement');
  ok(m.rank === null, 'S=0: no rank correlation');
  near(m.overlap, 0, 1e-9, 'S=0: overlap 0');
  ok(m.counts.union === 2, 'S=0: union counts both rated sets');
  ok(m.recommendations.length === 1 && m.recommendations[0].id === 'b', 'S=0: their rated song is a recommendation');
}

// ─── |S| = 1 : agreement defined, rank omitted, without-corr blend ───────────
{
  const mine = snap([song('x', 800)]);
  const theirs = snap([song('x', 700), song('y', 900)]);
  const m = metrics(mine, theirs);
  ok(m.shared === 1, 'S=1: shared count is 1');
  near(m.agreement, 1 - 100 / 999, 1e-9, 'S=1: agreement = 1 - |800-700|/999');
  ok(m.rank === null, `S=1: rank omitted below ${RANK_MIN} shared`);
  near(m.overlap, 0.5, 1e-9, 'S=1: overlap = 1/2');
  near(m.tasteMatch, 100 * (0.6 * (1 - 100 / 999) + 0.4 * 0.5), 1e-6, 'S=1: without-corr taste blend');
  ok(m.recommendations.some(r => r.id === 'y'), 'S=1: y recommended (high-rated, not in mine)');
  ok(m.biggestDisagreements[0].id === 'x' && m.biggestAgreements[0].id === 'x', 'S=1: x is both most/least agreed (only shared song)');
}

// ─── |S| = 5 : rank correlation present, with-corr blend ──────────────────────
{
  const ids = ['s1', 's2', 's3', 's4', 's5'];
  const mine = snap(ids.map((id, i) => song(id, 200 + i * 150)));        // 200,350,500,650,800
  const theirs = snap(ids.map((id, i) => song(id, 250 + i * 140)));       // 250,390,530,670,810 (same order)
  const m = metrics(mine, theirs);
  ok(m.shared === 5, 'S=5: shared count is 5');
  ok(m.rank !== null, `S=5: rank correlation present at ${RANK_MIN}+ shared`);
  near(m.rank, 1, 1e-9, 'S=5: identical rank order → rank match 1');
  ok(m.tasteMatch > 0 && m.tasteMatch <= 100, 'S=5: taste-match in (0,100]');
}

// ─── identical libraries → perfect scores ────────────────────────────────────
{
  const songs = ['a', 'b', 'c', 'd', 'e'].map((id, i) => song(id, 500 + i * 100, 'Art' + i));
  const lib = snap(songs);
  const lib2 = snap(songs.map(s => ({ ...s })));
  const m = metrics(lib, lib2);
  near(m.agreement, 1, 1e-9, 'identical: agreement 1');
  near(m.overlap, 1, 1e-9, 'identical: overlap 1');
  near(m.rank, 1, 1e-9, 'identical: rank 1');
  near(m.tasteMatch, 100, 1e-6, 'identical: taste-match 100');
  ok(m.recommendations.length === 0, 'identical: nothing to recommend');
  near(m.artistOverlap, 1, 1e-9, 'identical: artist overlap 1');
}

// ─── disagreement ordering ───────────────────────────────────────────────────
{
  const mine = snap([song('p', 900), song('q', 500), song('r', 100)]);
  const theirs = snap([song('p', 880), song('q', 200), song('r', 950)]);  // deltas: 20, 300, 850
  const m = metrics(mine, theirs);
  ok(m.biggestDisagreements[0].id === 'r', 'ordering: largest delta (r) leads disagreements');
  ok(m.biggestAgreements[0].id === 'p', 'ordering: smallest delta (p) leads agreements');
}

// ─── summary ─────────────────────────────────────────────────────────────────
console.log(`\nmetrics.test: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
