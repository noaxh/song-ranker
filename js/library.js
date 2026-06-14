// Import pipelines: Spotify -> normalized song records -> store. Plus sample data.
import * as api from './api.js';
import { addSongs, setArtistGenres, state, createGroup, addToGroup } from './store.js';

export function normalizeTrack(t, addedAt, albumOverride) {
  // Playlists can hold podcast episodes and local files — only real tracks import.
  if (!t || t.is_local || !t.id || (t.type && t.type !== 'track')) return null;
  const al = albumOverride || t.album || {};
  const imgs = al.images || [];
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map(a => ({ id: a.id, name: a.name })),
    album: { id: al.id || '', name: al.name || '', img: imgs[imgs.length - 1]?.url || '', imgLg: imgs[0]?.url || '' },
    durationMs: t.duration_ms || 0,
    addedAt: addedAt || new Date().toISOString(),
    rating: null,
    tags: [],
    note: '',
  };
}

function ingest(tracks) {
  const songs = tracks.filter(Boolean);
  const result = addSongs(songs);
  result.ids = songs.map(s => s.id);
  enrichGenres().catch(e => console.warn('genre enrichment failed', e));
  return result;
}

// Fetch genres for any artists we haven't resolved yet.
export async function enrichGenres() {
  const need = new Set();
  for (const s of Object.values(state.songs))
    for (const a of s.artists)
      if (a.id && !(a.id in state.artistGenres)) need.add(a.id);
  if (!need.size) return;
  const map = await api.getArtistsGenres([...need]);
  setArtistGenres(map);
}

export async function importLiked(opts) {
  const items = await api.getLikedTracks(opts);
  return ingest(items.map(it => normalizeTrack(it?.track, it?.added_at)));
}

export async function importPlaylist(playlistId, opts = {}) {
  const items = await api.getPlaylistItems(playlistId, opts);
  // New API wraps the track as `.item`; keep `.track` fallback just in case.
  const result = ingest(items.map(it => normalizeTrack(it?.item ?? it?.track, it?.added_at)));
  // Optionally mirror the playlist as a local group so it stays browsable in-app.
  if (opts.asGroupNamed && result.ids.length) {
    const g = state.groups.find(x => x.name === opts.asGroupNamed)
      || createGroup(opts.asGroupNamed, '#1db954');
    addToGroup(result.ids, g.id);
    result.groupId = g.id;
  }
  return result;
}

export async function importTopTracks(range) {
  const res = await api.getTopTracks(range);
  return ingest((res.items || []).map(t => normalizeTrack(t)));
}

export async function importArtistTop(artistId, artistName) {
  const tracks = await api.getArtistTopTracks(artistId, artistName);
  return ingest(tracks.map(t => normalizeTrack(t)));
}

// Full discography: every album/single -> all tracks (deduped by track id in store).
export async function importArtistFull(artistId, { onProgress, signal } = {}) {
  const albums = await api.getArtistAlbums(artistId, { signal });
  const seen = new Set();
  const unique = albums.filter(a => {
    const key = (a.name + '|' + a.total_tracks).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const tracks = [];
  for (let i = 0; i < unique.length; i++) {
    if (signal?.aborted) break;
    const full = await api.getAlbum(unique[i].id);
    for (const t of full.tracks?.items || []) tracks.push(normalizeTrack(t, full.release_date, full));
    onProgress?.(i + 1, unique.length);
  }
  return ingest(tracks);
}

// One album (used by Home's "New releases" shelf).
export async function importAlbum(albumId) {
  const full = await api.getAlbum(albumId);
  return ingest((full.tracks?.items || []).map(t => normalizeTrack(t, full.release_date, full)));
}

export function importSearchResults(rawTracks) {
  return ingest(rawTracks.map(t => normalizeTrack(t)));
}

// ---------- sample data (works without Spotify, for trying the UI) ----------
const SAMPLE = [
  ['Neon Skyline', 'Midnight Parade', 'City Lights', 212, ['synthpop', 'indie pop']],
  ['Glass Hours', 'Midnight Parade', 'City Lights', 198, ['synthpop', 'indie pop']],
  ['Runaway Signal', 'Midnight Parade', 'Afterglow EP', 240, ['synthpop', 'indie pop']],
  ['Paper Planets', 'The Hollow Pines', 'Evergreen', 263, ['indie folk', 'acoustic']],
  ['Cedar & Smoke', 'The Hollow Pines', 'Evergreen', 287, ['indie folk', 'acoustic']],
  ['North of Nowhere', 'The Hollow Pines', 'Trailheads', 224, ['indie folk']],
  ['Bassline Theory', 'KiloWatts', 'Voltage', 195, ['electronic', 'house']],
  ['Overdrive', 'KiloWatts', 'Voltage', 187, ['electronic', 'house']],
  ['Static Bloom', 'KiloWatts', 'Afterimage', 233, ['electronic', 'idm']],
  ['Velvet Thunder', 'Ruby Avenue', 'Scarlet', 251, ['rock', 'garage rock']],
  ['Gasoline Heart', 'Ruby Avenue', 'Scarlet', 219, ['rock', 'garage rock']],
  ['Cherry Switchblade', 'Ruby Avenue', 'Night Drive', 205, ['rock', 'punk']],
  ['Slow Orbit', 'Luna Verde', 'Tides', 312, ['ambient', 'downtempo']],
  ['Saltwater Lullaby', 'Luna Verde', 'Tides', 285, ['ambient', 'downtempo']],
  ['Marble Steps', 'Auric Fields', 'Golden Hour', 230, ['indie pop', 'dream pop']],
  ['Honey & Rust', 'Auric Fields', 'Golden Hour', 244, ['indie pop', 'dream pop']],
  ['Fast Lanes', 'MC Boulevard', 'Concrete Poems', 178, ['hip hop', 'rap']],
  ['Rooftop Sermon', 'MC Boulevard', 'Concrete Poems', 202, ['hip hop', 'rap']],
  ['Ivory Tempo', 'Clara Voss', 'Nocturnes Reimagined', 274, ['classical crossover', 'piano']],
  ['Twelve Strings', 'Clara Voss', 'Nocturnes Reimagined', 261, ['classical crossover', 'piano']],
];

export function loadSampleData() {
  const artistIds = {};
  const genreMap = {};
  const tracks = SAMPLE.map(([name, artist, album, secs, genres], i) => {
    if (!artistIds[artist]) {
      artistIds[artist] = 'sample-artist-' + Object.keys(artistIds).length;
      genreMap[artistIds[artist]] = genres;
    }
    return {
      id: 'sample-' + i,
      uri: '',
      name,
      artists: [{ id: artistIds[artist], name: artist }],
      album: { id: 'sample-al-' + album, name: album, img: '', imgLg: '' },
      durationMs: secs * 1000,
      addedAt: new Date(Date.now() - i * 86400000).toISOString(),
      rating: i % 3 === 0 ? null : 350 + ((i * 13) % 631),
      tags: [],
      note: '',
    };
  });
  setArtistGenres(genreMap);
  return addSongs(tracks);
}
