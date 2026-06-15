// Stats dashboard. Split into a pure builder (buildStats) that takes a snapshot
// and the live view (render) that feeds it the global state and wires the
// histogram. The friend profile reuses buildStats with a friend's snapshot.
import { state, songGenres, setSettings } from './store.js';
import { $, esc, fmtMs, hashHue } from './utils.js';

function statCard(val, label, color = 'var(--accent)') {
  return `<div class="stat-card" style="--sc:${color}"><div class="sc-val">${val}</div><div class="sc-label">${esc(label)}</div></div>`;
}

function rankRows(entries, maxVal, fmt = v => v, colorFn = null) {
  return entries.map(([name, val, count], i) => `
    <div class="rank-row">
      <span class="rr-idx">${i + 1}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}${count ? ` <span class="rr-n">(${count})</span>` : ''}</span>
      <span class="rr-n">${fmt(val)}</span>
      <span class="rr-bar"><div style="width:${Math.round(val / maxVal * 100)}%${colorFn ? `;background:${colorFn(name)}` : ''}"></div></span>
    </div>`).join('');
}

// Pure: builds the stats markup from a snapshot { songs, tags, artistGenres }.
// `interactive` adds the click-to-filter affordance on histogram bars (live view
// only); the read-only friend profile passes it false.
export function buildStats({ songs: songsMap, tags = [], artistGenres = {} }, { interactive = false } = {}) {
  const songs = Object.values(songsMap || {});
  const rated = songs.filter(s => s.rating != null);
  const avg = rated.length ? (rated.reduce((a, s) => a + s.rating, 0) / rated.length) : 0;
  const totalMs = songs.reduce((a, s) => a + (s.durationMs || 0), 0);
  const artists = new Set(songs.flatMap(s => s.artists.map(a => a.name)));
  const genres = new Set(songs.flatMap(s => songGenres(s, artistGenres)));

  // histogram: 10 buckets of 100
  const hist = Array(10).fill(0);
  rated.forEach(s => hist[Math.min(9, Math.floor((s.rating - 1) / 100))]++);
  const maxH = Math.max(1, ...hist);

  // per-artist averages (2+ rated songs)
  const byArtist = new Map();
  for (const s of rated) {
    const a = s.artists[0]?.name || 'Unknown';
    if (!byArtist.has(a)) byArtist.set(a, []);
    byArtist.get(a).push(s.rating);
  }
  const artistAvgs = [...byArtist.entries()]
    .filter(([, rs]) => rs.length >= 2)
    .map(([a, rs]) => [a, Math.round(rs.reduce((x, y) => x + y, 0) / rs.length), rs.length])
    .sort((a, b) => b[1] - a[1]).slice(0, 10);

  const byGenre = new Map();
  for (const s of rated) {
    for (const g of songGenres(s, artistGenres)) {
      if (!byGenre.has(g)) byGenre.set(g, []);
      byGenre.get(g).push(s.rating);
    }
  }
  const genreAvgs = [...byGenre.entries()]
    .filter(([, rs]) => rs.length >= 2)
    .map(([g, rs]) => [g, Math.round(rs.reduce((x, y) => x + y, 0) / rs.length), rs.length])
    .sort((a, b) => b[1] - a[1]).slice(0, 10);

  const tagCounts = tags
    .map(t => [t.name, songs.filter(s => s.tags?.includes(t.id)).length])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const best = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 5);
  const worst = [...rated].sort((a, b) => a.rating - b.rating).slice(0, 5);

  const hours = Math.floor(totalMs / 3600000);
  const histHint = interactive ? '<span class="hint">(click a bar to filter the library to that range)</span>' : '';
  const hcolAttrs = i => interactive
    ? ` data-decile="${i}" role="button" tabindex="0" aria-label="Filter to ratings ${i * 100 + 1} to ${i * 100 + 100}"`
    : '';
  const ratedRow = (s, i) => `<div class="rank-row"><span class="rr-idx">${i + 1}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)} <span class="rr-n">${esc(s.artists.map(a => a.name).join(', '))}</span></span><span class="rating-in has-val" style="--rv:${s.rating};pointer-events:none">${s.rating}</span><span class="rr-bar"><div style="width:${s.rating / 10}%;background:hsl(${Math.round(s.rating * 0.12)} 65% 45%)"></div></span></div>`;

  return `
    <div class="stats-grid">
      ${statCard(songs.length, 'songs in library', 'var(--accent)')}
      ${statCard(rated.length + ' <span style="font-size:.9rem;color:var(--text2)">(' + (songs.length ? Math.round(rated.length / songs.length * 100) : 0) + '%)</span>', 'rated', 'var(--tier-a)')}
      ${statCard(rated.length ? avg.toFixed(1) : '—', 'average rating', 'var(--tier-c)')}
      ${statCard(artists.size, 'artists', 'var(--tier-b)')}
      ${statCard(genres.size, 'genres', 'var(--tier-s)')}
      ${statCard(hours ? hours + 'h ' + Math.round(totalMs % 3600000 / 60000) + 'm' : fmtMs(totalMs), 'total runtime', 'var(--accent2)')}
    </div>

    <div class="stats-sec">
      <h3>Rating distribution ${histHint}</h3>
      ${rated.length ? `<div class="hist">${hist.map((n, i) =>
        `<div class="hcol"${hcolAttrs(i)}>
          <span class="rr-n" style="font-size:.7rem">${n || ''}</span>
          <div class="hbar" style="height:${Math.round(n / maxH * 100)}%;background:hsl(${i * 12} 70% 50%)"></div>
          <span class="hlabel">${i * 100 + 1}–${i * 100 + 100}</span></div>`
      ).join('')}</div>` : '<p class="hint">No rated songs to chart yet.</p>'}
    </div>

    ${artistAvgs.length ? `<div class="stats-sec"><h3>Top artists by average rating <span class="hint">(min 2 rated)</span></h3>
      <div class="rank-list">${rankRows(artistAvgs, 1000, v => v, n => `hsl(${hashHue(n)} 70% 55%)`)}</div></div>` : ''}

    ${genreAvgs.length ? `<div class="stats-sec"><h3>Top genres by average rating</h3>
      <div class="rank-list">${rankRows(genreAvgs, 1000, v => v, n => `hsl(${hashHue(n)} 70% 55%)`)}</div></div>` : ''}

    ${best.length ? `<div class="stats-sec"><h3>Highest rated</h3>
      <div class="rank-list">${best.map(ratedRow).join('')}</div></div>` : ''}

    ${worst.length > 1 ? `<div class="stats-sec"><h3>Lowest rated</h3>
      <div class="rank-list">${worst.map(ratedRow).join('')}</div></div>` : ''}

    ${tagCounts.length ? `<div class="stats-sec"><h3>Tag usage</h3>
      <div class="rank-list">${rankRows(tagCounts, Math.max(...tagCounts.map(t => t[1])), v => v,
        n => tags.find(t => t.name === n)?.color || 'var(--accent2)')}</div></div>` : ''}
  `;
}

export function render() {
  $('#view').innerHTML = buildStats(
    { songs: state.songs, tags: state.tags, artistGenres: state.artistGenres },
    { interactive: true },
  );

  // histogram bars filter the library to their rating decile
  $('#view').querySelectorAll('[data-decile]').forEach(el => {
    const go = () => {
      const i = +el.dataset.decile;
      setSettings({ minRating: i * 100 + 1, maxRating: i * 100 + 100, ratedFilter: 'rated', view: 'library' });
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
